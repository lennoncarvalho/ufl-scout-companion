// ActionRouter — toolbar-icon click handling (no popup; fires chrome.action.onClicked).
// Registers its listener synchronously on import so a restarted SW still receives the event.
import { MESSAGES } from './messages.js';
import { UFLSCOUT_ORIGIN } from './storageKeys.js';

// Tabs waiting for their content script to boot before we can open the modal.
// Kept in chrome.storage.session so it survives a SW restart within the browsing session.
const PENDING_KEY = 'uflxPendingOpenTabs';

function isUflUrl(url) {
  return typeof url === 'string' && url.startsWith(UFLSCOUT_ORIGIN);
}

async function addPending(tabId) {
  const stored = await chrome.storage.session.get(PENDING_KEY);
  const arr = stored[PENDING_KEY] || [];
  if (!arr.includes(tabId)) arr.push(tabId);
  await chrome.storage.session.set({ [PENDING_KEY]: arr });
}

// If tabId was queued for OPEN_COMPARISON, dequeue it and return true.
export async function consumePendingOpen(tabId) {
  const stored = await chrome.storage.session.get(PENDING_KEY);
  const arr = stored[PENDING_KEY] || [];
  if (!arr.includes(tabId)) return false;
  await chrome.storage.session.set({ [PENDING_KEY]: arr.filter((id) => id !== tabId) });
  return true;
}

async function sendOpen(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: MESSAGES.OPEN_COMPARISON });
    return true;
  } catch (err) {
    return false; // content script not ready yet
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (tab && tab.id != null && isUflUrl(tab.url)) {
      const delivered = await sendOpen(tab.id);
      if (!delivered) await addPending(tab.id); // wait for READY, then open
      return;
    }
    // Not on uflscout.com — open the site and queue the modal for when it boots.
    const created = await chrome.tabs.create({ url: `${UFLSCOUT_ORIGIN}/` });
    if (created && created.id != null) await addPending(created.id);
  } catch (err) {
    console.warn('[uflx] action click failed', err);
  }
});
