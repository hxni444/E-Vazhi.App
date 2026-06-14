import React, { useRef, useEffect, useState } from 'react';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function BusMap({
  style,
  currentLocation,
  stops         = [],
  nextStopIndex  = 0,
  polylineCoords = [],
  mapDarkStyle,
}) {
  const mapRef = useRef(null);

  // tracksViewChanges must be true on first render so the custom icon paints,
  // then we flip it off after 500ms to stop re-rendering on every GPS tick.
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  useEffect(() => {
    if (currentLocation) {
      const t = setTimeout(() => setTracksViewChanges(false), 500);
      return () => clearTimeout(t);
    }
  }, [!!currentLocation]); // only run once when location first arrives

  // Smoothly follow the bus
  useEffect(() => {
    if (currentLocation && mapRef.current) {
      mapRef.current.animateCamera({
        center:   currentLocation,
        pitch:    50,
        heading:  0,
        altitude: 800,
        zoom:     15,
      }, { duration: 800 });
    }
  }, [currentLocation]);

  const initialCenter = currentLocation
    || stops[0]?.coordinate
    || { latitude: 10.8505, longitude: 76.2711 };

  return (
    <MapView
      ref={mapRef}
      style={style || { flex: 1 }}
      provider={PROVIDER_GOOGLE}
      showsUserLocation={false}
      followsUserLocation={false}
      pitchEnabled={true}
      customMapStyle={mapDarkStyle}
      initialCamera={{
        center:   initialCenter,
        pitch:    50,
        heading:  0,
        altitude: 800,
        zoom:     13,
      }}
    >
      {/* Route polyline */}
      {polylineCoords.length > 1 && (
        <Polyline
          coordinates={polylineCoords}
          strokeColor="#4D8EFF"
          strokeWidth={5}
        />
      )}

      {/* Stop markers */}
      {stops.map((stop, i) => {
        if (!stop?.coordinate) return null;
        const isNext = i === nextStopIndex;
        const isPast = i < nextStopIndex;
        return (
          <Marker
            key={stop.id ?? i}
            coordinate={stop.coordinate}
            title={stop.name}
            pinColor={isNext ? '#FFD700' : (isPast ? '#444' : '#4D8EFF')}
          />
        );
      })}

      {/* Custom bus marker — tracksViewChanges starts true so the icon renders,
          then flips false to avoid performance issues on every GPS update */}
      {currentLocation && (
        <Marker
          coordinate={currentLocation}
          anchor={{ x: 0.5, y: 0.5 }}
          title="Bus"
          tracksViewChanges={tracksViewChanges}
          zIndex={999}
        >
          <View style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: '#FFD700',
            justifyContent: 'center',
            alignItems: 'center',
            borderWidth: 2,
            borderColor: '#FFF',
            elevation: 10,
            shadowColor: '#FFD700',
            shadowOpacity: 1,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 0 },
          }}>
            <Ionicons name="bus" size={24} color="#131313" />
          </View>
        </Marker>
      )}
    </MapView>
  );
}
