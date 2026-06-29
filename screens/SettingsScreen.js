import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Alert, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Video, Audio } from 'expo-av';
import { AppConfig } from '../config';
import appJson from '../app.json';
import AudioEngine from '../engines/AudioEngine';

export default function SettingsScreen({ navigation }) {
  const [ads, setAds] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [audios, setAudios] = useState(null);

  const [announceNext, setAnnounceNext] = useState(true);
  const [announceReaching, setAnnounceReaching] = useState(true);

  useEffect(() => {
    loadAds();
    loadAudios();
    loadAnnounceSettings();

    const interval = setInterval(() => {
      loadAds();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const loadAnnounceSettings = async () => {
    try {
      const next = await AsyncStorage.getItem('@announce_next');
      const reaching = await AsyncStorage.getItem('@announce_reaching');
      if (next !== null) setAnnounceNext(next === 'true');
      if (reaching !== null) setAnnounceReaching(reaching === 'true');
    } catch (e) {}
  };

  const toggleAnnounceNext = async (val) => {
    setAnnounceNext(val);
    await AsyncStorage.setItem('@announce_next', val.toString());
  };

  const toggleAnnounceReaching = async (val) => {
    setAnnounceReaching(val);
    await AsyncStorage.setItem('@announce_reaching', val.toString());
  };

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

  const loadAudios = async () => {
    try {
      const cachedDataStr = await AsyncStorage.getItem('@route_audios');
      if (cachedDataStr) {
        setAudios(JSON.parse(cachedDataStr));
      }
    } catch (e) {
      console.warn('Could not load audios metadata', e);
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

  const downloadedCount = ads.filter(a => a.isDownloaded).length;
  const totalAds = ads.length;
  const progressPercent = totalAds === 0 ? 0 : (downloadedCount / totalAds) * 100;
  const isDownloading = totalAds > 0 && downloadedCount < totalAds;

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

        {/* Announcement Settings */}
        <Text style={styles.sectionTitle}>Announcement Settings</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Play "Next Stop" Announcements</Text>
            <Switch
              value={announceNext}
              onValueChange={toggleAnnounceNext}
              trackColor={{ false: "#333", true: "#4CD964" }}
              thumbColor={"#FFF"}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>Play "Reaching Stop" Announcements</Text>
            <Switch
              value={announceReaching}
              onValueChange={toggleAnnounceReaching}
              trackColor={{ false: "#333", true: "#4CD964" }}
              thumbColor={"#FFF"}
            />
          </View>
        </View>

        {/* Ad Cache Manager */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 10 }}>
          <Text style={[styles.sectionTitle, { marginTop: 0, marginBottom: 0 }]}>Ad Cache Manager</Text>
          {isDownloading ? (
            <Text style={{ color: '#F39C12', fontSize: 12, fontWeight: 'bold' }}>DOWNLOADING BACKGROUND...</Text>
          ) : (
            <Text style={{ color: '#4CD964', fontSize: 12, fontWeight: 'bold' }}>FULLY SYNCED</Text>
          )}
        </View>

        {totalAds > 0 && (
          <View style={{ marginBottom: 15 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
              <Text style={{ color: '#CCC', fontSize: 12 }}>{downloadedCount} of {totalAds} ads ready</Text>
              <Text style={{ color: '#CCC', fontSize: 12 }}>{Math.round(progressPercent)}%</Text>
            </View>
            <View style={{ height: 6, backgroundColor: '#333', borderRadius: 3, overflow: 'hidden' }}>
              <View style={{ width: `${progressPercent}%`, height: '100%', backgroundColor: isDownloading ? '#F39C12' : '#4CD964' }} />
            </View>
          </View>
        )}

        <View style={styles.card}>
          {ads.length === 0 ? (
            <Text style={{ color: '#888', padding: 15, textAlign: 'center' }}>No ads downloaded.</Text>
          ) : (
            ads.map((ad, index) => (
              <View key={ad.adId} style={styles.adRow}>
                <View style={{ flex: 1, paddingRight: 15 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.adTitle}>{ad.adName || `Ad #${ad.adId}`}</Text>
                    {ad.isDownloaded ? (
                      <Ionicons name="checkmark-circle" size={16} color="#4CD964" />
                    ) : (
                      <Ionicons name="time" size={16} color="#F39C12" />
                    )}
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
                  style={[styles.playBtn, !ad.isDownloaded && { opacity: 0.5, backgroundColor: '#333' }]}
                  disabled={!ad.isDownloaded}
                  onPress={() => setSelectedVideo(ad.localUri)}
                >
                  <Ionicons name={ad.isDownloaded ? "play" : "download-outline"} size={16} color={ad.isDownloaded ? "#00285D" : "#888"} />
                  <Text style={[styles.playBtnText, !ad.isDownloaded && { color: '#888' }]}>
                    {ad.isDownloaded ? 'Play' : 'Pending'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* Audio Cache Manager */}
        <Text style={styles.sectionTitle}>Audio Cache Manager</Text>
        <View style={styles.card}>
          {!audios ? (
            <Text style={{ color: '#888', padding: 15, textAlign: 'center' }}>No audios downloaded.</Text>
          ) : (
            <>
              {audios.nextStop && (
                <View style={styles.adRow}>
                  <View style={{ flex: 1, paddingRight: 15 }}>
                    <Text style={styles.adTitle}>Next Stop Prefix</Text>
                    <Text style={styles.adSubtitle}>Local: {audios.nextStop.split('/').pop()}</Text>
                  </View>
                  <TouchableOpacity style={styles.playBtn} onPress={() => AudioEngine.playAudioSequence([audios.nextStop])}>
                    <Ionicons name="play" size={16} color="#00285D" />
                  </TouchableOpacity>
                </View>
              )}
              {audios.reachingStop && (
                <View style={styles.adRow}>
                  <View style={{ flex: 1, paddingRight: 15 }}>
                    <Text style={styles.adTitle}>Reaching Stop Prefix</Text>
                    <Text style={styles.adSubtitle}>Local: {audios.reachingStop.split('/').pop()}</Text>
                  </View>
                  <TouchableOpacity style={styles.playBtn} onPress={() => AudioEngine.playAudioSequence([audios.reachingStop])}>
                    <Ionicons name="play" size={16} color="#00285D" />
                  </TouchableOpacity>
                </View>
              )}
              {audios.stops && Object.entries(audios.stops).map(([stopId, uri]) => (
                <View key={stopId} style={styles.adRow}>
                  <View style={{ flex: 1, paddingRight: 15 }}>
                    <Text style={styles.adTitle}>Stop ID: {stopId}</Text>
                    <Text style={styles.adSubtitle}>Local: {uri.split('/').pop()}</Text>
                  </View>
                  <TouchableOpacity style={styles.playBtn} onPress={() => AudioEngine.playAudioSequence([uri])}>
                    <Ionicons name="play" size={16} color="#00285D" />
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}
        </View>

        {/* System Diagnostics */}
        <Text style={styles.sectionTitle}>System Diagnostics</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('LogViewer')}>
            <Text style={styles.label}>View Device Logs</Text>
            <Ionicons name="chevron-forward" size={20} color="#888" />
          </TouchableOpacity>
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
