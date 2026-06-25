import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';

class AudioEngine {
  constructor() {
    this.audioCachePath = `${FileSystem.documentDirectory}audioCache/`;
    this.currentSound = null;
  }

  async init() {
    const dirInfo = await FileSystem.getInfoAsync(this.audioCachePath);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(this.audioCachePath, { intermediates: true });
    }
  }

  getSafeFilename(url) {
    if (!url) return null;
    return url.split('/').pop().replace(/[^a-zA-Z0-9.-]/g, '_');
  }

  async downloadAndCacheAudio(url) {
    if (!url) return null;
    const filename = this.getSafeFilename(url);
    const fileUri = `${this.audioCachePath}${filename}`;
    
    try {
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (fileInfo.exists) {
        return fileUri; // Already cached
      }
      
      console.log(`[AUDIO] Downloading ${filename}...`);
      const { uri } = await FileSystem.downloadAsync(url, fileUri);
      return uri;
    } catch (e) {
      console.error(`[AUDIO] Failed to download audio ${url}:`, e);
      return null;
    }
  }

  async cacheRouteAudios(audioData) {
    console.log('[AUDIO] Caching route audios...');
    await this.init();

    const cachedPaths = {
      nextStop: null,
      reachingStop: null,
      stops: {}
    };

    if (audioData.nextStopAudioUrl) {
      cachedPaths.nextStop = await this.downloadAndCacheAudio(audioData.nextStopAudioUrl);
    }
    
    if (audioData.reachingStopAudioUrl) {
      cachedPaths.reachingStop = await this.downloadAndCacheAudio(audioData.reachingStopAudioUrl);
    }

    if (audioData.stopAudios) {
      for (const [stopId, url] of Object.entries(audioData.stopAudios)) {
        if (url) {
          cachedPaths.stops[stopId] = await this.downloadAndCacheAudio(url);
        }
      }
    }

    await AsyncStorage.setItem('@route_audios', JSON.stringify(cachedPaths));
    console.log('[AUDIO] Route audios cached successfully.');
  }

  async playAudioSequence(uris, fallbackText) {
    try {
      for (const uri of uris) {
        if (!uri) continue;
        
        console.log(`[AUDIO] Playing ${uri}`);
        const { sound } = await Audio.Sound.createAsync({ uri });
        this.currentSound = sound;
        
        await sound.playAsync();
        
        // Wait for it to finish
        await new Promise((resolve) => {
          sound.setOnPlaybackStatusUpdate((status) => {
            if (status.didJustFinish) resolve();
          });
        });
        
        await sound.unloadAsync();
        this.currentSound = null;
      }
    } catch (e) {
      console.error('[AUDIO] Playback error:', e);
      if (fallbackText) {
        console.log(`[AUDIO] Falling back to TTS: ${fallbackText}`);
        return new Promise(resolve => {
          Speech.speak(fallbackText, { rate: 0.9, onDone: resolve });
        });
      }
    }
  }

  async stopCurrentAudio() {
    if (this.currentSound) {
      try {
        await this.currentSound.stopAsync();
        await this.currentSound.unloadAsync();
      } catch (e) {}
      this.currentSound = null;
    }
    Speech.stop();
  }

  async playAnnouncement(type, stopId, stopName) {
    await this.stopCurrentAudio();
    
    try {
      const cachedDataStr = await AsyncStorage.getItem('@route_audios');
      if (!cachedDataStr) {
        // Fallback entirely to TTS if nothing is cached
        return new Promise(resolve => {
          Speech.speak(`${type === 'NEXT' ? 'Next stop' : 'Reaching stop'}: ${stopName}`, { rate: 0.9, onDone: resolve });
        });
      }

      const cachedPaths = JSON.parse(cachedDataStr);
      const urisToPlay = [];

      if (type === 'NEXT' && cachedPaths.nextStop) urisToPlay.push(cachedPaths.nextStop);
      if (type === 'REACHING' && cachedPaths.reachingStop) urisToPlay.push(cachedPaths.reachingStop);

      const specificStopAudio = cachedPaths.stops[stopId];
      if (specificStopAudio) {
        urisToPlay.push(specificStopAudio);
        await this.playAudioSequence(urisToPlay, null);
      } else {
        // Play prefix then speak name
        await this.playAudioSequence(urisToPlay, null);
        await new Promise(resolve => {
          Speech.speak(stopName, { rate: 0.9, onDone: resolve });
        });
      }

    } catch (e) {
      console.error('[AUDIO] Announcement error:', e);
      return new Promise(resolve => {
        Speech.speak(`${type === 'NEXT' ? 'Next stop' : 'Reaching stop'}: ${stopName}`, { rate: 0.9, onDone: resolve });
      });
    }
  }
}

export default new AudioEngine();
