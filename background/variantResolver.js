// VariantResolver (ES module) — resolves a card's per-variant id when the card image can't.
//
// Most cards embed their variant id in the render image (.../static-cards/{variantId}-...png),
// which the content script reads directly. But dynamically generated base/mastery cards use
// .../static-cards/dyn/{uflId}-{ts}.png, which only carries the *person* id (uflId). For those,
// we fetch the card's own detail page (identified by uflId + slug) and pull the variant id out
// of the server-rendered HTML: the page pre-seeds a "/compare?p1={variantId}" deep-link for the
// exact card being viewed, and otherwise embeds the current card object as the first "id".
//
// Results are memoised in chrome.storage.session (cheap, per-browser-session) and concurrent
// lookups for the same card are de-duplicated so a burst of clicks fires at most one request.
import { UFLSCOUT_ORIGIN } from './storageKeys.js';

const SESSION_KEY = 'variantMap';
const inFlight = new Map();

// Pull the current card's variant id out of a server-rendered detail page.
// Exported for unit testing against captured HTML.
export function extractVariantIdFromHtml(html, uflId) {
  if (typeof html !== 'string' || !html) return null;
  const person = Number(uflId);

  // Primary: the page's "Compare" link is pre-seeded with the current card as p1.
  const compare = /\/compare\?p1=(\d+)/.exec(html);
  if (compare) return Number(compare[1]);

  // Fallback: the first embedded player id (Next.js data is JSON, possibly backslash-escaped)
  // that isn't the person-level uflId.
  const re = /\\?"id\\?"\s*:\s*(\d+)/g;
  let m;
  while ((m = re.exec(html))) {
    const v = Number(m[1]);
    if (Number.isFinite(v) && v !== person) return v;
  }
  return null;
}

function normalizeSlug(slug) {
  return String(slug || '').trim().replace(/^\/+|\/+$/g, '').split('?')[0].split('#')[0];
}

async function readMap() {
  try {
    if (!chrome.storage || !chrome.storage.session) return {};
    const s = await chrome.storage.session.get(SESSION_KEY);
    return (s && s[SESSION_KEY]) || {};
  } catch (e) {
    return {};
  }
}

async function writeMap(map) {
  try {
    if (!chrome.storage || !chrome.storage.session) return;
    await chrome.storage.session.set({ [SESSION_KEY]: map });
  } catch (e) {
    /* session storage may be unavailable; resolution still works, just uncached */
  }
}

// Resolve { variantId, error }. Never throws across the message boundary (skill api-calling rule).
export async function resolve(uflId, slug) {
  const person = Number(uflId);
  const s = normalizeSlug(slug);
  if (!Number.isFinite(person) || !s) {
    return { variantId: null, error: 'invalid card reference' };
  }
  const key = person + '/' + s;

  if (inFlight.has(key)) return inFlight.get(key);

  const job = (async () => {
    const cached = await readMap();
    if (Number.isFinite(cached[key])) return { variantId: cached[key], error: null };

    try {
      const url = UFLSCOUT_ORIGIN + '/players/' + person + '/' + s;
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const html = await res.text();
      const variantId = extractVariantIdFromHtml(html, person);
      if (!Number.isFinite(variantId)) return { variantId: null, error: 'variant id not found' };

      const map = await readMap();
      map[key] = variantId;
      await writeMap(map);
      return { variantId, error: null };
    } catch (err) {
      return { variantId: null, error: (err && err.message) ? err.message : String(err) };
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, job);
  return job;
}
