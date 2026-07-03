// PlayerDataService — lazy fetch of /api/players-public/{id} with TTL cache + LRU + best-effort de-dup.
// The persistent source of truth is chrome.storage.local.playerCache; the in-flight Map is an
// in-memory optimisation only and is safe to lose if the service worker terminates (skill rule #7).
import { STORAGE_KEYS, UFLSCOUT_ORIGIN } from './storageKeys.js';

const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const MAX_ENTRIES = 500;
const CONCURRENCY = 4;

// Cache schema version. Bump this whenever the shape of the cached player payload changes so
// that stale-shaped entries are auto-invalidated on the next read (the ids stay the same, only
// the payload changes). v2 = switched from /api/players/{id} to /api/players-public/{id}.
const SCHEMA_VERSION = 2;

// Best-effort de-duplication of concurrent fetches for the same id (NOT persisted).
const inFlight = new Map();

function isFresh(entry) {
  return !!entry && entry.v === SCHEMA_VERSION &&
    typeof entry.fetchedAt === 'number' && (Date.now() - entry.fetchedAt) < TTL_MS;
}

async function readCache() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.PLAYER_CACHE);
  return stored[STORAGE_KEYS.PLAYER_CACHE] || {};
}

// Persist one player, then evict the oldest entries if we exceed the LRU cap.
async function writeCacheEntry(id, data) {
  const cache = await readCache();
  cache[id] = { fetchedAt: Date.now(), v: SCHEMA_VERSION, data };

  const ids = Object.keys(cache);
  if (ids.length > MAX_ENTRIES) {
    ids
      .sort((a, b) => (cache[a].fetchedAt || 0) - (cache[b].fetchedAt || 0))
      .slice(0, ids.length - MAX_ENTRIES)
      .forEach((oldId) => { delete cache[oldId]; });
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.PLAYER_CACHE]: cache });
}

async function fetchPlayer(id) {
  const url = `${UFLSCOUT_ORIGIN}/api/players-public/${id}`;
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

// getPlayer — returns { player, error }. Never throws across the message boundary.
export async function getPlayer(id) {
  const numId = Number(id);
  if (!Number.isFinite(numId)) return { player: null, error: 'invalid id' };

  const cache = await readCache();
  if (isFresh(cache[numId])) {
    return { player: cache[numId].data, error: null };
  }

  if (inFlight.has(numId)) return inFlight.get(numId);

  const promise = (async () => {
    try {
      const data = await fetchPlayer(numId);
      await writeCacheEntry(numId, data);
      return { player: data, error: null };
    } catch (err) {
      // Serve a stale cache entry if we have one; otherwise report the failure.
      const stale = (await readCache())[numId];
      if (stale && stale.data) return { player: stale.data, error: null };
      console.warn('[uflx] getPlayer failed for', numId, err);
      return { player: null, error: err && err.message ? err.message : String(err) };
    } finally {
      inFlight.delete(numId);
    }
  })();

  inFlight.set(numId, promise);
  return promise;
}

// getMany — bounded-concurrency warm/fetch. Returns { players: [{ id, player, error }] }.
export async function getMany(ids) {
  const unique = [];
  const seen = new Set();
  (Array.isArray(ids) ? ids : []).forEach((raw) => {
    const n = Number(raw);
    if (Number.isFinite(n) && !seen.has(n)) { seen.add(n); unique.push(n); }
  });

  const results = new Array(unique.length);
  let cursor = 0;
  async function worker() {
    while (cursor < unique.length) {
      const idx = cursor++;
      const id = unique[idx];
      const { player, error } = await getPlayer(id);
      results[idx] = { id, player, error };
    }
  }

  const pool = [];
  for (let i = 0; i < Math.min(CONCURRENCY, unique.length); i++) pool.push(worker());
  await Promise.allSettled(pool);
  return { players: results };
}

// Fire-and-forget cache warming (used after a player is added to the selection).
export function warm(id) {
  getPlayer(id).catch(() => { /* best-effort */ });
}
