import axios from 'axios';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useRef, useState } from 'react';
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

export const useAdEngine = (hubEtas = [], routeProgress = 0, busNumber = 'UNKNOWN') => {
  const [currentAd, setCurrentAd] = useState(null);
  const [downloadedAds, setDownloadedAds] = useState([]);

  const engineState = useRef({
    cat2Ads: [],
    scheduledAdsQueue: [],
    playQueue: [],
    dailyState: { date: '', playedCounts: {} },
    journeyState: { journeyId: '', triggeredHubs: [], playedCounts: {} },
    currentRouteId: null,
    isInitialized: false
  });

  // Track whether an ad is currently on-screen to avoid double-firing
  const isPlayingRef = useRef(false);

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
      isPlayingRef.current = true;
      setCurrentAd(adWithPlaybackId);

      const isCat1 = selectedAd.category === 1 || (selectedAd.routeIds && selectedAd.routeIds.length > 0 && (!selectedAd.majorHubIds || selectedAd.majorHubIds.length === 0));
      const isCat3 = selectedAd.category === 3 || (!selectedAd.routeIds || selectedAd.routeIds.length === 0);

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
      isPlayingRef.current = false;
      setCurrentAd(null);
    }
  };

  const onAdComplete = async (completedAd) => {
    isPlayingRef.current = false;

    if (completedAd) {
      try {
        const payload = {
          busNumber: busNumber,
          adId: completedAd.adId,
          routeId: engineState.current.currentRouteId || null,
          stopId: completedAd.triggerHubId || null,
          ranAt: new Date().toISOString()
        };
        console.log('[ADS] Sending delivery log:', payload);
        await axios.post(`${AppConfig.API_BASE_URL}/api/App/delivery-logs`, payload);
      } catch (e) {
        console.warn('[ADS] Failed to send delivery log:', e.message);
      }
    }

    playNextAdInQueue();
  };

  // 1. Spatial Trigger Logic (Cat1 & Cat3)
  useEffect(() => {
    if (!engineState.current.isInitialized) return;

    const schedule = engineState.current.scheduledAdsQueue;

    for (let i = 0; i < schedule.length; i++) {
      const item = schedule[i];
      if (!item.hasTriggered && routeProgress >= item.triggerProgress) {
        
        // If we completely missed the spot by a huge margin (>5% of route due to reboot/GPS loss), skip it
        if (routeProgress - item.triggerProgress > 0.05) {
          item.hasTriggered = true;
          console.log(`[AdEngine] Fast-forward skipping ad: ${item.ad.adName}`);
          continue;
        }

        // We successfully hit the trigger!
        item.hasTriggered = true;
        engineState.current.playQueue.push(item.ad);
        
        // Only start the player if it's not already running
        if (!isPlayingRef.current) {
          playNextAdInQueue();
        }
        break; // Handle one trigger per tick to maintain order
      }
    }
  }, [routeProgress]);

  // 2. Hub Proximity Triggers (Cat2)
  useEffect(() => {
    if (!engineState.current.isInitialized) return;

    // If already playing, skip — we'll have passed the hub before this ad could finish
    if (isPlayingRef.current) return;

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
        const adsWithHubId = hubAds.map(a => ({ ...a, triggerHubId: hub.hubId }));
        triggeredSequence.push(...adsWithHubId);
        triggeredHubIds.push(hub.hubId);
      }
    });

    if (triggeredSequence.length > 0) {
      triggeredSequence.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
      engineState.current.playQueue.unshift(...triggeredSequence);
      engineState.current.journeyState.triggeredHubs.push(...triggeredHubIds);
      saveJourneyState();
      playNextAdInQueue();
    }
  }, [hubEtas]);

  const initAdEngine = async (routeId, journeyId, stopProgressValues = [], onProgress = null) => {
    engineState.current.currentRouteId = routeId;

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
          const cachedAds = JSON.parse(str);

          // Filter cached ads to only include those valid for the current route
          adsData = cachedAds.filter(ad => {
            const hasRoute = ad.routeIds && ad.routeIds.length > 0;
            const isGlobal = ad.category === 3 || !hasRoute;
            return isGlobal || (ad.routeIds && ad.routeIds.includes(routeId));
          });
          console.log(`[ADS] Loaded ${adsData.length} valid ads from offline cache for route ${routeId}`);
        }
      } catch (err) { }
    }

    // Build set of valid local filenames from current API response
    const validFileNames = new Set(
      adsData.map(ad => {
        const url = ad.mediaUrl || '';
        const fileName = url.split('/').pop() || `ad_${ad.adId}.mp4`;
        return fileName.replace(/[^a-zA-Z0-9.]/g, '_');
      })
    );

    // Delete any cached files that are no longer in the API response
    try {
      const dirContents = await FileSystem.readDirectoryAsync(ADS_DIR);
      for (const file of dirContents) {
        if (file === 'ads_metadata.json') continue; // Never delete metadata
        if (!validFileNames.has(file)) {
          await FileSystem.deleteAsync(ADS_DIR + file, { idempotent: true });
          console.log(`[ADS] Deleted stale cached file: ${file}`);
        }
      }
    } catch (e) {
      console.warn('[ADS] Cache cleanup failed:', e);
    }

    let readyAds = [];
    let missingAds = [];

    for (const ad of adsData) {
      const url = ad.mediaUrl || '';
      const fileName = url.split('/').pop() || `ad_${ad.adId}.mp4`;
      const localUri = ADS_DIR + fileName.replace(/[^a-zA-Z0-9.]/g, '_');

      const fileInfo = await FileSystem.getInfoAsync(localUri);
      if (fileInfo.exists) {
        readyAds.push({ ...ad, localUri });
      } else {
        missingAds.push({ ...ad, localUri });
      }
    }

    let downloadedCount = 0;

    const buildSchedule = (currentReadyAds) => {
      let cat1Ads = [];
      let cat2Ads = [];
      let cat3Ads = [];

      for (const ad of currentReadyAds) {
        const hasRoute = ad.routeIds && ad.routeIds.length > 0;
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
      setDownloadedAds(currentReadyAds);

      const flatPlayList = [];
      const extractPlays = (ads, countsDict) => {
        ads.forEach(ad => {
          if (!isAdInTimeSlot(ad.timeSlot)) {
            console.log(`[AdEngine] Skipping Ad: ${ad.adName} (Outside Time Slot: ${ad.timeSlot})`);
            return;
          }
          const played = countsDict[ad.adId] || 0;
          const limit = ad.playCount && ad.playCount > 0 ? ad.playCount : 5;
          const remaining = Math.max(0, limit - played);
          
          if (remaining === 0) {
            console.log(`[AdEngine] Skipping Ad: ${ad.adName} (Hit play limit of ${limit})`);
          }

          for (let i = 0; i < remaining; i++) {
            flatPlayList.push({ ...ad });
          }
        });
      };

      extractPlays(cat1Ads, engineState.current.journeyState.playedCounts);
      extractPlays(cat3Ads, engineState.current.dailyState.playedCounts);

      const interleave = (list) => {
        const groups = {};
        list.forEach(ad => {
          if (!groups[ad.adId]) groups[ad.adId] = [];
          groups[ad.adId].push(ad);
        });
        const sortedGroups = Object.values(groups).sort((a, b) => b.length - a.length);
        const result = [];
        let hasMore = true;
        while (hasMore) {
          hasMore = false;
          for (const group of sortedGroups) {
            if (group.length > 0) {
              const last = result[result.length - 1];
              if (!last || last.adId !== group[0].adId) {
                result.push(group.shift());
                if (group.length > 0) hasMore = true;
              } else {
                hasMore = true;
              }
            }
          }
          const remaining = sortedGroups.flat();
          if (hasMore && result.length + remaining.length === list.length) {
            result.push(...remaining.splice(0));
            break;
          }
        }
        return result;
      };

      const interleavedList = interleave(flatPlayList);

      const segments = [];
      const stops = [...(stopProgressValues || [])];
      if (stops.length === 0) stops.push(0, 1);
      else {
        if (stops[0] !== 0) stops.unshift(0);
        if (stops[stops.length - 1] !== 1) stops.push(1);
      }
      for (let i = 0; i < stops.length - 1; i++) {
        segments.push({ start: stops[i], end: stops[i + 1], length: stops[i + 1] - stops[i], assignedAds: [] });
      }
      segments.sort((a, b) => b.length - a.length);

      interleavedList.forEach((ad, index) => {
        const targetSegment = segments[index % segments.length];
        targetSegment.assignedAds.push(ad);
      });

      const scheduledQueue = [];
      segments.forEach(seg => {
        const numAds = seg.assignedAds.length;
        if (numAds === 0) return;
        const step = seg.length / (numAds + 1);
        seg.assignedAds.forEach((ad, index) => {
          const triggerProgress = seg.start + step * (index + 1);
          scheduledQueue.push({
            ad,
            triggerProgress,
            hasTriggered: triggerProgress <= routeProgress
          });
        });
      });

      scheduledQueue.sort((a, b) => a.triggerProgress - b.triggerProgress);

      engineState.current.scheduledAdsQueue = scheduledQueue;
      engineState.current.isInitialized = true;
    };

    // 1. Build schedule immediately with whatever is already downloaded
    buildSchedule(readyAds);
    setCurrentAd(null);

    // 2. Start background download for missing ads
    if (missingAds.length > 0) {
      const backgroundDownload = async () => {
        let currentReadyAds = [...readyAds];
        for (const ad of missingAds) {
          if (onProgress) {
            onProgress(`Downloading new ad ${downloadedCount + 1} of ${missingAds.length}...`);
          }
          try {
            const downloadRes = await FileSystem.downloadAsync(ad.mediaUrl, ad.localUri);
            if (downloadRes.status === 200) {
              currentReadyAds.push({ ...ad, localUri: downloadRes.uri });
              // Dynamically rebuild the schedule as new ads arrive!
              buildSchedule(currentReadyAds);
            }
          } catch (e) {
            console.log(`[ADS] Missing media for adId ${ad.adId}`);
          }
          downloadedCount++;
        }
        if (onProgress) onProgress('');
      };

      // We do NOT await this. It runs in the background.
      backgroundDownload();
    }
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
