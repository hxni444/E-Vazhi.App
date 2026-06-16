import * as Location from 'expo-location';
import { getDistance } from 'geolib';
import { useRef, useState } from 'react';
import { AppConfig } from '../config';

const ON_ROUTE_THRESHOLD = 50; // meters

export const useGpsEngine = (polylineCoordsRef, stopProgressValues, stateRef, showPopup, onRouteComplete) => {
  const [currentLocation, setCurrentLocation] = useState(null);
  const [routeProgress, setRouteProgress] = useState(0);
  const [busOnRoute, setBusOnRoute] = useState(false);
  const [nextStopIndex, setNextStopIndex] = useState(0);
  const [liveEtaText, setLiveEtaText] = useState(null);
  const [etaValues, setEtaValues] = useState({});
  const [hubEtas, setHubEtas] = useState([]);

  const locationSubscription = useRef(null);
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

  const startTracking = async () => {
    // Prevent multiple subscriptions
    if (locationSubscription.current) return;

    locationSubscription.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 10,
      },
      (location) => {
        const { latitude, longitude } = location.coords;
        const loc = { latitude, longitude };
        setCurrentLocation(loc);

        // Calculate bus progress along polyline
        const { progress, onRoute, totalLength } = findProgressOnPolylineCoords(loc, polylineCoordsRef.current);
        setRouteProgress(progress);
        setBusOnRoute(onRoute);

        // Calculate dynamic real-time ETAs for Destination AND Every Upcoming Stop
        if (totalLength > 0) {
          let currentSpeedMs = location.coords.speed;
          if (currentSpeedMs === null || currentSpeedMs < 0) {
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
              showPopup(`Next stop: ${stops[resolvedIdx].name}`);
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
                showPopup(`Reaching stop: ${stops[stateRef.current.nextStopIndex].name}`);
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
    );
  };

  const stopTracking = () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
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
    startTracking,
    stopTracking
  };
};
