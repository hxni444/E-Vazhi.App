import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, FlatList, Modal } from 'react-native';
import * as Location from 'expo-location';
import { getDistance } from 'geolib';
import { getRoutes } from '../utils/storage';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Speech from 'expo-speech';

const START_PROXIMITY_RADIUS = 100; // meters. Allow bus to start if within 100m of start point
const STOP_PROXIMITY_RADIUS = 50;   // meters. "Reaching stop..." 

export default function BusModeScreen({ navigation }) {
  const [routes, setRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [isStarted, setIsStarted] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [nextStopIndex, setNextStopIndex] = useState(0);
  
  // Popup state
  const [popupVisible, setPopupVisible] = useState(false);
  const [popupMessage, setPopupMessage] = useState('');
  
  const locationSubscription = useRef(null);
  // To track state inside the location callback safely
  const stateRef = useRef({
    nextStopIndex: 0,
    stopState: 'IDLE',
    stops: []
  });

  useEffect(() => {
    loadRoutes();
    return () => stopTracking();
  }, []);

  const loadRoutes = async () => {
    const data = await getRoutes();
    setRoutes(data);
  };

  const showPopup = (msg, duration = 3000) => {
    setPopupMessage(msg);
    setPopupVisible(true);
    Speech.speak(msg, { rate: 0.9 });
    setTimeout(() => {
      setPopupVisible(false);
    }, duration);
  };

  const startRoute = async () => {
    if (!selectedRoute) {
      Alert.alert("Error", "Please select a route first.");
      return;
    }

    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission denied', 'Location permission is required.');
      return;
    }

    const currentLoc = await Location.getCurrentPositionAsync({});
    const startPoint = selectedRoute.origin;
    
    // Check if near start point
    const distanceToStart = getDistance(
      { latitude: currentLoc.coords.latitude, longitude: currentLoc.coords.longitude },
      startPoint
    );

    if (distanceToStart > START_PROXIMITY_RADIUS) {
      Alert.alert(
        "Too Far", 
        `You are ${distanceToStart}m away from the start point. Please move closer to the starting point to begin the route.`
      );
      return;
    }

    // Success - initialize state
    setIsStarted(true);
    setCurrentLocation({
      latitude: currentLoc.coords.latitude,
      longitude: currentLoc.coords.longitude
    });
    
    // Set initial stop list including origin and destination
    const fullStops = [
      { id: 'origin', name: 'Start Point', coordinate: selectedRoute.origin },
      ...(selectedRoute.stops || []),
      { id: 'destination', name: 'End Point', coordinate: selectedRoute.destination }
    ];

    stateRef.current.stops = fullStops;
    stateRef.current.nextStopIndex = 0;
    stateRef.current.stopState = 'IDLE';
    
    showPopup("Route Started.");

    // Start tracking
    startTracking();
  };

  const startTracking = async () => {
    locationSubscription.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 10, // Update every 10 meters
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
    
    if (nextStopIndex >= stops.length) return; // Route complete

    const targetStop = stops[nextStopIndex];
    const distance = getDistance(currentLocation, targetStop.coordinate);

    if (stopState === 'IDLE') {
      if (distance <= 100) {
        showPopup(`Approaching ${targetStop.name}`);
        stateRef.current.stopState = 'APPROACHING';
      }
      // Auto-skip logic
      else if (nextStopIndex + 1 < stops.length) {
        const nextStop = stops[nextStopIndex + 1];
        const distanceToNext = getDistance(currentLocation, nextStop.coordinate);
        
        // If we are within 150m of the next stop
        if (distanceToNext <= 150 && distanceToNext < distance) {
          showPopup(`Skipped ${targetStop.name}. Next stop is ${nextStop.name}`);
          stateRef.current.nextStopIndex = nextStopIndex + 1;
          stateRef.current.stopState = 'IDLE';
          setNextStopIndex(nextStopIndex + 1);
        }
      }
    } 
    else if (stopState === 'APPROACHING') {
      // If we get closer than 40m, we consider it properly arrived
      if (distance <= 40) {
        stateRef.current.stopState = 'AT_STOP';
      }
      // Fallback: if we drove away (>150m) without ever hitting 40m
      else if (distance > 150) {
        goToNextStop(stops);
      }
    }
    else if (stopState === 'AT_STOP') {
      // "getting out of stop 50m away we need to say the next stop"
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
      setNextStopIndex(newNext); // update UI
      showPopup(`Next stop is ${stops[newNext].name}`);
    } else {
      // Finished route
      showPopup(`Route completed at ${stops[stateRef.current.nextStopIndex].name}.`);
      stopTracking();
    }
  };

  const renderRouteItem = ({ item }) => (
    <TouchableOpacity 
      style={[
        styles.routeCard, 
        selectedRoute?.id === item.id && styles.selectedCard
      ]}
      onPress={() => setSelectedRoute(item)}
    >
      <Text style={styles.routeCardTitle}>{item.name}</Text>
      <Text style={styles.routeCardText}>Bus: {item.busId}</Text>
      <Text style={styles.routeCardText}>Stops: {item.stops.length}</Text>
    </TouchableOpacity>
  );

  if (isStarted) {
    return (
      <View style={styles.container}>
        <MapView
          style={styles.map}
          showsUserLocation={true}
          followsUserLocation={true}
          initialRegion={{
            latitude: currentLocation?.latitude || selectedRoute.origin.latitude,
            longitude: currentLocation?.longitude || selectedRoute.origin.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
        >
          {selectedRoute.polyline && (
            <Polyline coordinates={selectedRoute.polyline} strokeColor="hotpink" strokeWidth={4} />
          )}
          {selectedRoute.stops.map((stop, i) => (
             <Marker 
               key={stop.id} 
               coordinate={stop.coordinate}
               title={stop.name}
               pinColor={i === stateRef.current.nextStopIndex ? "yellow" : (i < stateRef.current.nextStopIndex ? "gray" : "blue")}
             />
          ))}
        </MapView>
        
        <View style={styles.hudContainer}>
          <Text style={styles.hudTitle}>Route: {selectedRoute.name}</Text>
          {stateRef.current.nextStopIndex < selectedRoute.stops.length ? (
            <Text style={styles.hudText}>
              Next Stop: {selectedRoute.stops[stateRef.current.nextStopIndex].name}
            </Text>
          ) : (
            <Text style={styles.hudText}>Route Completed</Text>
          )}
          
          <TouchableOpacity style={styles.stopBtn} onPress={() => { stopTracking(); setIsStarted(false); }}>
            <Text style={styles.stopBtnText}>End Route</Text>
          </TouchableOpacity>
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Select a Route</Text>
      
      {routes.length === 0 ? (
        <Text style={styles.emptyText}>No routes found. Go to Admin Mode to create one.</Text>
      ) : (
        <FlatList
          data={routes}
          keyExtractor={item => item.id}
          renderItem={renderRouteItem}
          style={styles.list}
        />
      )}

      <TouchableOpacity 
        style={[styles.startBtn, !selectedRoute && styles.disabledBtn]} 
        onPress={startRoute}
        disabled={!selectedRoute}
      >
        <Text style={styles.startBtnText}>Start Route</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: { fontSize: 20, fontWeight: 'bold', padding: 20, textAlign: 'center' },
  list: { paddingHorizontal: 15 },
  routeCard: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    elevation: 2,
  },
  selectedCard: {
    borderColor: '#4CAF50',
    backgroundColor: '#e8f5e9'
  },
  routeCardTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 5 },
  routeCardText: { fontSize: 14, color: '#666' },
  emptyText: { textAlign: 'center', marginTop: 50, color: '#888' },
  startBtn: {
    backgroundColor: '#4CAF50',
    padding: 15,
    margin: 20,
    borderRadius: 8,
    alignItems: 'center',
  },
  disabledBtn: { backgroundColor: '#a5d6a7' },
  startBtnText: { color: 'white', fontSize: 18, fontWeight: 'bold' },
  
  // HUD
  map: { flex: 1 },
  hudContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 5,
  },
  hudTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 5 },
  hudText: { fontSize: 16, color: '#555', marginBottom: 15 },
  stopBtn: { backgroundColor: '#f44336', padding: 15, borderRadius: 8, alignItems: 'center' },
  stopBtnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  // Modal
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  popup: {
    backgroundColor: '#333',
    padding: 25,
    borderRadius: 12,
    alignItems: 'center',
    maxWidth: '80%',
  },
  popupText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center'
  }
});
