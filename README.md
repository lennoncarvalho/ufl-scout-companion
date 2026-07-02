# UFL Scout Companion

A **Chrome Extension (Manifest V3)** that augments [uflscout.com](https://uflscout.com/) with
player-comparison tooling the site doesn't offer:

- a persistent **selection list** (a `+ / −` badge on every player card),
- a near-full-screen **comparison modal** that sorts/filters your shortlist by the sum of
  **In-game stats** (every numeric stat) or **Custom stats** (an active position profile),
- reusable **stat profiles** (CB, FB, CM, CDM, CAM, W, ST, GK seeded on install) editable from the
  Options page, and
- an **In-game total pill** injected on the site's `/compare` cards.

The extension is **read-only** against the site's public API and stores everything locally
(selection + player cache) or in Chrome sync (profiles). No analytics, no third-party requests.

## Load it (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and choose this project's root folder (the one containing
   `manifest.json`).
4. Visit `https://uflscout.com/`, search for a player, and click the green **`+`** badge on a card.
5. Click the extension's toolbar icon to open the **comparison modal** (no popup — the icon acts
   directly on the active uflscout.com tab; if you're on another tab it opens the site first).
6. Right-click the icon → **Options** (or `chrome://extensions` → Details → Extension options) to
   edit stat profiles.

> Chrome shows its default puzzle-piece icon — the MVP intentionally omits the `"icons"` field.
> Real 16/48/128 PNGs are a pre-publish task.

## Architecture

| Surface | Files | Role |
|---|---|---|
| Content script | `content/*.js` + `content/uflx.css` | Card badges, comparison modal, `/compare` pills |
| Service worker | `background/*.js` (ES modules) | Data layer, fetch cache, selection/profile storage, toolbar-click routing, broadcasts |
| Options page | `options/*` | Stat-profile CRUD + active-profile picker |
| Shared | `shared/*.js` (classic scripts) | `globalThis.uflx.*` namespace, `statMath`, constants, seed profiles |

Content scripts and the options page ship as **classic scripts** that attach to a single global
`globalThis.uflx.*` namespace (no bundler, no ES-module `import`). The service worker is the only
`"type": "module"` surface and uses ordinary `import`.

### Constants duplication (intentional)

Because content scripts can't consume ES modules, message-type and storage-key constants exist
**twice**:

- `shared/messages.js` / `shared/storageKeys.js` — classic scripts for content + options.
- `background/messages.js` / `background/storageKeys.js` — ES-module twins for the service worker.

Keep each pair in sync when you touch either. Default profiles avoid a third copy: the SW
side-effect-imports `shared/defaultProfiles.js` (which self-initialises the namespace).

### Stat-key seeds — adjust after a live probe

`/api/players/{id}` is the authority for the real stat-key names. The seed `statKeys` in
`shared/defaultProfiles.js` are best-effort guesses. `statMath.discoverStatKeys()` walks the live
response at runtime, so the modal and Options grid **adapt automatically**; if a seeded key doesn't
match the real API, just tick the correct one in the Options page (or update the seed list).

### Card identity — person `uflId` vs. card variant id

A card anchor's numeric path id (`/players/{id}/…`) is the **person** id (`uflId`) — it is the
**same for every card a footballer has** (e.g. all 9 Valverde cards link to `/players/957/…`). The
stat API `/api/players/{id}`, the selection list, and the comparison modal are instead keyed on the
**per-variant id** (the specific promo/mastery release, e.g. `69361`). The extension derives the
variant id in two ways (`shared/cardIds.js`):

1. **From the card image** (no network): the render URL embeds it —
   `…/static-cards/{variantId}-{hash}.png`. Covers every promo card.
2. **Via the service worker** (`background/variantResolver.js`, `RESOLVE_VARIANT`): dynamically
   generated base/mastery cards use `…/static-cards/dyn/{uflId}-{ts}.png`, which carries only the
   person id. For those, the SW fetches the card's own detail page (`/players/{uflId}/{slug}`) and
   reads the exact variant id from the server-rendered HTML (the pre-seeded `/compare?p1={id}`
   deep-link). Results are memoised in `chrome.storage.session` and de-duplicated in-flight.

The `slug` after the person id (e.g. `valverde/t3/nike-surge`, `valverde/t2`) is what disambiguates
the variant for the resolver. The comparison modal shows **Promo** and **Mastery** columns so the
different versions of one player are easy to tell apart.

## Testing

Unit tests use Node's built-in test runner (no dependencies to install):

```bash
npm test        # == node --test test/
```

- `test/statMath.test.js` — discovery, `inGameSum`, `profileSum`, tri-state/stable/missing sort,
  humanize, grouping.
- `test/playerDataService.test.mjs` — mocked-fetch smoke test for cache hit, de-dup, TTL refetch,
  LRU eviction, and error handling.

Everything else is validated interactively against the live site.

> `background/package.json` (`{"type":"module"}`) only exists so Node treats the SW modules as ESM
> during tests. Chrome ignores it.

## Packaging for the Chrome Web Store (later)

When zipping for submission, **exclude** dev-only files: `test/`, `package.json`,
`background/package.json`, `README.md`, `.git/`, `.junie/`, `.idea/`, and any `*.md` plan files.
