import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { ResizeMode, Video } from 'expo-av';
import * as Speech from 'expo-speech';
import AudioEngine from '../engines/AudioEngine';
import { getDistance } from 'geolib';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import BusMap from '../components/BusMap';
import { AppConfig } from '../config';
import { useAdEngine } from '../engines/AdEngine';
import { useGpsEngine } from '../engines/GpsEngine';

export default function BusModeScreen({ navigation, route }) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [busNumber, setBusNumber] = useState(route.params?.busNumber || '');
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [initStatus, setInitStatus] = useState('FETCHING_ROUTE'); // FETCHING_ROUTE, DOWNLOADING_ADS, COMPLETE
  const [adDownloadStatus, setAdDownloadStatus] = useState('');

  // Continuous Routing States
  const allRoutesRef = useRef([]);
  const currentIndexRef = useRef(0);
  const [showDestinationScreen, setShowDestinationScreen] = useState(false);
  const [destinationName, setDestinationName] = useState('');
  const [routeCompletedDest, setRouteCompletedDest] = useState(null);

  // Polyline progress tracking
  const [polylineCoords, setPolylineCoords] = useState([]);
  const polylineCoordsRef = useRef([]);

  const stopProgressValues = useRef([]); // each stop's 0–1 position along polyline

  const [popupVisible, setPopupVisible] = useState(false);
  const [popupMessage, setPopupMessage] = useState('');
  const popupVisibleRef = useRef(false);
  const popupQueueId = useRef(0);
  const videoRef = useRef(null);

  const showPopup = async (type, stop) => {
    if (type === 'NEXT') {
      const nextEnabled = (await AsyncStorage.getItem('@announce_next')) !== 'false';
      if (!nextEnabled) return;
    }
    if (type === 'REACHING') {
      const reachingEnabled = (await AsyncStorage.getItem('@announce_reaching')) !== 'false';
      if (!reachingEnabled) return;
    }

    popupQueueId.current++;
    const currentId = popupQueueId.current;

    const msg = `${type === 'NEXT' ? 'Next stop' : 'Reaching stop'}: ${stop.name}`;
    setPopupMessage(msg);
    setPopupVisible(true);
    popupVisibleRef.current = true;

    // Pause video for announcement
    if (videoRef.current) {
      try { await videoRef.current.pauseAsync(); } catch (e) { }
    }

    // Wrap in a Promise.race so if TTS hangs, it doesn't break the UI
    try {
      await Promise.race([
        AudioEngine.playAnnouncement(type, stop.id, stop.name),
        new Promise(resolve => setTimeout(resolve, 6000))
      ]);
    } catch (e) { }

    if (popupQueueId.current === currentId) {
      if (videoRef.current) {
        try { await videoRef.current.playAsync(); } catch (e) { }
      }
      setTimeout(() => {
        if (popupQueueId.current === currentId) {
          setPopupVisible(false);
          popupVisibleRef.current = false;
        }
      }, 3000);
    }
  };

  const locationSubscription = useRef(null);
  const stateRef = useRef({
    nextStopIndex: 0,
    stopState: 'IDLE',
    stops: [],
    hasAnnouncedReaching: false
  });

  // 1. Initialize GPS Engine
  useEffect(() => {
    if (routeCompletedDest && !currentAd) {
      triggerDestinationScreen(routeCompletedDest);
      setRouteCompletedDest(null);
    }
  }, [routeCompletedDest, currentAd]);

  const handleRouteComplete = (destName) => {
    setRouteCompletedDest(destName || 'Destination');
  };

  const triggerDestinationScreen = (destName) => {
    setDestinationName(destName || 'Destination');
    setShowDestinationScreen(true);

    setTimeout(() => {
      setShowDestinationScreen(false);
      const routes = allRoutesRef.current;
      if (routes.length > 0) {
        const nextIndex = (currentIndexRef.current + 1) % routes.length;
        currentIndexRef.current = nextIndex;
        AsyncStorage.setItem('@current_route_index', nextIndex.toString());
        loadRouteByIndex(nextIndex, routes);
      }
    }, 60000); // 1-minute full screen wait
  };

  const {
    currentLocation, setCurrentLocation, routeProgress, busOnRoute,
    nextStopIndex, setNextStopIndex,
    liveEtaText, etaValues, hubEtas, gpsStatus,
    startTracking, stopTracking
  } = useGpsEngine(polylineCoordsRef, stopProgressValues, stateRef, showPopup, handleRouteComplete);

  // 2. Initialize Ad Engine
  const {
    downloadedAds, fetchAndDownloadAds, initAdEngine,
    currentAd, onAdComplete
  } = useAdEngine(hubEtas, routeProgress, busNumber);

  // Auto-scroll the timeline continuously as the bus moves
  useEffect(() => {
    if (!scrollViewRef.current || stateRef.current.stops.length === 0) return;

    const totalStops = stateRef.current.stops.length;
    let activeIndex = 0;

    for (let i = 0; i < totalStops - 1; i++) {
      const sp = stopProgressValues.current[i] ?? 0;
      const nsp = stopProgressValues.current[i + 1] ?? 1;
      const isLast = i === totalStops - 2;

      if (routeProgress >= sp && (isLast ? routeProgress <= nsp : routeProgress < nsp)) {
        activeIndex = i;
        break;
      }
    }

    const yPos = stopYPositions.current[activeIndex];
    const H = rowHeights[activeIndex] || 120;

    if (yPos !== undefined) {
      const stopProgress = stopProgressValues.current[activeIndex] ?? 0;
      const nextStopProgress = stopProgressValues.current[activeIndex + 1] ?? 1;
      const segLen = nextStopProgress - stopProgress;
      const segmentT = segLen > 0 ? Math.min(1, Math.max(0, (routeProgress - stopProgress) / segLen)) : 0;

      const busYInRow = 32 + segmentT * Math.max(0, H - 32 - 22);
      const absoluteY = yPos + busYInRow;

      // Center the marker vertically by applying an offset (keep it near the top to show the next stop)
      scrollViewRef.current.scrollTo({
        y: Math.max(0, absoluteY - 10),
        animated: true,
      });
    }
  }, [routeProgress]);

  useEffect(() => {
    loadSetup();
    return () => stopTracking();
  }, []);

  const loadSetup = async () => {
    try {
      let bNum = busNumber;
      if (!bNum) {
        bNum = await AsyncStorage.getItem('@bus_number');
        if (bNum) {
          setBusNumber(bNum);
        } else {
          navigation.replace('Setup');
          return;
        }
      }
      fetchRouteForBus(bNum);
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to load bus number.');
    }
  };

  const loadRouteByIndex = async (index, routesArray) => {
    const routeData = routesArray[index];
    if (routeData && routeData.id) {
      setSelectedRoute(routeData);

      // Parse and store polyline coords
      let parsed = [];
      if (Array.isArray(routeData.polyline)) {
        parsed = routeData.polyline;
      } else if (typeof routeData.polyline === 'string') {
        try { parsed = JSON.parse(routeData.polyline); } catch (e) { console.warn('[polyline] parse fail', e); }
      }
      // Fallback: connect stops
      if (parsed.length < 2) {
        (routeData.stops || []).forEach(s => s?.coordinate && parsed.push(s.coordinate));
      }
      console.log(`[polyline] loaded ${parsed.length} points for route ${routeData.name}`);
      setPolylineCoords(parsed);
      polylineCoordsRef.current = parsed;

      // Update stateRef stops immediately to prevent GPS race condition during ad init
      const fullStops = routeData.stops || [];
      stateRef.current.stops = fullStops;

      const ON_ROUTE_THRESHOLD = 200;
      const findProgressOnPolylineCoords = (loc, coords) => {
        if (!loc || !coords || coords.length < 2) return { progress: 0, onRoute: false };
        let minDist = Infinity, bestSegIdx = 0, bestT = 0;
        for (let i = 0; i < coords.length - 1; i++) {
          const A = coords[i], B = coords[i + 1];
          const dx = B.longitude - A.longitude, dy = B.latitude - A.latitude;
          const lenSq = dx * dx + dy * dy;
          const t = lenSq > 0
            ? Math.max(0, Math.min(1, ((loc.longitude - A.longitude) * dx + (loc.latitude - A.latitude) * dy) / lenSq))
            : 0;
          const cx = A.longitude + t * dx, cy = A.latitude + t * dy;
          const dist = getDistance({ latitude: loc.latitude, longitude: loc.longitude }, { latitude: cy, longitude: cx });
          if (dist < minDist) { minDist = dist; bestSegIdx = i; bestT = t; }
        }
        let distTravelled = 0;
        for (let i = 0; i < bestSegIdx; i++) distTravelled += getDistance(coords[i], coords[i + 1]);
        if (bestT > 0) distTravelled += bestT * getDistance(coords[bestSegIdx], coords[bestSegIdx + 1]);
        let total = 0;
        for (let i = 0; i < coords.length - 1; i++) total += getDistance(coords[i], coords[i + 1]);
        return { progress: total > 0 ? distTravelled / total : 0, onRoute: minDist <= ON_ROUTE_THRESHOLD };
      };

      stopProgressValues.current = fullStops.map(stop => {
        if (!stop?.coordinate) return 0;
        const { progress } = findProgressOnPolylineCoords(stop.coordinate, parsed);
        return progress;
      });
      
      // Update fullStops reference for startRoute
      const actualStops = fullStops;

      try {
        setInitStatus('DOWNLOADING_ADS');
        const journeyId = `${routeData.id}_${Date.now()}`;
        await initAdEngine(routeData.id, journeyId, stopProgressValues.current, setAdDownloadStatus);
      } catch (err) {
        console.warn('[BOOT] Ad Engine failed to init, but continuing route...', err);
      }

      await startRoute(routeData, actualStops);
    } else {
      setInitStatus('COMPLETE');
      Alert.alert('No Route Found', `No active route data at index ${index}.`);
    }
  };

  const fetchRouteForBus = async (bNum) => {
    const url = `${AppConfig.API_BASE_URL}/api/App/${bNum}`;
    console.log(`[NETWORK] Attempting to fetch route from: ${url}`);

    try {
      const response = await axios.get(url);
      const data = response.data;

      // Extract Array and Sort by routeOrder
      let routesArray = Array.isArray(data) ? data : [data];
      routesArray.sort((a, b) => (a.routeOrder || 0) - (b.routeOrder || 0));

      if (routesArray.length > 0) {
        // Collect all unique stop IDs to fetch audio config
        const uniqueStopIds = new Set();
        routesArray.forEach(route => {
          if (route.stops) {
            route.stops.forEach(stop => uniqueStopIds.add(stop.id));
          }
        });

        if (uniqueStopIds.size > 0) {
          try {
            const qs = Array.from(uniqueStopIds).map(id => `stopIds=${id}`).join('&');
            const audioUrl = `${AppConfig.API_BASE_URL}/api/App/stop-audios?${qs}`;
            console.log(`[AUDIO] Fetching audio config from: ${audioUrl}`);
            const audioResponse = await axios.get(audioUrl);
            await AudioEngine.cacheRouteAudios(audioResponse.data);
          } catch (e) {
            console.error('[AUDIO] Failed to fetch or cache audio config:', e.message);
            Alert.alert('Audio Error', 'Failed to fetch audio config from the backend: ' + e.message);
          }
        }

        // Cache the routes for offline reboots
        await AsyncStorage.setItem(`@offline_routes_${bNum}`, JSON.stringify(routesArray));
        allRoutesRef.current = routesArray;

        // Recover last playing route in case of power failure
        let savedIndex = 0;
        try {
          const idxStr = await AsyncStorage.getItem('@current_route_index');
          if (idxStr !== null) {
            savedIndex = parseInt(idxStr, 10);
            if (savedIndex >= routesArray.length) savedIndex = 0;
          }
        } catch (e) { }

        currentIndexRef.current = savedIndex;
        console.log(`[ROUTE LOOP] Starting route cycle at index ${savedIndex} out of ${routesArray.length}`);

        loadRouteByIndex(savedIndex, routesArray);
      } else {
        setInitStatus('COMPLETE');
        Alert.alert('No Route Found', `No active route assigned for bus ${bNum}.`);
      }
    } catch (error) {
      console.error('[NETWORK] Error fetching route:', error.message);

      // Fallback to offline cached routes
      try {
        const offlineStr = await AsyncStorage.getItem(`@offline_routes_${bNum}`);
        if (offlineStr) {
          console.log('[ROUTE LOOP] API failed. Recovering routes from offline cache.');
          const routesArray = JSON.parse(offlineStr);
          allRoutesRef.current = routesArray;

          let savedIndex = 0;
          const idxStr = await AsyncStorage.getItem('@current_route_index');
          if (idxStr !== null) {
            savedIndex = parseInt(idxStr, 10);
            if (savedIndex >= routesArray.length) savedIndex = 0;
          }

          currentIndexRef.current = savedIndex;
          loadRouteByIndex(savedIndex, routesArray);
          return;
        }
      } catch (fallbackError) {
        console.error('[NETWORK] Offline fallback failed:', fallbackError.message);
      }

      setInitStatus('COMPLETE');
      Alert.alert('Network Error', `Could not fetch route for ${bNum}. Please connect to internet to sync initial data.`);
    }
  };

  const [tapCount, setTapCount] = useState(0);
  const tapTimeoutRef = useRef(null);

  // Capture dynamic heights of each stop row to perfectly position the bus marker on the line
  const [rowHeights, setRowHeights] = useState({});
  const scrollViewRef = useRef(null);
  const stopYPositions = useRef({});

  const handleLogoTap = () => {
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
    }

    const newCount = tapCount + 1;
    setTapCount(newCount);

    if (newCount >= 7) {
      setTapCount(0);
      stopTracking();
      navigation.navigate('Settings');
    } else {
      tapTimeoutRef.current = setTimeout(() => {
        setTapCount(0);
      }, 2000); // Reset tap count after 2 seconds
    }
  };

  const startRoute = async (routeData, preBuiltStops = null) => {
    const fullStops = preBuiltStops || (routeData.stops || []);

    stateRef.current.stops = fullStops;
    stateRef.current.nextStopIndex = 0;
    stateRef.current.stopState = 'IDLE';
    stateRef.current.hasAnnouncedReaching = false;
    stateRef.current.hasTriggeredRouteComplete = false;

    setInitStatus('COMPLETE');
    startTracking();
  };
  // Note: startTracking and stopTracking are now safely handled by useGpsEngine and returned to the component.};

  if (showDestinationScreen) {
    return (
      <View style={[styles.container, styles.centerAll, { backgroundColor: '#00285D' }]}>
        <Ionicons name="location-sharp" size={80} color="#FFD700" style={{ marginBottom: 20 }} />
        <Text style={{ fontSize: 24, color: '#E2E2E2', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 2 }}>
          Destination Reached
        </Text>
        <Text style={{ fontSize: 36, color: '#FFF', fontWeight: '900', marginTop: 10, textAlign: 'center' }}>
          {destinationName}
        </Text>
      </View>
    );
  }

  if (initStatus !== 'COMPLETE') {
    return (
      <View style={[styles.container, styles.centerAll]}>
        <ActivityIndicator size="large" color="#4D8EFF" />
        <Text style={[styles.loadingText, { marginBottom: 30 }]}>Booting System...</Text>

        <View style={{ width: 260 }}>
          {/* Route Status */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
            {initStatus === 'FETCHING_ROUTE' ? (
              <ActivityIndicator size="small" color="#4D8EFF" style={{ marginRight: 15 }} />
            ) : (
              <Ionicons name="checkmark-circle" size={24} color="#4D8EFF" style={{ marginRight: 15 }} />
            )}
            <Text style={{ color: '#E2E2E2', fontSize: 16 }}>1. Fetching Route Data</Text>
          </View>

          {/* Ad Status */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {initStatus === 'DOWNLOADING_ADS' ? (
              <ActivityIndicator size="small" color="#FFD700" style={{ marginRight: 15 }} />
            ) : (
              <Ionicons name="ellipse-outline" size={24} color="#555" style={{ marginRight: 15 }} />
            )}
            <View>
              <Text style={{ color: initStatus === 'DOWNLOADING_ADS' ? '#FFD700' : '#888', fontSize: 16 }}>
                2. Syncing Ad Cache
              </Text>
              {initStatus === 'DOWNLOADING_ADS' && adDownloadStatus ? (
                <Text style={{ color: '#aaa', fontSize: 12, marginTop: 4 }}>
                  {adDownloadStatus}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    );
  }

  if (!selectedRoute) {
    return (
      <View style={[styles.container, styles.centerAll]}>
        <TouchableOpacity onPress={handleLogoTap}>
          <Text style={styles.logo}>E-Vazhi</Text>
        </TouchableOpacity>
        <Text style={styles.loadingText}>No active route available for bus {busNumber}.</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => loadSetup()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const nextStopObj = selectedRoute.stops[stateRef.current.nextStopIndex] || { name: 'End Point' };

  return (
    <View style={[styles.container, isLandscape ? styles.row : styles.column]}>
      {/* Sidebar / Info Panel */}
      <View style={[styles.sidePanel, isLandscape ? { width: 400 } : { height: '50%' }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleLogoTap}>
            <Text style={styles.logo}>E-Vazhi</Text>
          </TouchableOpacity>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.busInfo}>Bus: {busNumber}</Text>
          </View>
        </View>

        {/* Big Heading */}
        <View style={{ marginBottom: 30 }}>
          <Text style={{ color: '#E2E2E2', fontSize: 40, fontWeight: '900', lineHeight: 45, textTransform: 'uppercase' }}>
            {stateRef.current.stops[0]?.name || 'Origin'} To{'\n'}{stateRef.current.stops[stateRef.current.stops.length - 1]?.name || 'Destination'}
          </Text>
        </View>

        <ScrollView ref={scrollViewRef} style={{ flex: 1, paddingLeft: 10, marginBottom: 0 }}>
          {stateRef.current.stops.map((stop, index) => {
            // Keep only the last 2 visited stops, the next stop, and all future stops
            if (index < stateRef.current.nextStopIndex - 2) return null;

            const totalStops = stateRef.current.stops.length;
            // Use pre-computed stop progress values if available, fall back to equal distribution
            const stopProgress = stopProgressValues.current[index] ?? (totalStops > 1 ? index / (totalStops - 1) : 0);
            const nextStopProgress = stopProgressValues.current[index + 1] ?? (totalStops > 1 ? (index + 1) / (totalStops - 1) : 1);

            const isActive = index === stateRef.current.nextStopIndex;
            const isPast = index < stateRef.current.nextStopIndex;

            // Is bus currently in this segment?
            const isLastSegment = index === totalStops - 2;
            const busHere = index < totalStops - 1
              && routeProgress >= stopProgress
              && (isLastSegment ? routeProgress <= nextStopProgress : routeProgress < nextStopProgress);

            // How far along this segment (0–1) for positioning the bus icon on the line
            const segLen = nextStopProgress - stopProgress;
            const segmentT = busHere && segLen > 0
              ? Math.min(1, Math.max(0, (routeProgress - stopProgress) / segLen))
              : 0;

            let iconBg = '#353535';
            if (isActive || isPast) iconBg = '#4D8EFF';

            const H = rowHeights[index] || 70; // fallback height if not yet measured

            return (
              <View key={stop.id || index.toString()}>
                {/* ── Stop row ── */}
                <View
                  style={{ flexDirection: 'row', marginBottom: 0, minHeight: 60 }}
                  onLayout={e => {
                    const { y, height } = e.nativeEvent.layout;
                    stopYPositions.current[index] = y;
                    if (rowHeights[index] !== height) setRowHeights(prev => ({ ...prev, [index]: height }));
                  }}
                >
                  {/* Timeline graphics */}
                  <View style={{ alignItems: 'center', width: 40, marginRight: 15 }}>
                    <View style={{
                      width: 32, height: 32, borderRadius: 16,
                      backgroundColor: iconBg,
                      justifyContent: 'center', alignItems: 'center', zIndex: 2
                    }}>
                      {isActive ? (
                        <Ionicons name="navigate" size={16} color="#00285D" />
                      ) : isPast ? (
                        <Ionicons name="checkmark" size={16} color="#131313" />
                      ) : (
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#131313' }} />
                      )}
                    </View>
                    {/* Connector line */}
                    {index < totalStops - 1 && (
                      <View style={{
                        width: 2,
                        backgroundColor: isPast ? '#4D8EFF' : '#353535',
                        position: 'absolute',
                        top: 32,
                        height: Math.max(0, H - 32),
                        zIndex: 1
                      }} />
                    )}

                    {/* Bus icon on the vertical line */}
                    {busHere && (
                      <View style={{
                        position: 'absolute',
                        // Smoothly interpolate center of current node to center of next node
                        top: 5 + (segmentT * H),
                        zIndex: 5,
                        width: 22, height: 22, borderRadius: 11,
                        backgroundColor: '#FFD700',
                        justifyContent: 'center', alignItems: 'center',
                        shadowColor: '#FFD700', shadowOpacity: 1, shadowRadius: 6,
                        elevation: 6,
                        borderWidth: 1.5, borderColor: '#FFF',
                      }}>
                        <Ionicons name="bus" size={12} color="#131313" />
                      </View>
                    )}
                  </View>

                  {/* Text */}
                  <View style={{ flex: 1, paddingTop: isActive ? 0 : 5, paddingBottom: 20 }}>
                    {isActive && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                        <View style={{ backgroundColor: '#4D8EFF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
                          <Text style={{ color: '#00285D', fontSize: 10, fontWeight: 'bold' }}>NEXT STOP</Text>
                        </View>
                      </View>
                    )}

                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingRight: 20 }}>
                      <Text style={{
                        color: isActive ? '#4D8EFF' : isPast ? '#444' : '#E2E2E2',
                        fontSize: isActive ? 20 : 16,
                        fontWeight: isActive ? 'bold' : 'normal',
                        textTransform: 'uppercase',
                      }}>
                        {stop.name || 'Unknown Stop'}
                      </Text>

                      {/* Individual Dynamic Stop ETA */}
                      {!isPast && etaValues[index] && (
                        <Text style={{ color: isActive ? '#4D8EFF' : '#888', fontSize: 12, fontWeight: 'bold' }}>
                          {etaValues[index]}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>

      {/* Map Section */}
      <View style={styles.mapContainer}>
        <BusMap
          style={styles.map}
          currentLocation={currentLocation}
          selectedRoute={selectedRoute}
          stops={stateRef.current.stops}
          nextStopIndex={stateRef.current.nextStopIndex}
          polylineCoords={polylineCoords}
          routeProgress={routeProgress}
          mapDarkStyle={mapDarkStyle}
        />

        {/* GPS Overlay top-right (Icon only) */}
        <View style={{
          position: 'absolute',
          top: 20,
          right: 20,
          backgroundColor: 'rgba(13, 31, 60, 0.85)',
          padding: 12,
          borderRadius: 24,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 6,
          elevation: 5,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <MaterialCommunityIcons name="satellite-variant" size={20} color={gpsStatus === 'CONNECTED' ? '#00FF00' : (gpsStatus === 'NO USB DEVICE' || gpsStatus === 'PERMISSION DENIED' ? '#FF4444' : '#FFD700')} />
            <Text style={{ color: '#888', marginLeft: 8, fontSize: 12 }}>GPS</Text>
          </View>
        </View>

        {/* ETA Overlay at the bottom */}
        <View style={{
          position: 'absolute',
          bottom: 30,
          alignSelf: 'center',
          backgroundColor: 'rgba(13, 31, 60, 0.9)',
          paddingHorizontal: 24,
          paddingVertical: 14,
          borderRadius: 20,
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: 'rgba(77, 142, 255, 0.3)',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.5,
          shadowRadius: 10,
          elevation: 8,
        }}>
          <View style={{
            width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(77, 142, 255, 0.2)',
            justifyContent: 'center', alignItems: 'center', marginRight: 15
          }}>
            <Ionicons name="time" size={20} color="#4D8EFF" />
          </View>
          <View>
            <Text style={{ color: '#888', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 }}>ETA TO DESTINATION</Text>
            <Text style={{ color: '#E2E2E2', fontSize: 22, fontWeight: '900' }}>
              {liveEtaText || `${Math.max(1, Math.ceil(45 * (1 - routeProgress)))} MINS`}
            </Text>
          </View>
        </View>
      </View>

      {/* Full Screen Ad Overlay */}
      {currentAd ? (
        <View style={[StyleSheet.absoluteFillObject, { zIndex: 100, backgroundColor: '#000' }]}>
          <Video
            key={currentAd.playbackId || currentAd.adId}
            ref={videoRef}
            source={{ uri: currentAd.localUri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode={ResizeMode.COVER}
            shouldPlay={true}
            isMuted={false}
            onPlaybackStatusUpdate={(status) => {
              if (status.didJustFinish) {
                onAdComplete(currentAd);
              }
            }}
          />
          {/* Bottom Info Ticker - Glassmorphism Pill */}
          <View style={{
            position: 'absolute', bottom: 22, left: 18, right: 18, zIndex: 102,
            backgroundColor: 'rgba(20, 20, 30, 0.72)',
            borderRadius: 50,
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.13)',
            paddingVertical: 14,
            paddingHorizontal: 22,
            flexDirection: 'row',
            alignItems: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.45,
            shadowRadius: 20,
            elevation: 18,
            overflow: 'hidden',
          }}>

            {/* Brand – pinned left */}
            <Text style={{
              color: '#4D8EFF',
              fontWeight: '900',
              fontSize: 18,
              letterSpacing: 0.5,
              minWidth: 80,
            }}>E-Vazhi</Text>

            {/* Next Stop – centered */}
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 17, fontWeight: '400' }}>Next Stop </Text>
              <Text style={{
                color: '#FFFFFF',
                fontSize: 24,
                fontWeight: '800',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}>
                {stateRef.current.stops[stateRef.current.nextStopIndex]?.name || 'Destination'}
              </Text>
            </View>

            {/* ETA – pinned right */}
            <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 80, justifyContent: 'flex-end' }}>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15, fontWeight: '400' }}>ETA </Text>
              <Text style={{
                color: '#FFD700',
                fontSize: 17,
                fontWeight: '900',
                letterSpacing: 0.3,
              }}>{liveEtaText || '—'}</Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* Custom Popup Pill */}
      {popupVisible && (
        <View style={[styles.modalContainer, { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'transparent' }]} pointerEvents="none">
          <View style={styles.popup}>
            <Text style={styles.popupText}>{popupMessage}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

// Minimal dark map style
const mapDarkStyle = [
  { "elementType": "geometry", "stylers": [{ "color": "#242f3e" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#746855" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#242f3e" }] },
  { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#38414e" }] },
  { "featureType": "road", "elementType": "geometry.stroke", "stylers": [{ "color": "#212a37" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#17263c" }] },
];

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#131313',
  },
  row: {
    flexDirection: 'row',
  },
  column: {
    flexDirection: 'column-reverse',
  },
  centerAll: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#E2E2E2',
    marginTop: 15,
    fontSize: 18,
  },
  sidePanel: {
    backgroundColor: '#131313',
    padding: 20,
    paddingBottom: 0,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  logo: {
    color: '#E2E2E2',
    fontSize: 24,
    fontWeight: '900', // Black
  },
  busInfo: {
    color: '#ADC6FF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  navTabs: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  tabActive: {
    backgroundColor: 'rgba(77,142,255,0.2)',
    borderRadius: 8,
  },
  tabText: {
    color: '#C2C6D6',
    fontWeight: 'bold',
  },
  tabTextActive: {
    color: '#4D8EFF',
    fontWeight: 'bold',
  },
  routeInfoBox: {
    backgroundColor: '#1C1C1C',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#4D8EFF',
  },
  routeStatus: {
    color: '#ADC6FF',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  routeName: {
    color: '#E2E2E2',
    fontSize: 28,
    fontWeight: '900',
  },
  nextStopBox: {
    backgroundColor: '#00285D',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
  },
  nextStopLabel: {
    color: '#ADC6FF',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  nextStopValue: {
    color: '#E2E2E2',
    fontSize: 24,
    fontWeight: 'bold',
  },
  durationBox: {
    backgroundColor: '#1C1C1C',
    padding: 15,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  durationLabel: {
    color: '#C2C6D6',
    fontSize: 12,
    fontWeight: 'bold',
  },
  durationValue: {
    color: '#E2E2E2',
    fontSize: 14,
    fontWeight: 'bold',
  },
  mapContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
  retryBtn: {
    marginTop: 20,
    backgroundColor: '#4D8EFF',
    padding: 15,
    borderRadius: 8,
  },
  retryText: {
    color: 'white',
    fontWeight: 'bold',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 50,
  },
  popup: {
    backgroundColor: 'rgba(77,142,255,0.9)',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 20,
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
  },
  popupText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center'
  }
});
