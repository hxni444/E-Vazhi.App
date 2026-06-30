import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BusModeScreen from './screens/BusModeScreen';
import SetupScreen from './screens/SetupScreen';
import SettingsScreen from './screens/SettingsScreen';
import LogViewerScreen from './screens/LogViewerScreen';
import Logger from './utils/Logger';

const Stack = createNativeStackNavigator();

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);

  useEffect(() => {
    // Initialize custom logger
    Logger.init();
    checkBusNumber();
  }, []);

  const checkBusNumber = async () => {
    try {
      const savedBusNumber = await AsyncStorage.getItem('@bus_number');
      if (savedBusNumber) {
        Logger.setBusNumber(savedBusNumber);
        setInitialRoute('BusMode');
      } else {
        setInitialRoute('Setup');
      }
    } catch (e) {
      console.error('Error reading bus number', e);
      setInitialRoute('Setup');
    }
  };

  if (!initialRoute) {
    return (
      <View style={{ flex: 1, backgroundColor: '#131313', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#4D8EFF" />
      </View>
    );
  }

  return (
    <>
      <StatusBar hidden={true} />
      <NavigationContainer>
        <Stack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Setup" component={SetupScreen} />
          <Stack.Screen name="BusMode" component={BusModeScreen} />
          <Stack.Screen 
            name="Settings" 
            component={SettingsScreen} 
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }} 
          />
          <Stack.Screen 
            name="LogViewer" 
            component={LogViewerScreen} 
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }} 
          />
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}
