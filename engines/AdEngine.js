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

export const useAdEngine = (hubEtas = [], routeProgress = 0) => {
  const [currentAd, setCurrentAd] = useState(null);
  const [downloadedAds, setDownloadedAds] = useState([]);
  
  const engineState = useRef({
    cat2Ads: [],
    scheduledAdsQueue: [], 
    playQueue: [], 
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
    
    try {
      const dailyStr = await FileSystem.readAsStringAsync(DAILY_STATE_PATH);
      const daily = JSON.parse(dailyStr);
      if (daily.date !== today) throw new Error('New Day');
      engineState.current.dailyState = daily;
    } catch (e) {
      engineState.current.dailyState = { date: today, playedCounts: {} };
      await saveDailyState();
    }

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

  const playNextAdInQueue = () => {
    if (!engineState.current.isInitialized) return;

    if (engineState.current.playQueue.length > 0) {
      const selectedAd = engineState.current.playQueue.shift();
      const adWithPlaybackId = { ...selectedAd, playbackId: Date.now() };
      setCurrentAd(adWithPlaybackId);
      
      const isCat1 = selectedAd.category === 1 || (selectedAd.routeId && (!selectedAd.majorHubIds || selectedAd.majorHubIds.length === 0));
      const isCat3 = selectedAd.category === 3 || (!selectedAd.routeId);

      if (isCat1) {
        const counts = engineState.current.journeyState.playedCounts;
        counts[selectedAd.adId] = (counts[selectedAd.adId] || 0) + 1;
        saveJourneyState();
      } else if (isCat3) {
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

  // 1. Spatial Trigger Logic (Cat1 & Cat3)
  useEffect(() => {
    if (!engineState.current.isInitialized) return;

    let triggeredAny = false;
    const schedule = engineState.current.scheduledAdsQueue;
    
    for (let i = 0; i < schedule.length; i++) {
      const item = schedule[i];
      if (!item.hasTriggered && routeProgress >= item.triggerProgress) {
         item.hasTriggered = true;
         engineState.current.playQueue.push(item.ad); // Push to back of queue
         triggeredAny = true;
      }
    }

    if (triggeredAny) {
      setCurrentAd((prev) => {
        if (!prev) playNextAdInQueue();
        return prev;
      });
    }
  }, [routeProgress]);

  // 2. Hub Proximity Triggers (Cat2)
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
      // Hijack the queue: Push Cat2 sequence to the FRONT!
      engineState.current.playQueue.unshift(...triggeredSequence);
      engineState.current.journeyState.triggeredHubs.push(...triggeredHubIds);
      saveJourneyState();
      
      setCurrentAd((prev) => {
        if (!prev) playNextAdInQueue();
        return prev;
      });
    }
  }, [hubEtas]);

  const initAdEngine = async (routeId, journeyId, stopProgressValues = []) => {
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

    // Categorization
    let cat1Ads = [];
    let cat2Ads = [];
    let cat3Ads = [];

    for (const ad of readyAds) {
      const hasRoute = ad.routeId !== null && ad.routeId !== undefined;
      const hasHubs = Array.isArray(ad.majorHubIds) && ad.majorHubIds.length > 0;
      
      if (ad.category === 3 || (!hasRoute)) {
         cat3Ads.push(ad);
      } else if (ad.category === 2 || hasHubs) {
         cat2Ads.push(ad);
      } else {
         cat1Ads.push(ad);
      }
    }

    engineState.current.cat2Ads = cat2Ads;
    setDownloadedAds(readyAds);

    // --- Deterministic Segment Distribution Logic (Cat1 & Cat3) ---
    const flatPlayList = [];

    const extractPlays = (ads, countsDict) => {
      ads.forEach(ad => {
         if (!isAdInTimeSlot(ad.timeSlot)) return;
         const played = countsDict[ad.adId] || 0;
         const limit = ad.playCount && ad.playCount > 0 ? ad.playCount : 5; 
         const remaining = Math.max(0, limit - played);
         
         for(let i=0; i<remaining; i++) {
           flatPlayList.push({ ...ad });
         }
      });
    };

    extractPlays(cat1Ads, engineState.current.journeyState.playedCounts);
    extractPlays(cat3Ads, engineState.current.dailyState.playedCounts);

    // Interleave: group by adId, then round-robin so no ad plays back-to-back
    // e.g. [A,A,A,B] becomes [A,B,A,_,A] where gaps push same-ad plays apart
    const interleave = (list) => {
      // Group ads by adId
      const groups = {};
      list.forEach(ad => {
        if (!groups[ad.adId]) groups[ad.adId] = [];
        groups[ad.adId].push(ad);
      });

      // Sort groups: most plays first so they spread out the furthest
      const sortedGroups = Object.values(groups).sort((a, b) => b.length - a.length);
      
      const result = [];
      let hasMore = true;
      while (hasMore) {
        hasMore = false;
        for (const group of sortedGroups) {
          if (group.length > 0) {
            // Don't place same adId consecutively
            const last = result[result.length - 1];
            if (!last || last.adId !== group[0].adId) {
              result.push(group.shift());
              if (group.length > 0) hasMore = true;
            } else {
              // Skip for now — try other groups first
              hasMore = true;
            }
          }
        }
        // Safety: if we are stuck (only 1 unique ad left with multiple plays)
        // just push them directly — spatial distribution will still separate them
        const remaining = sortedGroups.flat();
        if (hasMore && result.length + remaining.length === list.length) {
          result.push(...remaining.splice(0));
          break;
        }
      }
      return result;
    };

    const interleavedList = interleave(flatPlayList);

    // 1. Analyze Route Topology to find longest segments between stops
    const segments = [];
    // Ensure we cover the full route from 0 to 1
    const stops = [...(stopProgressValues || [])];
    if (stops.length === 0) stops.push(0, 1);
    else {
      if (stops[0] !== 0) stops.unshift(0);
      if (stops[stops.length - 1] !== 1) stops.push(1);
    }

    for (let i = 0; i < stops.length - 1; i++) {
      segments.push({
        start: stops[i],
        end: stops[i + 1],
        length: stops[i + 1] - stops[i],
        assignedAds: []
      });
    }

    // Sort segments by length (longest first)
    segments.sort((a, b) => b.length - a.length);

    // 2. Distribute Ads into the longest segments
    interleavedList.forEach((ad, index) => {
       // Loop through segments so the longest ones get ads first, and if we have many ads, they wrap around
       const targetSegment = segments[index % segments.length];
       targetSegment.assignedAds.push(ad);
    });

    // 3. Calculate perfectly centered trigger points for the ads inside each segment
    const scheduledQueue = [];

    segments.forEach(seg => {
      const numAds = seg.assignedAds.length;
      if (numAds === 0) return;

      // Slice the segment into equal pieces to perfectly center the ads
      // e.g., 1 ad = 50%, 2 ads = 33% and 66%
      const step = seg.length / (numAds + 1);

      seg.assignedAds.forEach((ad, index) => {
        const triggerProgress = seg.start + step * (index + 1);
        scheduledQueue.push({
          ad,
          triggerProgress,
          hasTriggered: triggerProgress <= routeProgress // Discard missed ads if bus starts halfway through!
        });
      });
    });

    scheduledQueue.sort((a, b) => a.triggerProgress - b.triggerProgress);
    
    engineState.current.scheduledAdsQueue = scheduledQueue;
    engineState.current.playQueue = [];
    engineState.current.isInitialized = true;

    // We do NOT call playNextAdInQueue() here! We wait for the GPS to hit the triggers.
    setCurrentAd(null);
  };

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
