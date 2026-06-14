import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { getDistance } from 'geolib';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import BusMap from '../components/BusMap';

const API_BASE_URL = 'http://192.168.31.8:5148';

export default function BusModeScreen({ navigation, route }) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [busNumber, setBusNumber] = useState(route.params?.busNumber || '');
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const [currentLocation, setCurrentLocation] = useState(null);
  const [nextStopIndex, setNextStopIndex] = useState(0);

  // Polyline progress tracking
  const [routeProgress, setRouteProgress] = useState(0);
  const [polylineCoords, setPolylineCoords] = useState([]);
  const [busOnRoute, setBusOnRoute] = useState(false);
  const stopProgressValues = useRef([]); // each stop's 0–1 position along polyline

  const [popupVisible, setPopupVisible] = useState(false);
  const [popupMessage, setPopupMessage] = useState('');

  const [tapCount, setTapCount] = useState(0);
  const tapTimeoutRef = useRef(null);

  const locationSubscription = useRef(null);
  const stateRef = useRef({
    nextStopIndex: 0,
    stopState: 'IDLE',
    stops: []
  });

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

  // Standalone version for stop pre-computation (doesn't need closure over state)
  const ON_ROUTE_THRESHOLD = 200; // metres
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

  const fetchRouteForBus = async (bNum) => {

    const url = `${API_BASE_URL}/api/App/${bNum}`;
    console.log(`[NETWORK] Attempting to fetch route from: ${url}`);

    try {
      const response = await axios.get(url);
      console.log(`[NETWORK] Successfully fetched route data. Type: ${Array.isArray(response.data) ? 'Array' : 'Object'}`);

      const data = response.data;

      // If the API returns an array, take the first one, else assume it's the route object
      const routeData = Array.isArray(data) ? data[0] : data;

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
          if (routeData.origin) parsed.push(routeData.origin);
          (routeData.stops || []).forEach(s => s?.coordinate && parsed.push(s.coordinate));
          if (routeData.destination) parsed.push(routeData.destination);
        }
        console.log('[polyline] loaded', parsed.length, 'points');
        setPolylineCoords(parsed);

        const routeNameParts = (routeData.name || '').split('-');
        const derivedOriginName = routeNameParts[0]?.trim() || routeData.origin?.name || 'Start Point';
        const derivedDestName = routeNameParts[1]?.trim() || routeData.destination?.name || 'End Point';

        // Pre-compute each stop's progress value along the polyline
        const fullStops = [
          { id: 'origin', name: derivedOriginName, coordinate: routeData.origin },
          ...(routeData.stops || []),
          { id: 'destination', name: derivedDestName, coordinate: routeData.destination },
        ];
        stopProgressValues.current = fullStops.map(stop => {
          if (!stop?.coordinate) return 0;
          const { progress } = findProgressOnPolylineCoords(stop.coordinate, parsed);
          return progress;
        });
        console.log('[stops] progress values:', stopProgressValues.current);

        startRoute(routeData, fullStops);
      } else {
        setIsLoading(false);
        Alert.alert('No Route Found', `No active route assigned for bus ${bNum}.`);
      }
    } catch (error) {
      console.error('[NETWORK] Error fetching route:', error.message);
      if (error.response) {
        console.error('[NETWORK] Error Response Status:', error.response.status);
        console.error('[NETWORK] Error Response Data:', error.response.data);
      } else if (error.request) {
        console.error('[NETWORK] No response received. CORS issue or server down?');
      }
      setIsLoading(false);
      Alert.alert('Network Error', `Could not fetch route for ${bNum}. Check console for details.`);
    }
  };

  const handleLogoTap = () => {
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
    }

    const newCount = tapCount + 1;
    setTapCount(newCount);

    if (newCount >= 7) {
      setTapCount(0);
      Alert.alert(
        'Reset Configuration',
        'Are you sure you want to reset the bus number?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reset',
            style: 'destructive',
            onPress: async () => {
              await AsyncStorage.removeItem('@bus_number');
              stopTracking();
              navigation.replace('Setup');
            }
          }
        ]
      );
    } else {
      tapTimeoutRef.current = setTimeout(() => {
        setTapCount(0);
      }, 2000); // Reset tap count after 2 seconds
    }
  };

  const showPopup = (msg, duration = 3000) => {
    setPopupMessage(msg);
    setPopupVisible(true);
    Speech.speak(msg, { rate: 0.9 });
    setTimeout(() => {
      setPopupVisible(false);
    }, duration);
  };

  const startRoute = async (routeData, preBuiltStops = null) => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setIsLoading(false);
      Alert.alert('Permission denied', 'Location permission is required.');
      return;
    }

    const currentLoc = await Location.getCurrentPositionAsync({});
    setCurrentLocation({
      latitude: currentLoc.coords.latitude,
      longitude: currentLoc.coords.longitude,
    });

    const routeNameParts = (routeData.name || '').split('-');
    const derivedOriginName = routeNameParts[0]?.trim() || routeData.origin?.name || 'Start Point';
    const derivedDestName = routeNameParts[1]?.trim() || routeData.destination?.name || 'End Point';

    const fullStops = preBuiltStops || [
      { id: 'origin',      name: derivedOriginName, coordinate: routeData.origin      },
      ...(routeData.stops || []),
      { id: 'destination', name: derivedDestName,   coordinate: routeData.destination },
    ];

    stateRef.current.stops = fullStops;
    stateRef.current.nextStopIndex = 0;
    stateRef.current.stopState = 'IDLE';

    setIsLoading(false);
    showPopup('Journey Initialized');
    startTracking();
  };

  const startTracking = async () => {
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
        const { progress, onRoute } = findProgressOnPolylineCoords(loc, polylineCoords);
        setRouteProgress(progress);
        setBusOnRoute(onRoute);

        // Auto-detect next stop: first stop whose polyline position is ahead of the bus
        const stopVals = stopProgressValues.current;
        if (stopVals.length > 0) {
          const newNextIdx = stopVals.findIndex(sp => sp > progress + 0.005);
          const resolvedIdx = newNextIdx === -1 ? stopVals.length - 1 : newNextIdx;
          if (resolvedIdx !== stateRef.current.nextStopIndex) {
            const stops = stateRef.current.stops;
            stateRef.current.nextStopIndex = resolvedIdx;
            setNextStopIndex(resolvedIdx);
            if (stops[resolvedIdx]) {
              showPopup(`Next stop: ${stops[resolvedIdx].name}`);
            }
          }
        }

        console.log(`[bus] ${(progress * 100).toFixed(1)}% | onRoute:${onRoute} | nextStop:${stateRef.current.nextStopIndex}`);
      }
    );
  };

  const stopTracking = () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centerAll]}>
        <ActivityIndicator size="large" color="#4D8EFF" />
        <Text style={styles.loadingText}>Initializing Journey...</Text>
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
          <Text style={styles.busInfo}>Bus: {busNumber}</Text>
        </View>

        {/* Big Heading */}
        <View style={{ marginBottom: 30 }}>
          <Text style={{ color: '#ADC6FF', fontSize: 10, fontWeight: 'bold', letterSpacing: 1, marginBottom: 5 }}>INITIALIZING JOURNEY</Text>
          <Text style={{ color: '#E2E2E2', fontSize: 40, fontWeight: '900', lineHeight: 45, textTransform: 'capitalize' }}>
            {stateRef.current.stops[0]?.name || 'Origin'} To{'\n'}{stateRef.current.stops[stateRef.current.stops.length - 1]?.name || 'Destination'}
          </Text>
        </View>

        <ScrollView style={{ flex: 1, paddingLeft: 10, marginBottom: 20 }}>
          {stateRef.current.stops.map((stop, index) => {
            const totalStops = stateRef.current.stops.length;
            // Use pre-computed stop progress values if available, fall back to equal distribution
            const stopProgress     = stopProgressValues.current[index]     ?? (totalStops > 1 ? index / (totalStops - 1) : 0);
            const nextStopProgress = stopProgressValues.current[index + 1] ?? (totalStops > 1 ? (index + 1) / (totalStops - 1) : 1);

            const isActive = index === stateRef.current.nextStopIndex;
            const isPast   = index < stateRef.current.nextStopIndex;

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

            return (
              <View key={stop.id || index.toString()}>
                {/* ── Stop row ── */}
                <View style={{ flexDirection: 'row', marginBottom: 0, minHeight: 60 }}>
                  {/* Timeline graphics */}
                  <View style={{ alignItems: 'center', width: 40, marginRight: 15 }}>
                    <View style={{
                      width: 32, height: 32, borderRadius: 10,
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
                        position: 'absolute', top: 32, bottom: -25, zIndex: 1
                      }} />
                    )}

                    {/* Bus icon on the vertical line */}
                    {busHere && (
                      <View style={{
                        position: 'absolute',
                        top: 32 + segmentT * 50,
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
                  <View style={{ flex: 1, paddingTop: 2, paddingBottom: 25 }}>
                    {isActive && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                        <View style={{ backgroundColor: '#4D8EFF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
                          <Text style={{ color: '#00285D', fontSize: 10, fontWeight: 'bold' }}>NEXT STOP</Text>
                        </View>
                      </View>
                    )}
                    {!isActive && <Text style={{ color: '#555', fontSize: 12, marginBottom: 2 }}> </Text>}
                    <Text style={{
                      color: isActive ? '#E2E2E2' : (isPast ? '#888' : '#555'),
                      fontSize: isActive ? 22 : 18,
                      fontWeight: '900',
                      textTransform: 'uppercase'
                    }}>
                      {stop.name || 'Unknown Stop'}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>

        {/* Bottom tray: Next Stop + Destination + progress */}
        <View style={{ backgroundColor: '#0D1F3C', padding: 12, borderTopWidth: 1, borderTopColor: '#1A2A40' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#4D8EFF', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 }}>NEXT STOP</Text>
              <Text style={{ color: '#E2E2E2', fontSize: 15, fontWeight: '900' }} numberOfLines={1}>
                {stateRef.current.stops[nextStopIndex]?.name || '—'}
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color="#2A3A55" style={{ marginHorizontal: 10 }} />
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={{ color: '#888', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 }}>DESTINATION</Text>
              <Text style={{ color: '#888', fontSize: 15, fontWeight: '900' }} numberOfLines={1}>
                {stateRef.current.stops[stateRef.current.stops.length - 1]?.name || '—'}
              </Text>
            </View>
          </View>
          <View style={{ height: 3, backgroundColor: '#1A2A40', borderRadius: 2 }}>
            <View style={{ width: `${(routeProgress * 100).toFixed(0)}%`, height: '100%', backgroundColor: '#4D8EFF', borderRadius: 2 }} />
          </View>
        </View>
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
      </View>

      {/* Custom Popup Modal */}
      <Modal transparent={true} visible={popupVisible} animationType="fade">
        <View style={styles.modalContainer}>
          <View style={styles.popup}>
            <Text style={styles.popupText}>{popupMessage}</Text>
          </View>
        </View>
      </Modal>
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
