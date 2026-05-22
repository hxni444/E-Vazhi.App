import AsyncStorage from '@react-native-async-storage/async-storage';

const ROUTES_KEY = '@bus_routes_v1';

export const saveRoute = async (routeObj) => {
  try {
    const existingRoutesStr = await AsyncStorage.getItem(ROUTES_KEY);
    const existingRoutes = existingRoutesStr ? JSON.parse(existingRoutesStr) : [];
    
    // Check if route ID already exists, if so update it
    const updatedRoutes = existingRoutes.filter(r => r.id !== routeObj.id);
    updatedRoutes.push(routeObj);
    
    await AsyncStorage.setItem(ROUTES_KEY, JSON.stringify(updatedRoutes));
    return true;
  } catch (error) {
    console.error('Error saving route', error);
    return false;
  }
};

export const getRoutes = async () => {
  try {
    const existingRoutesStr = await AsyncStorage.getItem(ROUTES_KEY);
    return existingRoutesStr ? JSON.parse(existingRoutesStr) : [];
  } catch (error) {
    console.error('Error getting routes', error);
    return [];
  }
};

export const clearRoutes = async () => {
  try {
    await AsyncStorage.removeItem(ROUTES_KEY);
    return true;
  } catch (error) {
    console.error('Error clearing routes', error);
    return false;
  }
};

export const deleteRoute = async (routeId) => {
  try {
    const existingRoutesStr = await AsyncStorage.getItem(ROUTES_KEY);
    const existingRoutes = existingRoutesStr ? JSON.parse(existingRoutesStr) : [];
    
    // Filter out the route by id
    const updatedRoutes = existingRoutes.filter(r => r.id !== routeId);
    
    await AsyncStorage.setItem(ROUTES_KEY, JSON.stringify(updatedRoutes));
    return true;
  } catch (error) {
    console.error('Error deleting route', error);
    return false;
  }
};
