import { useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import axios from 'axios';
import { AppConfig } from '../config';

export const useAdEngine = () => {
  const [downloadedAds, setDownloadedAds] = useState([]);

  const fetchAndDownloadAds = async (routeId) => {
    const adsDir = FileSystem.documentDirectory + 'ads/';
    const metadataPath = adsDir + 'ads_metadata.json';
    let downloaded = [];

    try {
      const dirInfo = await FileSystem.getInfoAsync(adsDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(adsDir, { intermediates: true });
      }

      if (!routeId) return;
      const adsUrl = `${AppConfig.API_BASE_URL}/api/App/Ads?routeIds=${routeId}`;
      console.log(`[ADS] Fetching ads from: ${adsUrl}`);
      
      const response = await axios.get(adsUrl);
      const adsData = response.data;
      
      console.log(`[ADS] Received ${adsData.length} ads. Starting download...`);
      
      for (const ad of adsData) {
        const fileName = ad.mediaUrl.split('/').pop() || `ad_${ad.adId}.mp4`;
        const localUri = adsDir + fileName.replace(/[^a-zA-Z0-9.]/g, '_'); 
        
        const fileInfo = await FileSystem.getInfoAsync(localUri);
        if (fileInfo.exists) {
          console.log(`[ADS] Ad ${ad.adId} already exists locally: ${localUri}`);
          downloaded.push({ ...ad, localUri });
        } else {
          console.log(`[ADS] Downloading Ad ${ad.adId} from ${ad.mediaUrl}...`);
          const downloadRes = await FileSystem.downloadAsync(ad.mediaUrl, localUri);
          if (downloadRes.status === 200) {
            console.log(`[ADS] Downloaded Ad ${ad.adId} successfully!`);
            downloaded.push({ ...ad, localUri: downloadRes.uri });
          } else {
            console.warn(`[ADS] Failed to download Ad ${ad.adId}. Status: ${downloadRes.status}`);
          }
        }
      }
      
      // Save metadata JSON locally so it works without internet next time
      await FileSystem.writeAsStringAsync(metadataPath, JSON.stringify(downloaded));
      setDownloadedAds(downloaded);
      console.log(`[ADS] Ad Delivery Engine initialized with ${downloaded.length} ready ads.`);
      
    } catch (e) {
      console.error('[ADS] Failed to fetch or download ads:', e.message);
      console.log('[ADS] Attempting to load ads from offline cache...');
      
      try {
        const fileInfo = await FileSystem.getInfoAsync(metadataPath);
        if (fileInfo.exists) {
          const cachedData = await FileSystem.readAsStringAsync(metadataPath);
          downloaded = JSON.parse(cachedData);
          setDownloadedAds(downloaded);
          console.log(`[ADS] Loaded ${downloaded.length} ads from offline cache.`);
        } else {
          console.log('[ADS] No offline ad cache found.');
        }
      } catch (fallbackErr) {
        console.error('[ADS] Failed to load offline cache:', fallbackErr.message);
      }
    }
  };

  return { downloadedAds, fetchAndDownloadAds };
};
