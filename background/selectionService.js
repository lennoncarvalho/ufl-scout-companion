// SelectionService — CRUD over chrome.storage.local.selectionList + broadcast to uflscout tabs.
import { STORAGE_KEYS, UFLSCOUT_URL_PATTERN } from './storageKeys.js';
import { MESSAGES } from './messages.js';

export async function get() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SELECTION_LIST);
  const list = stored[STORAGE_KEYS.SELECTION_LIST];
  return Array.isArray(list) ? list : [];
}

async function set(list) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SELECTION_LIST]: list });
}

// Toggle a player's membership. Returns { inList, list }.
export async function toggle(id) {
  const numId = Number(id);
  const list = await get();
  const idx = list.findIndex((e) => Number(e.id) === numId);

  let inList;
  let next;
  if (idx >= 0) {
    next = list.slice(0, idx).concat(list.slice(idx + 1));
    inList = false;
  } else {
    next = list.concat([{ id: numId, addedAt: Date.now() }]);
    inList = true;
  }
  await set(next);
  await broadcast(next);
  return { inList, list: next };
}

export async function clear() {
  await set([]);
  await broadcast([]);
  return { ok: true };
}

// Push SELECTION_CHANGED to every open uflscout.com tab so all decorations stay in sync.
export async function broadcast(list) {
  const payload = list || (await get());
  const tabs = await chrome.tabs.query({ url: UFLSCOUT_URL_PATTERN });
  await Promise.allSettled(
    tabs.map((tab) =>
      chrome.tabs.sendMessage(tab.id, { type: MESSAGES.SELECTION_CHANGED, list: payload })
    )
  );
}
