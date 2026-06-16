import { useState, useEffect, useRef } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import axios from 'axios';
import { AppConfig } from '../config';

const ADS_DIR = FileSystem.documentDirectory + 'ads/';
const DAILY_STATE_PATH = FileSystem.documentDirectory + 'daily_state.json';
const JOURNEY_STATE_PATH = FileSystem.documentDirectory + 'journey_state.json';
const METADATA_PATH = ADS_DIR + 'ads_metadata.json';

// Helper: Check Time Slot
const isAdInTimeSlot = (slotStr) => {
  if (!slotStr) return true; 
  const hour = new Date().getHours();
  if (slotStr.includes('Full Cycle') || slotStr.includes('24 Hours')) return true;
  if (slotStr.includes('Morning') && hour >= 6 && hour < 12) return true;
  if (slotStr.includes('Afternoon') && hour >= 12 && hour < 18) return true;
  if (slotStr.includes('Night') && hour >= 18 && hour < 24) return true;
  if (slotStr.includes('Late Night') && hour >= 0 && hour < 6) return true;
  return false;
};

export const useAdEngine = (hubEtas = []) => {
  const [currentAd, setCurrentAd] = useState(null);
  const [downloadedAds, setDownloadedAds] = useState([]);
  
  const engineState = useRef({
    cat1Ads: [],
    cat2Ads: [],
    cat3Ads: [],
    activeCat1Queue: [],
    activeCat3Queue: [],
    playQueue: [], 
    nextPlay: 'cat1', 
    dailyState: { date: '', playedCounts: {} },
    journeyState: { journeyId: '', triggeredHubs: [], playedCounts: {} },
    isInitialized: false
  });

  const saveDailyState = async () => {
    await FileSystem.writeAsStringAsync(DAILY_STATE_PATH, JSON.stringify(engineState.current.dailyState));
  };
  
  const saveJourneyState = async () => {
    await FileSystem.writeAsStringAsync(JOURNEY_STATE_PATH, JSON.stringify(engineState.current.journeyState));
  };

  const loadStates = async (journeyId) => {
    const today = new Date().toISOString().split('T')[0];
    
    // Daily State (Cat3)
    try {
      const dailyStr = await FileSystem.readAsStringAsync(DAILY_STATE_PATH);
      const daily = JSON.parse(dailyStr);
      if (daily.date !== today) throw new Error('New Day');
      engineState.current.dailyState = daily;
    } catch (e) {
      engineState.current.dailyState = { date: today, playedCounts: {} };
      await saveDailyState();
    }

    // Journey State (Cat1 and Cat2 Triggers)
    try {
      const journeyStr = await FileSystem.readAsStringAsync(JOURNEY_STATE_PATH);
      const journey = JSON.parse(journeyStr);
      if (journey.journeyId !== journeyId) throw new Error('New Journey');
      engineState.current.journeyState = journey;
    } catch (e) {
      engineState.current.journeyState = { journeyId, triggeredHubs: [], playedCounts: {} };
      await saveJourneyState();
    }
  };

  const getNextFromQueue = (activeQueue, allAds, playedCountsDict) => {
    if (activeQueue.length === 0) {
       const validAds = allAds.filter(ad => {
         if (!isAdInTimeSlot(ad.timeSlot)) return false;
         const played = playedCountsDict[ad.adId] || 0;
         if (ad.playCount && played >= ad.playCount) return false;
         return true;
       });
       validAds.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
       activeQueue.push(...validAds);
    }
    
    if (activeQueue.length > 0) {
       return activeQueue.shift();
    }
    return null;
  };

  const playNextAdInQueue = () => {
    if (!engineState.current.isInitialized) return;

    // 1. Cat2 sequences triggered by proximity
    if (engineState.current.playQueue.length > 0) {
      const nextAd = engineState.current.playQueue.shift();
      setCurrentAd(nextAd);
      return;
    }

    // 2. Interleave Cat1 and Cat3
    let nextCat1 = getNextFromQueue(engineState.current.activeCat1Queue, engineState.current.cat1Ads, engineState.current.journeyState.playedCounts);
    let nextCat3 = getNextFromQueue(engineState.current.activeCat3Queue, engineState.current.cat3Ads, engineState.current.dailyState.playedCounts);

    let selectedAd = null;
    let selectedCategory = null;

    if (engineState.current.nextPlay === 'cat1') {
      if (nextCat1) {
        selectedAd = nextCat1;
        selectedCategory = 'cat1';
        engineState.current.nextPlay = 'cat3'; 
      } else if (nextCat3) {
        selectedAd = nextCat3;
        selectedCategory = 'cat3';
      }
    } else {
      if (nextCat3) {
        selectedAd = nextCat3;
        selectedCategory = 'cat3';
        engineState.current.nextPlay = 'cat1'; 
      } else if (nextCat1) {
        selectedAd = nextCat1;
        selectedCategory = 'cat1';
      }
    }

    if (selectedAd) {
      const adWithPlaybackId = { ...selectedAd, playbackId: Date.now() };
      setCurrentAd(adWithPlaybackId);
      if (selectedCategory === 'cat1') {
        const counts = engineState.current.journeyState.playedCounts;
        counts[selectedAd.adId] = (counts[selectedAd.adId] || 0) + 1;
        saveJourneyState();
      } else {
        const counts = engineState.current.dailyState.playedCounts;
        counts[selectedAd.adId] = (counts[selectedAd.adId] || 0) + 1;
        saveDailyState();
      }
    } else {
      setCurrentAd(null); 
    }
  };

  const onAdComplete = () => {
    playNextAdInQueue();
  };

  // Cat2 Hub Proximity Triggers
  useEffect(() => {
    if (!engineState.current.isInitialized) return;
    
    let triggeredSequence = [];
    const triggeredHubIds = [];

    hubEtas.forEach(hub => {
      if (engineState.current.journeyState.triggeredHubs.includes(hub.hubId)) return;
      
      const hubAds = engineState.current.cat2Ads.filter(ad => 
        ad.majorHubIds && ad.majorHubIds.includes(hub.hubId) && isAdInTimeSlot(ad.timeSlot)
      );
      
      if (hubAds.length === 0) return; 

      const totalDuration = hubAds.reduce((sum, ad) => sum + (ad.durationSeconds || 30), 0);
      const triggerThreshold = totalDuration + 30; 
      
      if (hub.etaSeconds <= triggerThreshold) {
        triggeredSequence.push(...hubAds);
        triggeredHubIds.push(hub.hubId);
      }
    });

    if (triggeredSequence.length > 0) {
      triggeredSequence.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
      engineState.current.playQueue.unshift(...triggeredSequence);
      engineState.current.journeyState.triggeredHubs.push(...triggeredHubIds);
      saveJourneyState();
      
      // Force interrupt and play Cat2 immediately if we are just idling
      setCurrentAd((prev) => {
        if (!prev) {
          playNextAdInQueue();
        }
        return prev;
      });
    }
  }, [hubEtas]);

  const initAdEngine = async (routeId, journeyId) => {
    const dirInfo = await FileSystem.getInfoAsync(ADS_DIR);
    if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(ADS_DIR, { intermediates: true });

    await loadStates(journeyId);

    let adsData = [];
    try {
      const adsUrl = `${AppConfig.API_BASE_URL}/api/App/Ads?routeIds=${routeId}`;
      const response = await axios.get(adsUrl);
      adsData = response.data;
      await FileSystem.writeAsStringAsync(METADATA_PATH, JSON.stringify(adsData));
    } catch (e) {
      console.warn('[ADS] Sync failed. Loading offline payload...');
      try {
        const fileInfo = await FileSystem.getInfoAsync(METADATA_PATH);
        if (fileInfo.exists) {
          const str = await FileSystem.readAsStringAsync(METADATA_PATH);
          adsData = JSON.parse(str);
        }
      } catch (err) {}
    }

    let readyAds = [];
    for (const ad of adsData) {
      const fileName = ad.mediaUrl.split('/').pop() || `ad_${ad.adId}.mp4`;
      const localUri = ADS_DIR + fileName.replace(/[^a-zA-Z0-9.]/g, '_'); 
      
      const fileInfo = await FileSystem.getInfoAsync(localUri);
      if (fileInfo.exists) {
        readyAds.push({ ...ad, localUri });
      } else {
        try {
          const downloadRes = await FileSystem.downloadAsync(ad.mediaUrl, localUri);
          if (downloadRes.status === 200) {
            readyAds.push({ ...ad, localUri: downloadRes.uri });
          }
        } catch (e) {
          console.log(`[ADS] Missing media for adId ${ad.adId}`);
        }
      }
    }

    // Media Garbage Collection
    try {
      const allFiles = await FileSystem.readDirectoryAsync(ADS_DIR);
      const activeFileNames = readyAds.map(ad => ad.localUri.split('/').pop());
      for (const file of allFiles) {
        if (file !== 'ads_metadata.json' && !activeFileNames.includes(file)) {
           await FileSystem.deleteAsync(ADS_DIR + file, { idempotent: true });
        }
      }
    } catch(e) {}

    // Categorization
    engineState.current.cat1Ads = [];
    engineState.current.cat2Ads = [];
    engineState.current.cat3Ads = [];

    for (const ad of readyAds) {
      const hasRoute = ad.routeId !== null && ad.routeId !== undefined;
      const hasHubs = Array.isArray(ad.majorHubIds) && ad.majorHubIds.length > 0;
      
      if (ad.category === 3 || (!hasRoute)) {
         engineState.current.cat3Ads.push(ad);
      } else if (ad.category === 2 || hasHubs) {
         engineState.current.cat2Ads.push(ad);
      } else {
         engineState.current.cat1Ads.push(ad);
      }
    }

    setDownloadedAds(readyAds);

    engineState.current.activeCat1Queue = [];
    engineState.current.activeCat3Queue = [];
    engineState.current.playQueue = [];
    engineState.current.isInitialized = true;

    playNextAdInQueue();
  };

  // Backwards compatibility for SettingsScreen checking downloaded ads
  const fetchAndDownloadAds = async (routeId) => {
    await initAdEngine(routeId, 'settings_preview');
  };

  return {
    downloadedAds,
    fetchAndDownloadAds,
    initAdEngine,
    currentAd,
    onAdComplete
  };
};
