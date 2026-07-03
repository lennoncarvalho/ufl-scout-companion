'use strict';

// Classic script self-attaches to globalThis.uflx; requiring it is enough to load statMath.
const test = require('node:test');
const assert = require('node:assert/strict');

require('../shared/statMath.js');
const statMath = globalThis.uflx.statMath;

test('discoverStatKeys prefers a nested stat container and ignores metadata', () => {
  const player = { id: 999, rating: 90, detailedStats: { pace: 80, shooting: 70, passing: 60 } };
  assert.deepEqual(statMath.discoverStatKeys(player), ['pace', 'passing', 'shooting']);
});

test('discoverStatKeys falls back to top-level numerics, excluding non-stat keys', () => {
  const player = { id: 5, rating: 88, price: 1000, speed: 90, strength: 80, stamina: 70 };
  assert.deepEqual(statMath.discoverStatKeys(player), ['speed', 'stamina', 'strength']);
});

test('inGameSum sums every discovered stat (container case)', () => {
  const player = { id: 1, rating: 99, detailedStats: { pace: 80, shooting: 70, passing: 60 } };
  assert.equal(statMath.inGameSum(player), 210);
});

test('resolveStatDict reads detailedStats string leaves and discards the 6-value stats aggregate', () => {
  // Mirrors the /api/players-public/{id} shape: numeric-string leaves nested under categories,
  // a null goalkeeper branch, and the aggregate `stats` that must NOT be summed or shown.
  const player = {
    stats: { def: 90, drb: 70, fit: 85, pac: 83, pas: 84, sho: 66 },
    detailedStats: {
      pace: { sprintSpeed: '83', acceleration: '82' },
      defending: { tackles: '90', interceptions: '90' },
      dribbling: { agility: '64', composure: '80', ballControl: '82' },
      goalkeeper: null
    }
  };
  const dict = statMath.resolveStatDict(player);
  assert.deepEqual(dict, {
    sprintSpeed: 83, acceleration: 82,
    tackles: 90, interceptions: 90,
    agility: 64, composure: 80, ballControl: 82
  });
  // The 6-value aggregate (def/drb/fit/pac/pas/sho) is bypassed entirely.
  assert.equal('def' in dict, false);
  assert.equal('sho' in dict, false);
  assert.equal(statMath.inGameSum(player), 83 + 82 + 90 + 90 + 64 + 80 + 82);
});

test('resolveStatDict canonicalises a bare `positioning` leaf by its parent category', () => {
  // 69457-style payload: shooting uses the bare `positioning` spelling.
  const bare = {
    detailedStats: {
      shooting: { finishing: 98, positioning: 95 },
      defending: { tackles: 65, positioning: 75 }
    }
  };
  const dict = bare.detailedStats && statMath.resolveStatDict(bare);
  assert.equal(dict.attackPositioning, 95);
  assert.equal(dict.defensivePositioning, 75);
  // The ambiguous bare `positioning` key must NOT survive as its own column.
  assert.equal('positioning' in dict, false);
});

test('resolveStatDict keeps the explicit attack/defensive positioning spellings', () => {
  // 57232-style payload: shooting uses the explicit `attackPositioning` spelling.
  const explicit = {
    detailedStats: {
      shooting: { finishing: 91, attackPositioning: 90 },
      defending: { tackles: 88, defensivePositioning: 86 }
    }
  };
  const dict = statMath.resolveStatDict(explicit);
  assert.equal(dict.attackPositioning, 90);
  assert.equal(dict.defensivePositioning, 86);
  assert.equal('positioning' in dict, false);
});

test('displayStatKeys yields a single positioning column per category (no bare `positioning`)', () => {
  // Union across a bare-spelling card and an explicit-spelling card resolves to just two columns.
  const keys = ['finishing', 'attackPositioning', 'defensivePositioning', 'tackles'];
  assert.deepEqual(statMath.displayStatKeys(keys), keys);
});

test('inGameSum sums fallback numerics and ignores id/rating', () => {
  const player = { id: 5, rating: 88, speed: 90, strength: 80, stamina: 70 };
  assert.equal(statMath.inGameSum(player), 240);
});

test('inGameSum of an empty/invalid player is 0', () => {
  assert.equal(statMath.inGameSum(null), 0);
  assert.equal(statMath.inGameSum({}), 0);
});

test('profileSum adds only the requested keys; missing keys count as 0', () => {
  const player = { detailedStats: { speed: 90, stamina: 70, strength: 80 } };
  assert.equal(statMath.profileSum(player, ['speed', 'stamina', 'doesNotExist']), 160);
});

