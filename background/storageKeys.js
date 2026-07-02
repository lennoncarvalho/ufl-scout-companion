// ES-module twin of shared/storageKeys.js for the service worker.
// Keep these constants in sync with shared/storageKeys.js (see README "Constants duplication").
export const STORAGE_KEYS = Object.freeze({
  // chrome.storage.local
  SELECTION_LIST: 'selectionList',
  PLAYER_CACHE: 'playerCache',

  // chrome.storage.sync
  PROFILES: 'profiles',
  ACTIVE_PROFILE_ID: 'activeProfileId'
});

// Host / API constants used across the service-worker modules.
export const UFLSCOUT_ORIGIN = 'https://uflscout.com';
export const UFLSCOUT_URL_PATTERN = 'https://uflscout.com/*';
