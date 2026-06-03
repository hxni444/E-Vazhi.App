import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, useWindowDimensions, ActivityIndicator, Platform, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import { getDistance } from 'geolib';
import axios from 'axios';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
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
        startRoute(routeData);
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

  const startRoute = async (routeData) => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setIsLoading(false);
      Alert.alert('Permission denied', 'Location permission is required.');
      return;
    }

    const currentLoc = await Location.getCurrentPositionAsync({});
    setCurrentLocation({
      latitude: currentLoc.coords.latitude,
      longitude: currentLoc.coords.longitude
    });

    const fullStops = [
      { id: 'origin', name: 'Start Point', coordinate: routeData.origin },
      ...(routeData.stops || []),
      { id: 'destination', name: 'End Point', coordinate: routeData.destination }
    ];

    stateRef.current.stops = fullStops;
    stateRef.current.nextStopIndex = 0;
    stateRef.current.stopState = 'IDLE';
    
    setIsLoading(false);
    showPopup("Journey Initialized");
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
        setCurrentLocation({ latitude, longitude });
        checkProximity({ latitude, longitude });
      }
    );
  };

  const stopTracking = () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
  };

  const checkProximity = (currentLocation) => {
    const { stops, nextStopIndex, stopState } = stateRef.current;
    
    if (nextStopIndex >= stops.length) return;

    const targetStop = stops[nextStopIndex];
    const distance = getDistance(currentLocation, targetStop.coordinate);

    if (stopState === 'IDLE') {
      if (distance <= 100) {
        showPopup(`Approaching ${targetStop.name}`);
        stateRef.current.stopState = 'APPROACHING';
      }
      else if (nextStopIndex + 1 < stops.length) {
        const nextStop = stops[nextStopIndex + 1];
        const distanceToNext = getDistance(currentLocation, nextStop.coordinate);
        
        if (distanceToNext <= 150 && distanceToNext < distance) {
          showPopup(`Skipped ${targetStop.name}. Next stop is ${nextStop.name}`);
          stateRef.current.nextStopIndex = nextStopIndex + 1;
          stateRef.current.stopState = 'IDLE';
          setNextStopIndex(nextStopIndex + 1);
        }
      }
    } 
    else if (stopState === 'APPROACHING') {
      if (distance <= 40) {
        stateRef.current.stopState = 'AT_STOP';
      }
      else if (distance > 150) {
        goToNextStop(stops);
      }
    }
    else if (stopState === 'AT_STOP') {
      if (distance >= 50) {
        goToNextStop(stops);
      }
    }
  };

  const goToNextStop = (stops) => {
    const newNext = stateRef.current.nextStopIndex + 1;
    if (newNext < stops.length) {
      stateRef.current.nextStopIndex = newNext;
      stateRef.current.stopState = 'IDLE';
      setNextStopIndex(newNext);
      showPopup(`Next stop is ${stops[newNext].name}`);
    } else {
      showPopup(`Route completed.`);
      stopTracking();
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
             {selectedRoute.origin?.name} To{'\n'}{selectedRoute.destination?.name}
           </Text>
        </View>

        <ScrollView style={{ flex: 1, paddingLeft: 10, marginBottom: 20 }}>
          {stateRef.current.stops.map((stop, index) => {
            const isActive = index === stateRef.current.nextStopIndex;
            const isPast = index < stateRef.current.nextStopIndex;
            
            let iconBg = '#353535';
            if (isActive) iconBg = '#4D8EFF';
            else if (isPast) iconBg = '#4D8EFF';

            return (
              <View key={stop.id || index.toString()} style={{ flexDirection: 'row', marginBottom: 25, minHeight: 60 }}>
                {/* Timeline graphics */}
                <View style={{ alignItems: 'center', width: 40, marginRight: 15 }}>
                  <View style={{
                    width: 32, height: 32, borderRadius: 10, 
                    backgroundColor: iconBg,
                    justifyContent: 'center', alignItems: 'center',
                    zIndex: 2
                  }}>
                    {isActive ? (
                      <Ionicons name="navigate" size={16} color="#00285D" />
                    ) : isPast ? (
                      <Ionicons name="checkmark" size={16} color="#131313" />
                    ) : (
                      <View style={{width: 10, height: 10, borderRadius: 5, backgroundColor: '#131313'}} />
                    )}
                  </View>
                  
                  {index < stateRef.current.stops.length - 1 && (
                    <View style={{
                      width: 2, 
                      backgroundColor: isPast ? '#4D8EFF' : '#353535', 
                      position: 'absolute', top: 32, bottom: -25, zIndex: 1
                    }} />
                  )}
                </View>

                {/* Text */}
                <View style={{ flex: 1, paddingTop: 2 }}>
                  {isActive && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                      <View style={{ backgroundColor: '#4D8EFF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginRight: 10 }}>
                        <Text style={{ color: '#00285D', fontSize: 10, fontWeight: 'bold' }}>NEXT STOP</Text>
                      </View>
                    </View>
                  )}
                  {!isActive && <Text style={{ color: '#555', fontSize: 12, fontWeight: 'bold', marginBottom: 2 }}> </Text>}
                  
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
            );
          })}
        </ScrollView>

        {/* Trip Duration Box */}
        <View style={{
          backgroundColor: '#1C1C1C',
          padding: 20,
          borderLeftWidth: 5,
          borderLeftColor: '#4D8EFF',
        }}>
          <Text style={{ color: '#C2C6D6', fontSize: 10, fontWeight: 'bold', letterSpacing: 1, marginBottom: 5 }}>TRIP DURATION</Text>
          <Text style={{ color: '#E2E2E2', fontSize: 16, fontWeight: '900' }}>ESTIMATED JOURNEY: 45 MINS</Text>
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
