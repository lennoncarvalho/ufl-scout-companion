// ES-module twin of shared/messages.js for the service worker.
// Keep these constants in sync with shared/messages.js (see README "Constants duplication").
export const MESSAGES = Object.freeze({
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
