import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function BusMap({ style, currentLocation, selectedRoute, stops, nextStopIndex, mapDarkStyle }) {
  return (
    <View style={[style, styles.centerAll]}>
      <Text style={styles.errorText}>Map display is not supported on the Web browser.</Text>
      <Text style={styles.subText}>Testing API logic... check the console for logs.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centerAll: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#131313',
  },
  errorText: {
    color: '#E2E2E2',
    fontSize: 16,
    textAlign: 'center',
  },
  subText: {
    color: '#888',
    marginTop: 10,
    textAlign: 'center',
  }
});
