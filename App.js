import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from './screens/HomeScreen';
import AdminScreen from './screens/AdminScreen';
import BusModeScreen from './screens/BusModeScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Smart Bus GPS' }} />
        <Stack.Screen name="Admin" component={AdminScreen} options={{ title: 'Admin Mode' }} />
        <Stack.Screen name="BusMode" component={BusModeScreen} options={{ title: 'Bus App Mode' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
