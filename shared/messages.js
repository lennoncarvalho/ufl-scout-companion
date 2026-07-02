// Message-type constants shared by content scripts and the options page (classic script).
// The service worker keeps an ES-module twin at background/messages.js — keep both in sync.
(function (root) {
  root.messages = Object.freeze({
    // Action / lifecycle
    OPEN_COMPARISON: 'OPEN_COMPARISON',
    READY: 'READY',
    RESCAN: 'RESCAN',

    // Selection
    SELECTION_GET: 'SELECTION_GET',
    SELECTION_TOGGLE: 'SELECTION_TOGGLE',
    SELECTION_CLEAR: 'SELECTION_CLEAR',
    SELECTION_CHANGED: 'SELECTION_CHANGED',

    // Player data
    PLAYER_GET: 'PLAYER_GET',
    PLAYERS_GET_MANY: 'PLAYERS_GET_MANY',
    RESOLVE_VARIANT: 'RESOLVE_VARIANT',

    // Profiles
    PROFILES_GET: 'PROFILES_GET',
    PROFILE_CHANGED: 'PROFILE_CHANGED'
  });
})(globalThis.uflx = globalThis.uflx || {});
