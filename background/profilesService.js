// ProfilesService — reads/seeds stat profiles in chrome.storage.sync + broadcasts activation.
// Imports shared/defaultProfiles.js for its side effect (it attaches globalThis.uflx.defaultProfiles),
// keeping the seed data as a single source of truth shared with the options page.
import '../shared/defaultProfiles.js';
import { STORAGE_KEYS, UFLSCOUT_URL_PATTERN } from './storageKeys.js';
import { MESSAGES } from './messages.js';

function buildDefaults() {
  return globalThis.uflx.defaultProfiles.build();
}

// Read the current { profiles, activeProfileId }, seeding/repairing lazily if needed.
export async function getState() {
  const stored = await chrome.storage.sync.get([STORAGE_KEYS.PROFILES, STORAGE_KEYS.ACTIVE_PROFILE_ID]);
  let profiles = stored[STORAGE_KEYS.PROFILES];
  let activeProfileId = stored[STORAGE_KEYS.ACTIVE_PROFILE_ID];

  const hasProfiles = profiles && typeof profiles === 'object' && Object.keys(profiles).length > 0;
  if (!hasProfiles) {
    const def = buildDefaults();
    profiles = def.profiles;
    activeProfileId = def.activeProfileId;
    await chrome.storage.sync.set({
      [STORAGE_KEYS.PROFILES]: profiles,
      [STORAGE_KEYS.ACTIVE_PROFILE_ID]: activeProfileId
    });
  } else if (!activeProfileId || !profiles[activeProfileId]) {
    activeProfileId = Object.keys(profiles)[0];
    await chrome.storage.sync.set({ [STORAGE_KEYS.ACTIVE_PROFILE_ID]: activeProfileId });
  }
  return { profiles, activeProfileId };
}

// onInstalled hook: seed defaults on first install / when empty; repair a dangling active id.
// Never overwrites existing user-edited profiles (skill "don't clobber user edits" edge case).
export async function seed() {
  const stored = await chrome.storage.sync.get([STORAGE_KEYS.PROFILES, STORAGE_KEYS.ACTIVE_PROFILE_ID]);
  const profiles = stored[STORAGE_KEYS.PROFILES];
  const hasProfiles = profiles && typeof profiles === 'object' && Object.keys(profiles).length > 0;

  if (!hasProfiles) {
    const def = buildDefaults();
    await chrome.storage.sync.set({
      [STORAGE_KEYS.PROFILES]: def.profiles,
      [STORAGE_KEYS.ACTIVE_PROFILE_ID]: def.activeProfileId
    });
    return;
  }
  if (!stored[STORAGE_KEYS.ACTIVE_PROFILE_ID] || !profiles[stored[STORAGE_KEYS.ACTIVE_PROFILE_ID]]) {
    await chrome.storage.sync.set({ [STORAGE_KEYS.ACTIVE_PROFILE_ID]: Object.keys(profiles)[0] });
  }
}

// Fan PROFILE_CHANGED out to every open uflscout.com tab (called from the options-page relay).
export async function broadcastProfileChanged(activeProfileId) {
  const id = activeProfileId || (await getState()).activeProfileId;
  const tabs = await chrome.tabs.query({ url: UFLSCOUT_URL_PATTERN });
  await Promise.allSettled(
    tabs.map((tab) =>
      chrome.tabs.sendMessage(tab.id, { type: MESSAGES.PROFILE_CHANGED, activeProfileId: id })
    )
  );
}
