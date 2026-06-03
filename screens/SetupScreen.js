import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function SetupScreen({ navigation }) {
  const [busNumber, setBusNumber] = useState('');

  const handleSave = async () => {
    if (!busNumber.trim()) {
      Alert.alert('Error', 'Please enter a valid bus number.');
      return;
    }
    
    try {
      await AsyncStorage.setItem('@bus_number', busNumber.trim());
      navigation.replace('BusMode', { busNumber: busNumber.trim() });
    } catch (e) {
      console.error('Failed to save bus number.', e);
      Alert.alert('Error', 'Failed to save the bus number.');
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Welcome to E-Vazhi</Text>
        <Text style={styles.subtitle}>Please configure this device by entering the Bus Number.</Text>
        
        <TextInput
          style={styles.input}
          placeholder="e.g., KL-2-BA-1"
          placeholderTextColor="#888"
          value={busNumber}
          onChangeText={setBusNumber}
          autoCapitalize="characters"
        />

        <TouchableOpacity style={styles.button} onPress={handleSave}>
          <Text style={styles.buttonText}>Start System</Text>
        </TouchableOpacity>
        
        <Text style={styles.warningText}>
          Note: This is a one-time setup. To change this later, tap the app logo 7 times.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#131313',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ADC6FF',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#E2E2E2',
    textAlign: 'center',
    marginBottom: 40,
  },
  input: {
    width: '100%',
    maxWidth: 400,
    height: 60,
    backgroundColor: '#353535',
    color: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 20,
    fontSize: 20,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: '#4D8EFF',
  },
  button: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#4D8EFF',
    paddingVertical: 18,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  warningText: {
    marginTop: 40,
    color: '#C2C6D6',
    fontSize: 12,
    textAlign: 'center',
    maxWidth: 300,
  }
});
