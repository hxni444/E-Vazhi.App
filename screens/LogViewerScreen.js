import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import Logger from '../utils/Logger';

const LOG_FILE_PATH = FileSystem.documentDirectory + 'app.log';

export default function LogViewerScreen({ navigation }) {
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(true);
  const scrollViewRef = useRef(null);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const fileInfo = await FileSystem.getInfoAsync(LOG_FILE_PATH);
      if (fileInfo.exists) {
        const content = await FileSystem.readAsStringAsync(LOG_FILE_PATH);
        setLogs(content);
      } else {
        setLogs('No logs found for today.');
      }
    } catch (e) {
      setLogs('Error reading logs: ' + e.message);
    }
    setLoading(false);
  };

  const clearLogs = async () => {
    await Logger.clearLogs();
    await loadLogs();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#E2E2E2" />
        </TouchableOpacity>
        <Text style={styles.title}>Device Logs</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={loadLogs} style={{ marginRight: 15 }}>
            <Ionicons name="refresh" size={24} color="#4CD964" />
          </TouchableOpacity>
          <TouchableOpacity onPress={clearLogs}>
            <Ionicons name="trash-outline" size={24} color="#FF4D4D" />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4D8EFF" />
        </View>
      ) : (
        <ScrollView 
          style={styles.logContainer}
          ref={scrollViewRef}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
        >
          <Text style={styles.logText}>{logs}</Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#131313' },
  header: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', 
    paddingTop: 50, paddingBottom: 15, paddingHorizontal: 20, 
    backgroundColor: '#1E1E1E', borderBottomWidth: 1, borderBottomColor: '#333'
  },
  backBtn: { padding: 5 },
  title: { fontSize: 18, fontWeight: 'bold', color: '#FFF' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  logContainer: { flex: 1, padding: 15 },
  logText: { color: '#00FF00', fontFamily: 'monospace', fontSize: 12 }
});
