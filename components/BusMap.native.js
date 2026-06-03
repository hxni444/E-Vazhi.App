import React, { useRef, useEffect } from 'react';
import MapView, { Marker, Polyline } from 'react-native-maps';

export default function BusMap({ style, currentLocation, selectedRoute, stops, nextStopIndex, mapDarkStyle }) {
  const mapRef = useRef(null);

  useEffect(() => {
    if (currentLocation && mapRef.current) {
      mapRef.current.animateCamera({
        center: currentLocation,
        pitch: 60, // Slight vertical tilt (3D effect)
        heading: 0,
        altitude: 1000, // Important for iOS
        zoom: 15        // Important for Android
      }, { duration: 1000 });
    }
  }, [currentLocation]);

  return (
    <MapView
      ref={mapRef}
      style={style}
      showsUserLocation={true}
      followsUserLocation={false} // Disable default behavior to allow custom tilt tracking
      pitchEnabled={true}
      initialCamera={{
        center: {
          latitude: currentLocation?.latitude || selectedRoute.origin.latitude,
          longitude: currentLocation?.longitude || selectedRoute.origin.longitude,
        },
        pitch: 60,
        heading: 0,
        altitude: 1000,
        zoom: 15
      }}
      customMapStyle={mapDarkStyle}
    >
      {selectedRoute.polyline && (
        <Polyline coordinates={selectedRoute.polyline} strokeColor="#4D8EFF" strokeWidth={5} />
      )}
      {stops.map((stop, i) => (
         <Marker 
           key={stop.id || i} 
           coordinate={stop.coordinate}
           title={stop.name}
           pinColor={i === nextStopIndex ? "#ADC6FF" : (i < nextStopIndex ? "#555" : "#4D8EFF")}
         />
      ))}
    </MapView>
  );
}
