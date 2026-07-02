// Service worker (ES module) — boot, install-time seeding, SPA-nav pings, and message routing.
// All event listeners are registered synchronously at top level so a restarted SW still
// receives replayed events (skill service-worker rule).
import { MESSAGES } from './messages.js';
import * as selection from './selectionService.js';
import * as players from './playerDataService.js';
import * as profiles from './profilesService.js';
import * as variantResolver from './variantResolver.js';
import { consumePendingOpen } from './actionRouter.js';

// --- Install / update: seed default profiles, repair dangling active id. -------------------
chrome.runtime.onInstalled.addListener((details) => {
  profiles.seed().catch((err) => console.warn('[uflx] profile seed failed', err));
});

// --- SPA route churn: ping the tab to re-run its decoration sweeps. ------------------------
chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    chrome.tabs
      .sendMessage(details.tabId, { type: MESSAGES.RESCAN, url: details.url })
      .catch(() => { /* content script may not be present */ });
  },
  { url: [{ hostEquals: 'uflscout.com' }] }
);

// --- Message router (content script + options page -> service worker). ---------------------
// Uses the return-Promise onMessage pattern (Chrome 99+); handled types return a Promise,
// unhandled types return undefined so the channel is not held open.
chrome.runtime.onMessage.addListener((message, sender) => {
  const type = message && message.type;
  switch (type) {
    case MESSAGES.SELECTION_GET:
      return selection.get().then((list) => ({ list }));

    case MESSAGES.SELECTION_TOGGLE:
      return handleToggle(message.playerId);

    case MESSAGES.SELECTION_CLEAR:
      return selection.clear();

    case MESSAGES.PLAYER_GET:
      return players.getPlayer(message.playerId);

    case MESSAGES.PLAYERS_GET_MANY:
      return players.getMany(message.playerIds);

    case MESSAGES.RESOLVE_VARIANT:
      return variantResolver.resolve(message.uflId, message.slug);

    case MESSAGES.PROFILES_GET:
      return profiles.getState();

    case MESSAGES.PROFILE_CHANGED:
      return profiles.broadcastProfileChanged(message.activeProfileId).then(() => ({ ok: true }));

    case MESSAGES.READY:
      return handleReady(sender).then(() => ({ ok: true }));

    default:
      return undefined; // not handled here
  }
});

async function handleToggle(playerId) {
  const { inList } = await selection.toggle(playerId);
  if (inList) players.warm(playerId); // warm cache after add; don't block the response
  return { inList };
}

async function handleReady(sender) {
  const tabId = sender && sender.tab && sender.tab.id;
  if (tabId == null) return;
  const shouldOpen = await consumePendingOpen(tabId);
  if (shouldOpen) {
    await chrome.tabs
      .sendMessage(tabId, { type: MESSAGES.OPEN_COMPARISON })
      .catch((err) => console.warn('[uflx] deferred OPEN_COMPARISON failed', err));
  }
}
