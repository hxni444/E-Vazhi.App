import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function HomeScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Select Operation Mode</Text>
      
      <TouchableOpacity 
        style={styles.card} 
        onPress={() => navigation.navigate('Admin')}
      >
        <Text style={styles.cardTitle}>Admin Mode</Text>
        <Text style={styles.cardDesc}>Create routes, drop map pins, and set stops.</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.card, styles.busCard]} 
        onPress={() => navigation.navigate('BusMode')}
      >
        <Text style={styles.cardTitle}>Bus App Mode</Text>
        <Text style={styles.cardDesc}>Start route tracking and broadcast stops.</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 40,
    color: '#333',
  },
  card: {
    backgroundColor: '#2196F3',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  busCard: {
    backgroundColor: '#4CAF50',
  },
  cardTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  cardDesc: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
  }
});
