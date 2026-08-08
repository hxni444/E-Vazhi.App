import { getDistance } from 'geolib';
import { useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppConfig } from '../config';
import { UsbSerialManager, Parity } from 'react-native-usb-serialport-for-android';
import * as Location from 'expo-location';

const ON_ROUTE_THRESHOLD = 50; // meters

function hexToString(hex) {
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
        const code = parseInt(hex.substr(i, 2), 16);
        if (code > 0) str += String.fromCharCode(code);
    }
    return str;
}

function convertNMEA(value, direction) {
  if (!value) return 0;
  const val = parseFloat(value);
  const deg = parseInt(val / 100);
  const min = val - (deg * 100);
  let decimal = deg + min / 60;
  if (direction === 'S' || direction === 'W') decimal *= -1;
  return decimal;
}

function parseGPRMC(sentence) {
  const parts = sentence.split(',');
  if (!parts[0].endsWith('RMC')) return undefined; // Not an RMC sentence
  if (parts[2] !== 'A') return null; // RMC sentence but no satellite fix (Void)
  
  const lat = convertNMEA(parts[3], parts[4]);
  const lon = convertNMEA(parts[5], parts[6]);
  const speed = parseFloat(parts[7]) * 0.514444; // knots to m/s
  
  return { lat, lon, speed };
}

