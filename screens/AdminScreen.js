import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import * as Location from 'expo-location';
import { saveRoute, getRoutes, deleteRoute } from '../utils/storage';

// PLACEHOLDER API KEY - MUST BE REPLACED
const GOOGLE_MAPS_API_KEY = 'AIzaSyDkFUEFSGSBNqZDANYOxFU-GjTmNjBHR0k';

export default function AdminScreen({ navigation }) {
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [stops, setStops] = useState([]);
  const [waypoints, setWaypoints] = useState([]); // Invisible to passengers, forces route path
  const [routeName, setRouteName] = useState('');
  const [busId, setBusId] = useState('');
  const [mode, setMode] = useState('origin'); // origin, destination, stop, waypoint
  const [editingRouteId, setEditingRouteId] = useState(null);
  const mapRef = useRef(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [tempStopCoordinate, setTempStopCoordinate] = useState(null);
  const [stopNameInput, setStopNameInput] = useState('');

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Permission to access location was denied');
      }
    })();
  }, []);

  // Routes Modal State
  const [routesModalVisible, setRoutesModalVisible] = useState(false);
  const [savedRoutes, setSavedRoutes] = useState([]);

  const loadSavedRoutes = async () => {
    const data = await getRoutes();
    setSavedRoutes(data);
    setRoutesModalVisible(true);
  };

  const handleDeleteRoute = async (id) => {
    Alert.alert("Confirm Delete", "Are you sure you want to delete this route?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
          const success = await deleteRoute(id);
          if (success) {
            setSavedRoutes(savedRoutes.filter(r => r.id !== id));
            if (editingRouteId === id) setEditingRouteId(null);
          } else {
            Alert.alert("Error", "Failed to delete route");
          }
        }
      }
    ]);
  };

  const handleEditRoute = (route) => {
    setOrigin(route.origin);
    setDestination(route.destination);
    setWaypoints(route.waypoints || []);
    setStops(route.stops || []);
    setRouteCoordinates(route.polyline || []);
    setRouteName(route.name || '');
    setBusId(route.busId || '');
    setEditingRouteId(route.id);
    setRoutesModalVisible(false);
  };

  const handleCreateReturnRoute = () => {
    if (!origin || !destination) {
      Alert.alert("Error", "Need an origin and destination to create return route");
      return;
    }
    Alert.alert(
      "Create Return Route",
      "This will swap origin and destination, reverse stops and waypoints. The map will fetch a new path. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Yes", onPress: () => {
            const newOrigin = destination;
            const newDestination = origin;
            const newWaypoints = [...waypoints].reverse();
            const newStops = [...stops].reverse();
            setOrigin(newOrigin);
            setDestination(newDestination);
            setWaypoints(newWaypoints);
            setStops(newStops);
            setRouteCoordinates([]);
            setRouteName(routeName ? routeName + " Return" : "");
          }
        }
      ]
    );
  };

  const moveStopUp = (index) => {
    if (index === 0) return;
    const newStops = [...stops];
    const temp = newStops[index - 1];
    newStops[index - 1] = newStops[index];
    newStops[index] = temp;
    setStops(newStops);
  };

  const moveStopDown = (index) => {
    if (index === stops.length - 1) return;
    const newStops = [...stops];
    const temp = newStops[index + 1];
    newStops[index + 1] = newStops[index];
    newStops[index] = temp;
    setStops(newStops);
  };

  const removeStop = (index) => {
    const newStops = [...stops];
    newStops.splice(index, 1);
    setStops(newStops);
  };

  const handleMapPress = (e) => {
    const coordinate = e.nativeEvent.coordinate;

    if (mode === 'origin') {
      setOrigin(coordinate);
      if (destination) {
        setMode('stop');
      } else {
        setMode('destination');
      }
    } else if (mode === 'destination') {
      setDestination(coordinate);
      setMode('waypoint');
    } else if (mode === 'waypoint') {
      if (!origin || !destination) {
        Alert.alert("Wait", "Please set origin and destination first");
        return;
      }
      setWaypoints([...waypoints, { latitude: coordinate.latitude, longitude: coordinate.longitude }]);
    } else if (mode === 'stop') {
      if (!origin || !destination) {
        Alert.alert("Wait", "Please set origin and destination first");
        return;
      }
      setTempStopCoordinate(coordinate);
      setStopNameInput(`Stop ${stops.length + 1}`);
      setModalVisible(true);
    }
  };

  const handleAddStopConfirm = () => {
    if (tempStopCoordinate && stopNameInput.trim()) {
      setStops([...stops, {
        id: `stop-${Date.now()}`,
        name: stopNameInput,
        coordinate: tempStopCoordinate
      }]);
    }
    setModalVisible(false);
    setTempStopCoordinate(null);
  };

  const clearMap = () => {
    setOrigin(null);
    setDestination(null);
    setRouteCoordinates([]);
    setStops([]);
    setWaypoints([]);
    setRouteName('');
    setBusId('');
    setEditingRouteId(null);
    setMode('origin');
  };

  const handleSaveRoute = async () => {
    if (!origin || !destination || routeCoordinates.length === 0) {
      Alert.alert("Error", "Please make sure a route is generated on the map.");
      return;
    }
    if (!routeName.trim() || !busId.trim()) {
      Alert.alert("Error", "Please enter Route Name and Bus ID.");
      return;
    }

    const routeData = {
      id: editingRouteId ? editingRouteId : `route-${Date.now()}`,
      name: routeName,
      busId: busId,
      origin,
      destination,
      polyline: routeCoordinates, // from Google directions
      stops,
      createdAt: new Date().toISOString()
    };

    const success = await saveRoute(routeData);
    if (success) {
      Alert.alert("Success", "Route saved successfully!");
      setEditingRouteId(null);
      navigation.goBack();
    } else {
      Alert.alert("Error", "Failed to save route");
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        onPress={handleMapPress}
        showsUserLocation={true}
        followsUserLocation={true}
        // Offset mapping to account for the search bar
        mapPadding={{ top: 80, right: 0, bottom: 0, left: 0 }}
        initialRegion={{
          latitude: 37.78825,
          longitude: -122.4324,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        }}
      >
        {origin && (
          <Marker 
            coordinate={origin} 
            pinColor="green" 
            title="Start" 
            draggable 
            onDragEnd={(e) => setOrigin(e.nativeEvent.coordinate)} 
          />
        )}
        {destination && (
          <Marker 
            coordinate={destination} 
            pinColor="red" 
            title="End" 
            draggable 
            onDragEnd={(e) => setDestination(e.nativeEvent.coordinate)} 
          />
        )}

        {stops.map((stop, index) => (
          <Marker
            key={stop.id}
            coordinate={stop.coordinate}
            pinColor="blue"
            title={stop.name}
            description="Bus Stop"
            draggable
            onDragEnd={(e) => {
              const newStops = [...stops];
              newStops[index].coordinate = e.nativeEvent.coordinate;
              setStops(newStops);
            }}
          />
        ))}

        {/* Waypoints are draggable markers that force the polyline route */}
        {waypoints.map((wp, index) => (
          <Marker
            key={`wp-${index}`}
            coordinate={wp}
            pinColor="orange"
            title={`Waypoint ${index + 1}`}
            description="Forces route path"
            draggable
            onDragEnd={(e) => {
              const newWaypoints = [...waypoints];
              newWaypoints[index] = e.nativeEvent.coordinate;
              setWaypoints(newWaypoints);
            }}
          />
        ))}

        {origin && destination && (
          <MapViewDirections
            origin={origin}
            destination={destination}
            waypoints={waypoints}
            apikey={GOOGLE_MAPS_API_KEY}
            strokeWidth={4}
            strokeColor="hotpink"
            onReady={result => {
              setRouteCoordinates(result.coordinates);
              mapRef.current.fitToCoordinates(result.coordinates, {
                edgePadding: { right: 50, bottom: 50, left: 50, top: 50 },
              });
            }}
            onError={(errorMessage) => {
              // If invalid API key, just draw a straight line
              console.log('Directions error:', errorMessage);
              setRouteCoordinates([origin, destination]);
            }}
          />
        )}

        {/* Fallback polyline if Directions API fails (e.g., no key) */}
        {routeCoordinates.length > 0 && GOOGLE_MAPS_API_KEY === 'YOUR_GOOGLE_MAPS_API_KEY' && (
          <Polyline
            coordinates={routeCoordinates}
            strokeColor="#000" // fallback color
            strokeWidth={4}
          />
        )}
      </MapView>

      <View style={styles.searchContainer}>
        <GooglePlacesAutocomplete
          placeholder='Search a place to jump to...'
          debounce={400}
          fetchDetails={true}
          onPress={(data, details = null) => {
            if (details) {
              const coord = {
                latitude: details.geometry.location.lat,
                longitude: details.geometry.location.lng,
              };
              mapRef.current?.animateToRegion({
                ...coord,
                latitudeDelta: 0.015,
                longitudeDelta: 0.0121,
              }, 1000);
            }
          }}
          query={{
            key: GOOGLE_MAPS_API_KEY,
            language: 'en',
          }}
          textInputProps={{
            placeholderTextColor: '#888',
          }}
          styles={{
            container: styles.autocompleteContainer,
            textInput: styles.autocompleteInput,
            listView: styles.autocompleteListView,
          }}
        />
      </View>

      <View style={styles.controlsContainer}>
        <Text style={styles.statusText}>
          Mode: <Text style={styles.bold}>{mode.toUpperCase()}</Text> - Tap on map to set
        </Text>

        <View style={styles.row}>
          <TouchableOpacity style={[styles.btn, styles.clearBtn]} onPress={clearMap}>
            <Text style={styles.btnText}>Clear Map</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, mode === 'waypoint' && styles.activeBtn]} onPress={() => setMode('waypoint')}>
            <Text style={styles.btnText}>Add Waypoint</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, mode === 'stop' && styles.activeBtn]} onPress={() => setMode('stop')}>
            <Text style={styles.btnText}>Add Stop</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.formContainer}>
          <TextInput
            style={styles.input}
            placeholder="Route Name (e.g. Morning City Loop)"
            placeholderTextColor="#888"
            value={routeName}
            onChangeText={setRouteName}
          />
          <TextInput
            style={styles.input}
            placeholder="Assigned Bus ID (e.g. Bus-01)"
            placeholderTextColor="#888"
            value={busId}
            onChangeText={setBusId}
          />
          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.saveBtn, { flex: 1, marginRight: 5 }]} onPress={handleSaveRoute}>
              <Text style={styles.saveBtnText}>Save Route</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.saveBtn, { flex: 1, backgroundColor: '#FF9800', marginLeft: 5 }]} onPress={handleCreateReturnRoute}>
              <Text style={styles.saveBtnText}>Flip for Return</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[styles.saveBtn, { backgroundColor: '#607D8B', marginTop: 10 }]} onPress={loadSavedRoutes}>
            <Text style={styles.saveBtnText}>View Saved Routes</Text>
          </TouchableOpacity>

          {stops.length > 0 && (
            <View style={styles.stopsListSection}>
              <Text style={styles.stopsListTitle}>Edit Stops Order:</Text>
              {stops.map((stop, index) => (
                <View key={stop.id} style={styles.stopListItem}>
                  <Text style={styles.stopListText} numberOfLines={1}>{index + 1}. {stop.name}</Text>
                  <View style={styles.stopListActions}>
                    <TouchableOpacity onPress={() => moveStopUp(index)} style={styles.iconBtn}>
                      <Text style={styles.iconText}>↑</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => moveStopDown(index)} style={styles.iconBtn}>
                      <Text style={styles.iconText}>↓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => removeStop(index)} style={[styles.iconBtn, {backgroundColor: '#f44336'}]}>
                      <Text style={styles.iconText}>X</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>

      {/* Add Stop Modal (Android Fix) */}
      <Modal transparent={true} visible={modalVisible} animationType="slide">
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
          style={styles.modalBg}
        >
          <View style={styles.modalPanel}>
             <Text style={styles.modalTitle}>Add Stop Point</Text>
             <TextInput 
               style={styles.modalInput}
               value={stopNameInput}
               onChangeText={setStopNameInput}
               placeholder="Enter stop name"
               placeholderTextColor="#888"
               autoFocus
             />
             <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setModalVisible(false)}>
                  <Text style={styles.btnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, styles.activeBtn]} onPress={handleAddStopConfirm}>
                  <Text style={styles.btnText}>Add</Text>
                </TouchableOpacity>
             </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* View Saved Routes Modal */}
      <Modal transparent={true} visible={routesModalVisible} animationType="slide">
        <View style={styles.routesModalBg}>
          <View style={styles.routesModalPanel}>
            <Text style={styles.modalTitle}>Saved Routes</Text>
            {savedRoutes.length === 0 ? (
              <Text style={{textAlign: 'center', marginVertical: 20}}>No routes saved.</Text>
            ) : (
              <ScrollView style={{maxHeight: 400}}>
                {savedRoutes.map(route => (
                  <View key={route.id} style={styles.routeItem}>
                    <View style={{flex: 1}}>
                      <Text style={styles.routeItemTitle}>{route.name}</Text>
                      <Text style={styles.routeItemSub}>Bus: {route.busId} | Stops: {route.stops?.length || 0}</Text>
                    </View>
                    <TouchableOpacity style={[styles.routeDeleteBtn, { backgroundColor: '#FF9800', marginRight: 5 }]} onPress={() => handleEditRoute(route)}>
                      <Text style={styles.btnText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.routeDeleteBtn} onPress={() => handleDeleteRoute(route.id)}>
                      <Text style={styles.btnText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity style={[styles.modalBtnCancel, {marginTop: 15, alignSelf: 'stretch', alignItems: 'center', marginRight: 0}]} onPress={() => setRoutesModalVisible(false)}>
              <Text style={styles.btnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  controlsContainer: {
    height: 300,
    backgroundColor: 'white',
    padding: 15,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 5,
  },
  statusText: {
    fontSize: 16,
    marginBottom: 10,
    textAlign: 'center'
  },
  bold: { fontWeight: 'bold', color: '#2196F3' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  btn: {
    padding: 10,
    backgroundColor: '#9e9e9e',
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 5,
    alignItems: 'center'
  },
  clearBtn: { backgroundColor: '#f44336' },
  activeBtn: { backgroundColor: '#4CAF50' },
  btnText: { color: 'white', fontWeight: 'bold' },
  formContainer: {
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  saveBtn: {
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 5,
  },
  saveBtnText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  // Search Bar Styles
  searchContainer: {
    position: 'absolute',
    top: 50,
    left: 10,
    right: 10,
    zIndex: 1,
  },
  autocompleteContainer: {
    flex: 1,
  },
  autocompleteInput: {
    height: 50,
    borderRadius: 8,
    paddingHorizontal: 15,
    fontSize: 16,
    backgroundColor: '#fff',
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  autocompleteListView: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginTop: 5,
    elevation: 3,
  },
  // Modal Styles
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  modalPanel: {
    backgroundColor: 'white',
    width: '85%',
    padding: 20,
    borderRadius: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    fontSize: 16
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  modalBtnCancel: { padding: 10, marginRight: 10, backgroundColor: '#9e9e9e', borderRadius: 8 },
  modalBtn: { padding: 10, paddingHorizontal: 20, borderRadius: 8 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  stopsListSection: { marginTop: 15, paddingBottom: 20 },
  stopsListTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  stopListItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f9f9f9', padding: 10, borderRadius: 6, marginBottom: 5, borderWidth: 1, borderColor: '#eee' },
  stopListText: { flex: 1, fontSize: 14 },
  stopListActions: { flexDirection: 'row' },
  iconBtn: { backgroundColor: '#ddd', width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', marginLeft: 5 },
  iconText: { fontWeight: 'bold', fontSize: 16, color: '#333' },
  routesModalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  routesModalPanel: { backgroundColor: 'white', width: '90%', maxHeight: '80%', padding: 20, borderRadius: 12 },
  routeItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  routeItemTitle: { fontSize: 16, fontWeight: 'bold' },
  routeItemSub: { fontSize: 13, color: '#666' },
  routeDeleteBtn: { backgroundColor: '#f44336', padding: 8, borderRadius: 6 }
});
