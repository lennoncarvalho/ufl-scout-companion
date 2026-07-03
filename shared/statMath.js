// Pure stat math + stat-key discovery helpers.
// Classic script: attaches to globalThis.uflx.statMath. Consumed unchanged by the content
// script, the options page, and the Node test runner (no ES-module syntax, no import/export).
(function (root) {
  'use strict';

  // Candidate keys that usually hold the per-stat dictionary inside /api/players-public/{id}.
  // `detailedStats`/`detailed_stats` come first: the UFL Scout API nests the real per-stat
  // values (pace/fitness/passing/shooting/defending/dribbling → leaf numbers) there, and the
  // public endpoint returns those leaves as numeric *strings* (e.g. "83"), so they are coerced
  // on collection. The players-public payload also carries a 6-value aggregate `stats`
  // ({ def, drb, fit, pac, pas, sho }) that must NOT be summed or shown — preferring
  // detailedStats (which yields ≥3 leaves) means that aggregate is naturally bypassed. Without
  // this the total is wildly inflated (e.g. the bogus 69664 for card 33462).
  var STAT_CONTAINER_KEYS = [
    'detailedStats', 'detailed_stats',
    'attributes', 'statistics', 'skills', 'abilities',
    'attributeValues', 'ingameStats', 'inGameStats'
  ];

  // Numeric top-level fields that are NOT stats (used only by the fallback path).
  var NON_STAT_KEYS = new Set([
    'id', 'playerId', 'rating', 'overall', 'ovr', 'height', 'weight', 'age',
    'price', 'cost', 'value', 'marketValue', 'number', 'jerseyNumber',
    'shirtNumber', 'year', 'releaseYear', 'mastery', 'tier', 'level',
    'createdAt', 'updatedAt', 'timestamp', 'fetchedAt', 'addedAt'
  ]);

  // Stat keys that must never be shown as comparison-table columns:
  //  - goalkeeper stats (any `gk*` key plus the bare goalkeeper leaves), which are meaningless
  //    for the outfield players being compared;
  //  - identity/promo metadata that the dual-format /api/players payload leaks in as numerics
  //    (e.g. alternative_player_id / alternativePlayerId, promo_id / promoId).
  // Keys are compared in a normalised form (lower-cased, separators stripped) so both the
  // snake_case and camelCase spellings are caught.
  var EXCLUDED_DISPLAY_KEYS = new Set([
    'diving', 'handling', 'kicking', 'reflexes',
    'alternativeplayerid', 'promoid'
  ]);

  // Normalise a stat key for duplicate detection / exclusion matching:
  // 'weak_foot' and 'weakFoot' both collapse to 'weakfoot'.
  function normalizeStatKey(key) {
    return String(key).toLowerCase().replace(/[_\s-]+/g, '');
  }

  // Canonicalise a leaf stat key using its parent category. The players-public payload nests a
  // `positioning` leaf under BOTH the `shooting` (attack) and `defending` categories, but names
  // it inconsistently: some cards use the explicit `attackPositioning` / `defensivePositioning`
  // spelling, others just `positioning`. Flattening by raw leaf-key therefore produced up to
  // three positioning columns (attackPositioning / positioning / defensivePositioning) and left
  // the Attack Positioning cell empty for cards that used the bare `positioning` spelling. We
  // resolve the bare `positioning` leaf to the category-specific key so a single, always-filled
  // column remains per category.
  function canonicalLeafKey(parentKey, leafKey) {
    if (normalizeStatKey(leafKey) === 'positioning') {
      var p = normalizeStatKey(parentKey);
      if (p === 'shooting' || p === 'attack' || p === 'attacking') return 'attackPositioning';
      if (p === 'defending' || p === 'defense' || p === 'defence') return 'defensivePositioning';
    }
    return leafKey;
  }

  // True when a key should be hidden from the comparison table (GK stats + promo/alt-id metadata).
  function isExcludedStatKey(key) {
    var norm = normalizeStatKey(key);
    return norm.indexOf('gk') === 0 || EXCLUDED_DISPLAY_KEYS.has(norm);
  }

  // Column key list for the comparison table: drops excluded keys and de-duplicates the
  // snake_case/camelCase pairs (e.g. weak_foot vs weakFoot) that the dual-format payload emits,
  // preferring the camelCase spelling. Order of first appearance is preserved.
  function displayStatKeys(keys) {
    var seen = new Set();
    var out = [];
    (Array.isArray(keys) ? keys : []).forEach(function (key) {
      if (isExcludedStatKey(key)) return;
      var norm = normalizeStatKey(key);
      var camel = String(key).indexOf('_') === -1 && String(key).indexOf('-') === -1;
      if (seen.has(norm)) {
        // Keep the camelCase spelling if a snake_case duplicate was recorded first.
        if (camel) {
          for (var i = 0; i < out.length; i++) {
            if (normalizeStatKey(out[i]) === norm) { out[i] = key; break; }
          }
        }
        return;
      }
      seen.add(norm);
      out.push(key);
    });
    return out;
  }

  // Best-effort grouping of stat keys for the options-page checkbox grid.
  var STAT_CATEGORIES = [
    { id: 'physical', label: 'Physical', keys: ['acceleration', 'sprintSpeed', 'speed', 'pace', 'stamina', 'strength', 'jumping', 'agility', 'balance', 'reactions', 'fitness'] },
    { id: 'attacking', label: 'Attacking', keys: ['finishing', 'shooting', 'shotPower', 'longShots', 'attackPositioning', 'positioning', 'volleys', 'penalties', 'heading', 'headingAccuracy'] },
    { id: 'passing', label: 'Passing', keys: ['shortPassing', 'longPassing', 'passing', 'vision', 'crossing', 'curve', 'freeKicks', 'freeKickAccuracy'] },
    { id: 'dribbling', label: 'Dribbling', keys: ['ballControl', 'dribbling', 'composure'] },
    { id: 'defending', label: 'Defending', keys: ['marking', 'defensiveAwareness', 'defensivePositioning', 'standingTackle', 'slidingTackle', 'interceptions', 'defending', 'defence'] },
    { id: 'goalkeeping', label: 'Goalkeeping', keys: ['gkDiving', 'gkHandling', 'gkKicking', 'gkReflexes', 'gkPositioning', 'gkSpeed', 'diving', 'handling', 'kicking', 'reflexes'] }
  ];

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  // Coerce a value to a finite number, accepting numeric strings ("83" → 83) as emitted by the
  // players-public `detailedStats` leaves. Returns null for anything that is not a finite number.
  function coerceNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  // Collect finite numeric leaves from an object into a flat { key: number } map, coercing
  // numeric strings. Recurses up to `depth` levels so a nested category structure still yields
  // its leaves. `null`/non-numeric branches (e.g. detailedStats.goalkeeper === null) are skipped.
  // `parentKey` is the key of the object currently being descended into; it lets us canonicalise
  // category-scoped leaves (e.g. a bare `positioning` under `shooting` -> `attackPositioning`).
  function collectNumbers(obj, out, depth, parentKey) {
    if (!isPlainObject(obj) || depth < 0) return out;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = obj[k];
      var num = coerceNumber(v);
      if (num !== null) {
        var canon = canonicalLeafKey(parentKey, k);
        if (!(canon in out)) out[canon] = num;
      } else if (isPlainObject(v)) {
        collectNumbers(v, out, depth - 1, k);
      }
    }
    return out;
  }

  // Resolve the flat { statKey: number } dictionary for a player.
  // Prefers a recognised nested stat container; falls back to filtered top-level numerics.
  function resolveStatDict(player) {
    if (!isPlainObject(player)) return {};
    for (var i = 0; i < STAT_CONTAINER_KEYS.length; i++) {
      var container = player[STAT_CONTAINER_KEYS[i]];
      if (isPlainObject(container)) {
        var flat = collectNumbers(container, {}, 2);
        if (Object.keys(flat).length >= 3) return flat;
      }
    }
    var top = {};
    var keys = Object.keys(player);
    for (var j = 0; j < keys.length; j++) {
      var key = keys[j];
      var val = player[key];
      if (typeof val === 'number' && Number.isFinite(val) && !NON_STAT_KEYS.has(key)) {
        top[key] = val;
      }
    }
    return top;
  }

  // Returns a stable, alphabetically sorted list of every stat key found on the player.
  function discoverStatKeys(player) {
    return Object.keys(resolveStatDict(player)).sort();
  }

  // Sum of every numeric stat value (the "In-game stats" total).
  function inGameSum(player) {
    var dict = resolveStatDict(player);
    var sum = 0;
    var keys = Object.keys(dict);
    for (var i = 0; i < keys.length; i++) sum += dict[keys[i]];
    return sum;
  }

  // Sum of the given subset of stat keys (the "Custom stats" total).
  // Missing keys count as 0; an empty/invalid subset yields 0.
  function profileSum(player, statKeys) {
    if (!Array.isArray(statKeys) || statKeys.length === 0) return 0;
    var dict = resolveStatDict(player);
    var sum = 0;
    for (var i = 0; i < statKeys.length; i++) {
      var v = dict[statKeys[i]];
      if (typeof v === 'number' && Number.isFinite(v)) sum += v;
    }
    return sum;
  }

  function isMissing(v) {
    return v === null || v === undefined || v === '' ||
      (typeof v === 'number' && !Number.isFinite(v));
  }

  function baseCompare(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  // Read a sortable value for `key`, looking at the row itself then its `stats` sub-map.
  function readCell(row, key) {
    if (row === null || row === undefined) return undefined;
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
    if (isPlainObject(row.stats) && Object.prototype.hasOwnProperty.call(row.stats, key)) {
      return row.stats[key];
    }
    return undefined;
  }

  // Stable sort of `rows` by `key`. `dir` ∈ 'asc' | 'desc' | null (null restores default order).
  // Missing values always sort last, regardless of direction.
  function sortByColumn(rows, key, dir) {
    var arr = Array.isArray(rows) ? rows.slice() : [];
    if (!dir || !key) return arr;
    var mult = dir === 'asc' ? 1 : -1;
    var decorated = arr.map(function (row, i) { return [row, i]; });
    decorated.sort(function (a, b) {
      var va = readCell(a[0], key);
      var vb = readCell(b[0], key);
      var am = isMissing(va);
      var bm = isMissing(vb);
      if (am && bm) return a[1] - b[1];
      if (am) return 1;
      if (bm) return -1;
      var cmp = baseCompare(va, vb) * mult;
      return cmp !== 0 ? cmp : a[1] - b[1];
    });
    return decorated.map(function (pair) { return pair[0]; });
  }

  // Turn a stat key into a human label, e.g. 'sprintSpeed' -> 'Sprint Speed', 'gkDiving' -> 'GK Diving'.
  function humanizeStatKey(key) {
    if (typeof key !== 'string') return String(key);
    return key
      .replace(/^gk/, 'GK ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
      .trim();
  }

  // Flat list of every stat key the extension knows about (used as an options-page fallback
  // universe when no player data is cached yet).
  function knownStatKeys() {
    var out = [];
    for (var i = 0; i < STAT_CATEGORIES.length; i++) {
      STAT_CATEGORIES[i].keys.forEach(function (k) { if (out.indexOf(k) < 0) out.push(k); });
    }
    return out;
  }

  // Group a discovered key list into ordered categories; unknown keys land in "Other".
  function groupStatKeys(keys) {
    var present = new Set(Array.isArray(keys) ? keys : []);
    var used = new Set();
    var groups = [];
    for (var i = 0; i < STAT_CATEGORIES.length; i++) {
      var cat = STAT_CATEGORIES[i];
      var catKeys = cat.keys.filter(function (k) { return present.has(k); });
      catKeys.forEach(function (k) { used.add(k); });
      if (catKeys.length) groups.push({ id: cat.id, label: cat.label, keys: catKeys });
    }
    var other = (Array.isArray(keys) ? keys : []).filter(function (k) { return !used.has(k); });
    if (other.length) groups.push({ id: 'other', label: 'Other', keys: other });
    return groups;
  }

  root.statMath = {
    resolveStatDict: resolveStatDict,
    discoverStatKeys: discoverStatKeys,
    isExcludedStatKey: isExcludedStatKey,
    displayStatKeys: displayStatKeys,
    inGameSum: inGameSum,
    profileSum: profileSum,
    sortByColumn: sortByColumn,
    humanizeStatKey: humanizeStatKey,
    knownStatKeys: knownStatKeys,
    groupStatKeys: groupStatKeys
  };
})(globalThis.uflx = globalThis.uflx || {});