export const useGpsEngine = (polylineCoordsRef, stopProgressValues, stateRef, showPopup, onRouteComplete, allRoutesRef, currentIndexRef, onWrongRouteDetected) => {
  const [currentLocation, setCurrentLocation] = useState(null);
  const [routeProgress, setRouteProgress] = useState(0);
  const [busOnRoute, setBusOnRoute] = useState(false);
  const [nextStopIndex, setNextStopIndex] = useState(0);
  const [liveEtaText, setLiveEtaText] = useState(null);
  const [etaValues, setEtaValues] = useState({});
  const [hubEtas, setHubEtas] = useState([]);
  
  const gpsStatusRef = useRef('DISCONNECTED');
  const [gpsStatus, _setGpsStatus] = useState('DISCONNECTED');
  
  const setGpsStatus = (status) => {
    if (gpsStatusRef.current !== status) {
      gpsStatusRef.current = status;
      _setGpsStatus(status);
    }
  };

  const locationSubscription = useRef(null);
  const expoLocationSubRef = useRef(null);
  const portRef = useRef(null);
  const speedTrackerRef = useRef([]);
  const candidateRoutesRef = useRef({}); // tracks { entryProgress, totalLength } for each route index

  const processLocationUpdate = (latitude, longitude, speed) => {
    const currentLoc = { latitude, longitude };
    setCurrentLocation(currentLoc);

    // Calculate bus progress along polyline
    const { progress, onRoute, totalLength } = findProgressOnPolylineCoords(currentLoc, polylineCoordsRef.current);
    setRouteProgress(progress);
    setBusOnRoute(onRoute);

    // -------------------------------------------------------------
    // GLOBAL ROUTE TRACKING & AUTO-DEVIATION DETECTION
    // -------------------------------------------------------------
    if (allRoutesRef && allRoutesRef.current && currentIndexRef && onWrongRouteDetected) {
      const currentIdx = currentIndexRef.current;
      const routes = allRoutesRef.current;
      
      routes.forEach((routeData, idx) => {
        let parsed = [];
        if (Array.isArray(routeData.polyline)) {
          parsed = routeData.polyline;
        } else if (typeof routeData.polyline === 'string') {
          try { parsed = JSON.parse(routeData.polyline); } catch (e) {}
        }
        if (parsed.length < 2) {
          (routeData.stops || []).forEach(s => s?.coordinate && parsed.push(s.coordinate));
        }

        if (parsed.length >= 2) {
          const rData = findProgressOnPolylineCoords(currentLoc, parsed);
          if (rData.onRoute) {
            if (!candidateRoutesRef.current[idx]) {
              candidateRoutesRef.current[idx] = { entryProgress: rData.progress, totalLength: rData.totalLength };
            } else {
              const candidate = candidateRoutesRef.current[idx];
              const distanceTraveled = (rData.progress - candidate.entryProgress) * candidate.totalLength;
              if (distanceTraveled >= 600) {
                if (idx !== currentIdx) {
                  console.log(`[ROUTE-DETECT] Bus traveled >600m on alternative route index ${idx}. Triggering switch.`);
                  candidateRoutesRef.current = {}; 
                  onWrongRouteDetected(idx, routeData);
                } else {
                  candidate.entryProgress = rData.progress;
                }
              }
            }
          } else {
            delete candidateRoutesRef.current[idx];
          }
        }
      });
    }

    // Calculate dynamic real-time ETAs for Destination AND Every Upcoming Stop
    if (totalLength > 0) {
      let currentSpeedMs = speed;
      if (currentSpeedMs === null || currentSpeedMs < 0 || isNaN(currentSpeedMs)) {
        currentSpeedMs = ((AppConfig.AVERAGE_BUS_SPEED_KMH || 30) * 1000) / 3600;
      }

      // Maintain rolling average of last 15 GPS speed readings to smooth out jitter
      speedTrackerRef.current.push(currentSpeedMs);
      if (speedTrackerRef.current.length > 15) speedTrackerRef.current.shift();

      const avgSpeedMs = speedTrackerRef.current.reduce((sum, val) => sum + val, 0) / speedTrackerRef.current.length;
      const effectiveSpeedMs = Math.max(avgSpeedMs, 2.8);

      const stopVals = stopProgressValues.current;
      const upcomingEtas = {};
      const hubEtasArray = [];

      stopVals.forEach((sp, idx) => {
        if (sp >= progress) {
          const remainingMeters = Math.max(0, totalLength * (sp - progress));
          const etaSecs = remainingMeters / effectiveSpeedMs;
          const mins = Math.max(1, Math.ceil(etaSecs / 60));
          upcomingEtas[idx] = `${mins} min`;

          const stopInfo = stateRef.current.stops[idx];
          if (stopInfo && stopInfo.majorHub) {
            hubEtasArray.push({ hubId: stopInfo.id, etaSeconds: etaSecs });
          }
        }
      });

      setEtaValues(upcomingEtas);
      setHubEtas(hubEtasArray);

      const remainingToDest = totalLength * (1 - progress);
      const destMins = Math.max(1, Math.ceil(remainingToDest / effectiveSpeedMs / 60));
      setLiveEtaText(`${destMins} MINS`);
    }

    // Auto-detect next stop and reaching stop logic
    const stopVals = stopProgressValues.current;
    if (stopVals.length > 0 && totalLength > 0) {
      const nextStopBufferProgress = AppConfig.NEXT_STOP_ANNOUNCEMENT_BUFFER_METERS / totalLength;
      const reachingThresholdProgress = AppConfig.REACHING_STOP_ANNOUNCEMENT_THRESHOLD_METERS / totalLength;

      const newNextIdx = stopVals.findIndex(sp => sp > progress - nextStopBufferProgress);
      let resolvedIdx = newNextIdx === -1 ? stopVals.length - 1 : newNextIdx;
      
      if (resolvedIdx === 0 && stopVals.length > 1) {
        resolvedIdx = 1;
      }
      if (resolvedIdx !== stateRef.current.nextStopIndex) {
        const stops = stateRef.current.stops;
        stateRef.current.nextStopIndex = resolvedIdx;
        stateRef.current.hasAnnouncedReaching = false;
        setNextStopIndex(resolvedIdx);
        if (stops[resolvedIdx]) {
          showPopup('NEXT', stops[resolvedIdx]);
        }
      }

      if (!stateRef.current.hasAnnouncedReaching) {
        const targetStopProgress = stopVals[stateRef.current.nextStopIndex];
        const distanceToStop = targetStopProgress - progress;

        if (distanceToStop >= 0 && distanceToStop <= reachingThresholdProgress) {
          const stops = stateRef.current.stops;
          stateRef.current.hasAnnouncedReaching = true;
          if (stops[stateRef.current.nextStopIndex]) {
            showPopup('REACHING', stops[stateRef.current.nextStopIndex]);
          }
        }
      }

      const stops = stateRef.current.stops;
      if (stops.length > 0) {
        const destStop = stops[stops.length - 1];
        if (destStop && destStop.coordinate) {
          const physicalDist = getDistance(
            { latitude: currentLoc.latitude, longitude: currentLoc.longitude },
            { latitude: destStop.coordinate.latitude, longitude: destStop.coordinate.longitude }
          );
          if (physicalDist <= 75) { // 75 meters physical radius
            if (onRouteComplete && !stateRef.current.hasTriggeredRouteComplete) {
              stateRef.current.hasTriggeredRouteComplete = true;
              onRouteComplete(destStop.name);
            }
          }
        }
      }
    }
  };

  const fallbackWatchdogRef = useRef(null);

  const resetFallbackWatchdog = () => {
    if (fallbackWatchdogRef.current) clearTimeout(fallbackWatchdogRef.current);
    fallbackWatchdogRef.current = setTimeout(() => {
      console.warn('[INTERNAL-GPS] Watchdog triggered! No coordinates for 10 seconds. Restarting...');
      setGpsStatus('INTERNAL GPS SILENT');
      startFallbackTracking();
    }, 10000); // 10 seconds watchdog
  };

  const startFallbackTracking = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGpsStatus('INTERNAL GPS PERM DENIED');
        return;
      }
      setGpsStatus('USING INTERNAL GPS');
      resetFallbackWatchdog();
      
      if (expoLocationSubRef.current) {
        try { expoLocationSubRef.current.remove(); } catch(e) {}
        expoLocationSubRef.current = null;
      }

      expoLocationSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000 },
        (loc) => {
          resetFallbackWatchdog();
          processLocationUpdate(loc.coords.latitude, loc.coords.longitude, loc.coords.speed || 0);
        }
      );
    } catch(err) {
      console.warn('[INTERNAL-GPS] Error:', err);
    }
  };

  const findProgressOnPolylineCoords = (loc, coords) => {
    if (!loc || !coords || coords.length < 2) return { progress: 0, onRoute: false, totalLength: 0 };
    let minDist = Infinity, bestSegIdx = 0, bestT = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const A = coords[i], B = coords[i + 1];
      const dx = B.longitude - A.longitude, dy = B.latitude - A.latitude;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq > 0 ? Math.max(0, Math.min(1, ((loc.longitude - A.longitude) * dx + (loc.latitude - A.latitude) * dy) / lenSq)) : 0;
      const cx = A.longitude + t * dx, cy = A.latitude + t * dy;
      const dist = getDistance({ latitude: loc.latitude, longitude: loc.longitude }, { latitude: cy, longitude: cx });
      if (dist < minDist) { minDist = dist; bestSegIdx = i; bestT = t; }
    }
    let distTravelled = 0;
    for (let i = 0; i < bestSegIdx; i++) distTravelled += getDistance(coords[i], coords[i + 1]);
    if (bestT > 0) distTravelled += bestT * getDistance(coords[bestSegIdx], coords[bestSegIdx + 1]);
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) total += getDistance(coords[i], coords[i + 1]);

    return {
      progress: total > 0 ? distTravelled / total : 0,
      onRoute: minDist <= ON_ROUTE_THRESHOLD,
      totalLength: total
    };
  };

  const watchdogRef = useRef(null);

  const startTracking = async (deviceIndex = 0) => {
    // Prevent multiple subscriptions
    if (locationSubscription.current) return;

    try {
      const devices = await UsbSerialManager.list();
      if (devices.length === 0) {
        console.warn('[USB-GPS] No USB device found.');
        setGpsStatus('NO USB DEVICE');
        const phoneDebug = await AsyncStorage.getItem('@phone_debug_mode');
        if (phoneDebug === 'true') {
          console.warn('[USB-GPS] Falling back to internal GPS (Phone Debug Mode)...');
          startFallbackTracking();
        } else {
          setTimeout(() => startTracking(0), 3000);
        }
        return;
      }

      if (deviceIndex >= devices.length) {
        console.warn('[USB-GPS] Exhausted all devices. No GPS found.');
        setGpsStatus('NO USB DEVICE');
        setTimeout(() => startTracking(0), 4000);
        return;
      }

      const d = devices[deviceIndex];
      let hasPerm = await UsbSerialManager.tryRequestPermission(d.deviceId);
      let pollCount = 0;
      while (!hasPerm && pollCount < 5) {
        setGpsStatus('WAITING FOR PERMISSION');
        await new Promise(resolve => setTimeout(resolve, 1000));
        hasPerm = await UsbSerialManager.hasPermission(d.deviceId);
        pollCount++;
      }

      if (!hasPerm) {
        setTimeout(() => startTracking(deviceIndex + 1), 100);
        return;
      }

      try {
        const tempPort = await UsbSerialManager.open(d.deviceId, { baudRate: 9600, parity: Parity.None, dataBits: 8, stopBits: 1 });
        await tempPort.close();
        await new Promise(resolve => setTimeout(resolve, 1000)); // Delay to prevent USB driver hang
      } catch(err) {
        console.warn(`[USB-GPS] Device ${d.deviceId} is not a serial device:`, err);
        setTimeout(() => startTracking(deviceIndex + 1), 100);
        return;
      }

      const device = d;
      setGpsStatus('CONNECTING');

      const BAUD_RATES = [4800, 9600, 115200, 38400];
      let currentBaudIndex = 0;
      let port = null;
      let baudTimeout = null;

      const resetWatchdog = () => {
        if (watchdogRef.current) clearTimeout(watchdogRef.current);
        watchdogRef.current = setTimeout(() => {
          console.warn("[USB-GPS] Watchdog triggered! No data for 6 seconds. Reconnecting...");
          setGpsStatus('NO USB DEVICE');
          stopTracking().then(() => startTracking(0));
        }, 6000);
      };

      const tryNextBaudRate = async () => {
        if (currentBaudIndex >= BAUD_RATES.length) {
          console.warn(`[USB-GPS] Exhausted bauds on device ${deviceIndex}. Moving to next...`);
          if (port) { try { await port.close(); } catch(e) {} }
          setTimeout(() => startTracking(deviceIndex + 1), 500);
          return;
        }
        
        const testBaud = BAUD_RATES[currentBaudIndex];
        
        try {
          if (port) {
            try { await port.close(); } catch(e) {}
          }
          if (locationSubscription.current) {
            locationSubscription.current.remove();
            locationSubscription.current = null;
          }

          port = await UsbSerialManager.open(device.deviceId, { baudRate: testBaud, parity: Parity.None, dataBits: 8, stopBits: 1 });
          portRef.current = port;
          setGpsStatus(`TRY ${testBaud}`);
          
          let nmeaBuffer = '';
          let validSentences = 0;

          baudTimeout = setTimeout(() => {
            if (validSentences === 0) {
              console.warn(`[USB-GPS] No valid NMEA on baud ${testBaud}. Trying next...`);
              currentBaudIndex++;
              tryNextBaudRate();
            }
          }, 2500); // Wait 2.5 seconds per baud rate

          locationSubscription.current = port.onReceived((event) => {
            nmeaBuffer += hexToString(event.data);
            
            // Failsafe: if buffer gets too large due to gibberish (no newlines), clear it
            if (nmeaBuffer.length > 2000) {
              nmeaBuffer = '';
            }
            
            let newlineIndex;
            while ((newlineIndex = nmeaBuffer.indexOf('\n')) !== -1) {
              const sentence = nmeaBuffer.slice(0, newlineIndex).trim();
              nmeaBuffer = nmeaBuffer.slice(newlineIndex + 1);
              
              if (sentence.includes('$GP') || sentence.includes('$GN')) {
                validSentences++;
                resetWatchdog();
                if (baudTimeout) {
                  clearTimeout(baudTimeout);
                  baudTimeout = null;
                  setGpsStatus(`GOT ${testBaud}: ${sentence.substring(0,6)}`);
                }
              }
              
              if (sentence.includes('RMC')) {
                const loc = parseGPRMC(sentence);
                if (loc === null) {
                  setGpsStatus('NO FIX (RMC)');
                } else if (loc !== undefined) {
                  setGpsStatus('CONNECTED');
                  processLocationUpdate(loc.lat, loc.lon, loc.speed);
                }
              }
            }
          });
        } catch (err) {
          console.warn(`[USB-GPS] Error opening baud ${testBaud}:`, err);
          setGpsStatus(`ERR: ${err.message || 'OPEN FAILED'}`);
          currentBaudIndex++;
          setTimeout(tryNextBaudRate, 2000);
        }
      };

      tryNextBaudRate();

    } catch (err) {
      console.warn('[USB-GPS] Error connecting:', err);
      setGpsStatus('NO USB DEVICE');
      setTimeout(startTracking, 3000);
    }
  };

  const stopTracking = async () => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (fallbackWatchdogRef.current) {
      clearTimeout(fallbackWatchdogRef.current);
      fallbackWatchdogRef.current = null;
    }
    // Also clear baudTimeout if we can, but it's local to startTracking. 
    // We should probably just rely on portRef close to break the loop.
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    if (expoLocationSubRef.current) {
      expoLocationSubRef.current.remove();
      expoLocationSubRef.current = null;
    }
    if (portRef.current) {
      try {
        await portRef.current.close();
      } catch(e) {}
      portRef.current = null;
    }
  };

  return {
    currentLocation,
    setCurrentLocation,
    routeProgress,
    busOnRoute,
    nextStopIndex,
    setNextStopIndex,
    liveEtaText,
    etaValues,
    hubEtas,
    effectiveSpeedMs: speedTrackerRef.current.length ? speedTrackerRef.current[speedTrackerRef.current.length - 1] : 0,
    gpsStatus,
    startTracking,
    stopTracking
  };
};