test('profileSum of an empty statKeys array is 0 (no crash)', () => {
  const player = { detailedStats: { speed: 90, stamina: 70, strength: 80 } };
  assert.equal(statMath.profileSum(player, []), 0);
  assert.equal(statMath.profileSum(player, null), 0);
});

test('sortByColumn desc / asc / default(null)', () => {
  const rows = [{ id: 1, inGame: 10 }, { id: 2, inGame: 30 }, { id: 3, inGame: 20 }];

  const desc = statMath.sortByColumn(rows, 'inGame', 'desc').map((r) => r.id);
  assert.deepEqual(desc, [2, 3, 1]);

  const asc = statMath.sortByColumn(rows, 'inGame', 'asc').map((r) => r.id);
  assert.deepEqual(asc, [1, 3, 2]);

  const def = statMath.sortByColumn(rows, 'inGame', null).map((r) => r.id);
  assert.deepEqual(def, [1, 2, 3]); // original order preserved
});

test('sortByColumn is stable for equal values', () => {
  const rows = [{ id: 1, v: 5 }, { id: 2, v: 5 }, { id: 3, v: 5 }];
  const out = statMath.sortByColumn(rows, 'v', 'desc').map((r) => r.id);
  assert.deepEqual(out, [1, 2, 3]);
});

test('sortByColumn pushes missing values to the end in both directions', () => {
  const rows = [{ id: 1, v: 5 }, { id: 2 }, { id: 3, v: 8 }];
  assert.deepEqual(statMath.sortByColumn(rows, 'v', 'desc').map((r) => r.id), [3, 1, 2]);
  assert.deepEqual(statMath.sortByColumn(rows, 'v', 'asc').map((r) => r.id), [1, 3, 2]);
});

test('sortByColumn reads stat values from a row.stats sub-map', () => {
  const rows = [
    { id: 1, stats: { pace: 70 } },
    { id: 2, stats: { pace: 90 } },
    { id: 3, stats: { pace: 80 } }
  ];
  assert.deepEqual(statMath.sortByColumn(rows, 'pace', 'desc').map((r) => r.id), [2, 3, 1]);
});

test('humanizeStatKey formats camelCase and gk prefixes', () => {
  assert.equal(statMath.humanizeStatKey('sprintSpeed'), 'Sprint Speed');
  assert.equal(statMath.humanizeStatKey('gkDiving'), 'GK Diving');
  assert.equal(statMath.humanizeStatKey('short_passing'), 'Short Passing');
});

test('isExcludedStatKey hides GK stats and promo/alt-id metadata', () => {
  assert.equal(statMath.isExcludedStatKey('gkDiving'), true);
  assert.equal(statMath.isExcludedStatKey('gk_reflexes'), true);
  assert.equal(statMath.isExcludedStatKey('diving'), true);
  assert.equal(statMath.isExcludedStatKey('alternativePlayerId'), true);
  assert.equal(statMath.isExcludedStatKey('alternative_player_id'), true);
  assert.equal(statMath.isExcludedStatKey('promoId'), true);
  assert.equal(statMath.isExcludedStatKey('sprintSpeed'), false);
  assert.equal(statMath.isExcludedStatKey('weakFoot'), false);
});

test('displayStatKeys drops excluded keys for the comparison columns', () => {
  const keys = ['sprintSpeed', 'gkDiving', 'gkHandling', 'alternativePlayerId', 'promoId', 'strength'];
  assert.deepEqual(statMath.displayStatKeys(keys), ['sprintSpeed', 'strength']);
});

test('displayStatKeys de-duplicates snake_case/camelCase pairs, preferring camelCase', () => {
  assert.deepEqual(statMath.displayStatKeys(['weak_foot', 'weakFoot']), ['weakFoot']);
  assert.deepEqual(statMath.displayStatKeys(['weakFoot', 'weak_foot']), ['weakFoot']);
  assert.deepEqual(statMath.displayStatKeys(['sprint_speed', 'sprintSpeed', 'strength']), ['sprintSpeed', 'strength']);
});

test('groupStatKeys buckets known keys and puts unknowns in Other', () => {
  const groups = statMath.groupStatKeys(['finishing', 'stamina', 'someWeirdKey']);
  const byLabel = {};
  groups.forEach((g) => { byLabel[g.label] = g.keys; });
  assert.ok(byLabel.Physical.includes('stamina'));
  assert.ok(byLabel.Attacking.includes('finishing'));
  assert.ok(byLabel.Other.includes('someWeirdKey'));
});
