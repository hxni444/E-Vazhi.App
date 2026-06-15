// AppConfiguration Settings
// These values will later be fetched via API, but are currently static fallbacks.

export const AppConfig = {
  // Network Settings
  API_BASE_URL: 'http://192.168.31.8:5148',

  // Announcement Engine Settings

  // The distance past a stop before announcing "Next stop: [Name]"
  // Set to 50 meters past the stop
  NEXT_STOP_ANNOUNCEMENT_BUFFER_METERS: 100,

  // The distance threshold to announce "Reaching stop: [Name]" when approaching a stop
  // Set to 200 meters before reaching the stop
  REACHING_STOP_ANNOUNCEMENT_THRESHOLD_METERS: 200,

  // Google Maps API Settings
  GOOGLE_MAPS_API_KEY: 'AIzaSyDkFUEFSGSBNqZDANYOxFU-GjTmNjBHR0k',
  
  // How often to ping the Google ETA API in milliseconds (e.g. 60000 = 1 minute)
  // We limit this so we don't burn through API quota every second the GPS updates
  ETA_UPDATE_INTERVAL_MS: 60000,
};
