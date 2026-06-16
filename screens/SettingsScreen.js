import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Video } from 'expo-av';
import { AppConfig } from '../config';
import appJson from '../app.json';

export default function SettingsScreen({ navigation }) {
  const [ads, setAds] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);

  useEffect(() => {
    loadAds();
  }, []);

  const loadAds = async () => {
    try {
      const metadataPath = FileSystem.documentDirectory + 'ads/ads_metadata.json';
      const fileInfo = await FileSystem.getInfoAsync(metadataPath);
      if (fileInfo.exists) {
        const cachedData = await FileSystem.readAsStringAsync(metadataPath);
        const parsedAds = JSON.parse(cachedData);
        
        const adsWithStatus = await Promise.all(parsedAds.map(async (ad) => {
          const fileName = ad.mediaUrl.split('/').pop() || `ad_${ad.adId}.mp4`;
          const localUri = FileSystem.documentDirectory + 'ads/' + fileName.replace(/[^a-zA-Z0-9.]/g, '_');
          const fileInfo = await FileSystem.getInfoAsync(localUri);
          
          return {
            ...ad,
            localUri,
            isDownloaded: fileInfo.exists
          };
        }));
        
        setAds(adsWithStatus);
      }
    } catch (e) {
      console.warn('Could not load ads metadata', e);
    }
  };

  const handleResetBus = () => {
    Alert.alert(
      'Reset Bus Number',
      'Are you sure you want to clear the bus number configuration? This will require re-setup.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Reset', 
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.removeItem('@bus_number');
            await AsyncStorage.removeItem('@current_route_index');
            navigation.replace('Setup');
          }
        }
      ]
    );
  };

  const getCategoryName = (ad) => {
    if (ad.category === 3 || (!ad.routeId)) return 'Cat 3 (Global)';
    if (ad.category === 2 || (ad.majorHubIds && ad.majorHubIds.length > 0)) return 'Cat 2 (Hub Trigger)';
    return 'Cat 1 (Route Ad)';
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#E2E2E2" />
        </TouchableOpacity>
        <Text style={styles.title}>Admin Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Environment Configuration */}
        <Text style={styles.sectionTitle}>Environment Variables</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Google Maps API Key</Text>
            <Text style={styles.value} numberOfLines={1} ellipsizeMode="middle">
              {appJson.expo?.android?.config?.googleMaps?.apiKey || 'Not found'}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>Next Stop Buffer</Text>
            <Text style={styles.value}>{AppConfig.NEXT_STOP_ANNOUNCEMENT_BUFFER_METERS} m</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>Reaching Stop Threshold</Text>
            <Text style={styles.value}>{AppConfig.REACHING_STOP_ANNOUNCEMENT_THRESHOLD_METERS} m</Text>
          </View>
        </View>

        {/* Ad Cache Manager */}
        <Text style={styles.sectionTitle}>Ad Cache Manager</Text>
        <View style={styles.card}>
          {ads.length === 0 ? (
            <Text style={{ color: '#888', padding: 15, textAlign: 'center' }}>No ads downloaded.</Text>
          ) : (
            ads.map((ad, index) => (
              <View key={ad.adId} style={styles.adRow}>
                <View style={{ flex: 1, paddingRight: 15 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.adTitle}>{ad.adName || `Ad #${ad.adId}`}</Text>
                    {ad.isDownloaded && <Ionicons name="checkmark-circle" size={16} color="#4CD964" />}
                  </View>
                  
                  <View style={{ marginTop: 6, gap: 4 }}>
                    <Text style={styles.adSubtitle}>
                      <Text style={{ fontWeight: 'bold' }}>Category: </Text>{getCategoryName(ad)}
                    </Text>
                    <Text style={styles.adSubtitle}>
                      <Text style={{ fontWeight: 'bold' }}>Time Slot: </Text>{ad.timeSlot || 'Full Cycle'}
                    </Text>
                    <Text style={styles.adSubtitle}>
                      <Text style={{ fontWeight: 'bold' }}>Play Limit: </Text>{ad.playCount ? `${ad.playCount} plays` : 'Unlimited'}
                    </Text>
                    <Text style={styles.adSubtitle}>
                      <Text style={{ fontWeight: 'bold' }}>Priority Score: </Text>{ad.priorityScore || 0}
                    </Text>
                    <Text style={[styles.adSubtitle, { color: '#4D8EFF', marginTop: 2 }]}>
                      {ad.durationSeconds}s Video
                    </Text>
                  </View>
                </View>
                <TouchableOpacity 
                  style={[styles.playBtn, !ad.isDownloaded && { opacity: 0.5 }]}
                  disabled={!ad.isDownloaded}
                  onPress={() => setSelectedVideo(ad.localUri)}
                >
                  <Ionicons name="play" size={16} color="#00285D" />
                  <Text style={styles.playBtnText}>Play</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* Danger Zone */}
        <Text style={[styles.sectionTitle, { color: '#FF4D4D', marginTop: 30 }]}>Danger Zone</Text>
        <View style={[styles.card, { borderColor: '#FF4D4D', borderWidth: 1 }]}>
          <TouchableOpacity style={styles.resetBtn} onPress={handleResetBus}>
            <Ionicons name="warning-outline" size={20} color="#FF4D4D" style={{ marginRight: 8 }} />
            <Text style={styles.resetText}>Reset Bus Configuration</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Video Preview Modal */}
      <Modal visible={!!selectedVideo} transparent animationType="slide" onRequestClose={() => setSelectedVideo(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modalContent}>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setSelectedVideo(null)}>
              <Ionicons name="close" size={24} color="#FFF" />
            </TouchableOpacity>
            {selectedVideo && (
              <Video
                source={{ uri: selectedVideo }}
                style={styles.videoPlayer}
                useNativeControls
                resizeMode="contain"
                shouldPlay
              />
            )}
          </View>
        </View>
      </Modal>
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
  scroll: { padding: 20 },
  sectionTitle: { fontSize: 14, fontWeight: 'bold', color: '#4D8EFF', textTransform: 'uppercase', marginBottom: 10, marginTop: 10 },
  card: { backgroundColor: '#1E1E1E', borderRadius: 12, overflow: 'hidden', marginBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15 },
  label: { color: '#CCC', fontSize: 15 },
  value: { color: '#FFF', fontSize: 15, fontWeight: '500', maxWidth: '50%' },
  divider: { height: 1, backgroundColor: '#333', marginLeft: 15 },
  adRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#333' },
  adTitle: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  adSubtitle: { color: '#888', fontSize: 13, marginTop: 4 },
  playBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#4D8EFF', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20 },
  playBtnText: { color: '#00285D', fontWeight: 'bold', marginLeft: 5 },
  resetBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15 },
  resetText: { color: '#FF4D4D', fontSize: 16, fontWeight: 'bold' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '100%', height: '80%' },
  closeBtn: { position: 'absolute', top: 20, right: 20, zIndex: 10, padding: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 },
  videoPlayer: { width: '100%', height: '100%' }
});
