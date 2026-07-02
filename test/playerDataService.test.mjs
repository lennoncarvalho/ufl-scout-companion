import test from 'node:test';
import assert from 'node:assert/strict';

// --- Minimal chrome.storage.local + fetch mocks installed before importing the SUT ---------
const store = { data: {} };
let fetchCalls = 0;

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (key == null) return { ...store.data };
        if (typeof key === 'string') return { [key]: store.data[key] };
        if (Array.isArray(key)) {
          const out = {};
          key.forEach((k) => { out[k] = store.data[k]; });
          return out;
        }
        const out = {};
        Object.keys(key).forEach((k) => { out[k] = (k in store.data) ? store.data[k] : key[k]; });
        return out;
      },
      async set(obj) { Object.assign(store.data, obj); }
    }
  }
};

globalThis.fetch = async (url) => {
  fetchCalls++;
  const id = Number(String(url).split('/').pop());
  return { ok: true, status: 200, statusText: 'OK', async json() { return { id, stats: { pace: 80, shooting: 70, passing: 60 } }; } };
};

const svc = await import('../background/playerDataService.js');
const CACHE_KEY = 'playerCache';

function reset() { store.data = {}; fetchCalls = 0; }

test('getPlayer fetches once, then serves from cache', async () => {
  reset();
  const a = await svc.getPlayer(101);
  assert.equal(a.error, null);
  assert.equal(a.player.id, 101);
  assert.equal(fetchCalls, 1);

  const b = await svc.getPlayer(101); // cache hit -> no new fetch
  assert.equal(b.player.id, 101);
  assert.equal(fetchCalls, 1);
});

test('concurrent getPlayer for the same id de-duplicates the fetch', async () => {
  reset();
  const [a, b] = await Promise.all([svc.getPlayer(202), svc.getPlayer(202)]);
  assert.equal(a.player.id, 202);
  assert.equal(b.player.id, 202);
  assert.equal(fetchCalls, 1);
});

test('a stale (TTL-expired) entry triggers a refetch', async () => {
  reset();
  await svc.getPlayer(303);
  assert.equal(fetchCalls, 1);

  // Age the entry well beyond the 14-day TTL.
  store.data[CACHE_KEY][303].fetchedAt = Date.now() - (20 * 24 * 60 * 60 * 1000);

  await svc.getPlayer(303);
  assert.equal(fetchCalls, 2);
});

test('LRU eviction keeps at most 500 entries, dropping the oldest', async () => {
  reset();
  for (let id = 1; id <= 501; id++) {
    // eslint-disable-next-line no-await-in-loop
    await svc.getPlayer(id);
  }
  const cache = store.data[CACHE_KEY];
  assert.equal(Object.keys(cache).length, 500);
  assert.equal(cache[1], undefined);   // oldest evicted
  assert.ok(cache[501]);               // newest kept
});

test('getMany returns aligned { id, player, error } entries', async () => {
  reset();
  const { players } = await svc.getMany([11, 22, 33]);
  assert.equal(players.length, 3);
  assert.deepEqual(players.map((p) => p.id).sort((a, b) => a - b), [11, 22, 33]);
  players.forEach((p) => { assert.equal(p.error, null); assert.ok(p.player); });
});

test('getPlayer resolves { player:null, error } on HTTP failure (no throw)', async () => {
  reset();
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, statusText: 'Server Error', async json() { return {}; } });
  const res = await svc.getPlayer(999);
  assert.equal(res.player, null);
  assert.match(res.error, /500/);
  globalThis.fetch = original;
});
