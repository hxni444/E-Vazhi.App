import { getDistance } from 'geolib';
import { useRef, useState } from 'react';
import { AppConfig } from '../config';
import { UsbSerialManager, Parity } from 'react-native-usb-serialport-for-android';

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

export const useGpsEngine = (polylineCoordsRef, stopProgressValues, stateRef, showPopup, onRouteComplete) => {
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
  const portRef = useRef(null);
  const speedTrackerRef = useRef([]);

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

  const startTracking = async () => {
    // Prevent multiple subscriptions
    if (locationSubscription.current) return;

    try {
      const devices = await UsbSerialManager.list();
      if (devices.length === 0) {
        console.warn('[USB-GPS] No USB device found. Retrying in 3s...');
        setGpsStatus('NO USB DEVICE');
        setTimeout(startTracking, 3000);
        return;
      }

      let targetDevice = null;
      for (const d of devices) {
        let hasPerm = await UsbSerialManager.tryRequestPermission(d.deviceId);
        let pollCount = 0;
        while (!hasPerm && pollCount < 5) {
          setGpsStatus('WAITING FOR PERMISSION');
          await new Promise(resolve => setTimeout(resolve, 1000));
          hasPerm = await UsbSerialManager.hasPermission(d.deviceId);
          pollCount++;
        }
        if (hasPerm) {
          try {
            const tempPort = await UsbSerialManager.open(d.deviceId, { baudRate: 9600, parity: Parity.None, dataBits: 8, stopBits: 1 });
            await tempPort.close();
            await new Promise(resolve => setTimeout(resolve, 1000)); // Delay to prevent USB driver hang
            targetDevice = d;
            break; // Found the GPS serial device!
          } catch(err) {
            console.warn(`[USB-GPS] Device ${d.deviceId} is not a serial device:`, err);
          }
        }
      }

      if (!targetDevice) {
        console.warn('[USB-GPS] No valid serial drivers for any connected USB devices.');
        setGpsStatus('ERR: no driver for device');
        setTimeout(startTracking, 5000);
        return;
      }

      const device = targetDevice;

      setGpsStatus('CONNECTING');

      const BAUD_RATES = [4800, 9600, 115200, 38400];
      let currentBaudIndex = 0;
      let port = null;
      let baudTimeout = null;

      const resetWatchdog = () => {
        if (watchdogRef.current) clearTimeout(watchdogRef.current);
        watchdogRef.current = setTimeout(() => {
          console.warn("[USB-GPS] Watchdog triggered! No data for 6 seconds. Reconnecting...");
          stopTracking().then(() => startTracking());
        }, 6000);
      };

      const tryNextBaudRate = async () => {
        if (currentBaudIndex >= BAUD_RATES.length) {
          console.warn('[USB-GPS] Exhausted all baud rates. Restarting full connection cycle...');
          setGpsStatus('NO DATA RECEIVED');
          setTimeout(startTracking, 3000);
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
              const latitude = loc.lat;
              const longitude = loc.lon;
              const speed = loc.speed;
              const currentLoc = { latitude, longitude };
              setCurrentLocation(currentLoc);

              // Calculate bus progress along polyline
              const { progress, onRoute, totalLength } = findProgressOnPolylineCoords(currentLoc, polylineCoordsRef.current);
              setRouteProgress(progress);
              setBusOnRoute(onRoute);

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

                // Enforce a minimum speed of ~10 km/h (2.8 m/s) to prevent the ETA from skyrocketing when stopped at a red light
                const effectiveSpeedMs = Math.max(avgSpeedMs, 2.8);

                const stopVals = stopProgressValues.current;
                const upcomingEtas = {};
                const hubEtasArray = [];

                // For each upcoming stop: calculate remaining distance and assign ETA
                stopVals.forEach((sp, idx) => {
                  if (sp >= progress) {
                    const remainingMeters = Math.max(0, totalLength * (sp - progress));
                    const etaSecs = remainingMeters / effectiveSpeedMs;
                    const mins = Math.max(1, Math.ceil(etaSecs / 60));
                    upcomingEtas[idx] = `${mins} min`;

                    const stopInfo = stateRef.current.stops[idx];
                    if (stopInfo && stopInfo.majorHub) {
                      hubEtasArray.push({
                        hubId: stopInfo.id,
                        etaSeconds: etaSecs
                      });
                    }
                  }
                });

                setEtaValues(upcomingEtas);
                setHubEtas(hubEtasArray);

                // Update main destination ETA
                const remainingToDest = totalLength * (1 - progress);
                const destMins = Math.max(1, Math.ceil(remainingToDest / effectiveSpeedMs / 60));
                setLiveEtaText(`${destMins} MINS`);
              }

              // Auto-detect next stop and reaching stop logic
              const stopVals = stopProgressValues.current;
              if (stopVals.length > 0 && totalLength > 0) {
                // Convert physical meters from config into fractional progress
                const nextStopBufferProgress = AppConfig.NEXT_STOP_ANNOUNCEMENT_BUFFER_METERS / totalLength;
                const reachingThresholdProgress = AppConfig.REACHING_STOP_ANNOUNCEMENT_THRESHOLD_METERS / totalLength;

                // --- 1. Next Stop Detection ---
                const newNextIdx = stopVals.findIndex(sp => sp > progress + nextStopBufferProgress);
                const resolvedIdx = newNextIdx === -1 ? stopVals.length - 1 : newNextIdx;
                if (resolvedIdx !== stateRef.current.nextStopIndex) {
                  const stops = stateRef.current.stops;
                  stateRef.current.nextStopIndex = resolvedIdx;
                  stateRef.current.hasAnnouncedReaching = false; // Reset reaching flag for the new target stop
                  setNextStopIndex(resolvedIdx);
                  if (stops[resolvedIdx]) {
                    showPopup('NEXT', stops[resolvedIdx]);
                  }
                }

                // --- 2. Reaching Stop Detection ---
                if (!stateRef.current.hasAnnouncedReaching) {
                  const targetStopProgress = stopVals[stateRef.current.nextStopIndex];
                  const distanceToStop = targetStopProgress - progress;

                  // If we are getting close to the stop
                  if (distanceToStop >= 0 && distanceToStop <= reachingThresholdProgress) {
                    const stops = stateRef.current.stops;
                    stateRef.current.hasAnnouncedReaching = true;
                    if (stops[stateRef.current.nextStopIndex]) {
                      showPopup('REACHING', stops[stateRef.current.nextStopIndex]);
                    }

                    // Check if we reached the absolute destination (the final stop in the array)
                    if (stateRef.current.nextStopIndex === stops.length - 1) {
                      if (onRouteComplete && !stateRef.current.hasTriggeredRouteComplete) {
                        stateRef.current.hasTriggeredRouteComplete = true;
                        onRouteComplete(stops[stateRef.current.nextStopIndex].name);
                      }
                    }
                  }
                }
              }
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
      setTimeout(startTracking, 3000);
    }
  };

  const stopTracking = async () => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    // Also clear baudTimeout if we can, but it's local to startTracking. 
    // We should probably just rely on portRef close to break the loop.
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
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
