// Storage-key constants shared by content scripts and the options page (classic script).
// The service worker keeps an ES-module twin at background/storageKeys.js — keep both in sync.
(function (root) {
  root.storageKeys = Object.freeze({
    // chrome.storage.local
    SELECTION_LIST: 'selectionList',
    PLAYER_CACHE: 'playerCache',

    // chrome.storage.sync
    PROFILES: 'profiles',
    ACTIVE_PROFILE_ID: 'activeProfileId'
  });
})(globalThis.uflx = globalThis.uflx || {});
