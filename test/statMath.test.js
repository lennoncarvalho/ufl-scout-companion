'use strict';

// Classic script self-attaches to globalThis.uflx; requiring it is enough to load statMath.
const test = require('node:test');
const assert = require('node:assert/strict');

require('../shared/statMath.js');
const statMath = globalThis.uflx.statMath;

test('discoverStatKeys prefers a nested stat container and ignores metadata', () => {
  const player = { id: 999, rating: 90, stats: { pace: 80, shooting: 70, passing: 60 } };
  assert.deepEqual(statMath.discoverStatKeys(player), ['pace', 'passing', 'shooting']);
});

test('discoverStatKeys falls back to top-level numerics, excluding non-stat keys', () => {
  const player = { id: 5, rating: 88, price: 1000, speed: 90, strength: 80, stamina: 70 };
  assert.deepEqual(statMath.discoverStatKeys(player), ['speed', 'stamina', 'strength']);
});

test('inGameSum sums every discovered stat (container case)', () => {
  const player = { id: 1, rating: 99, stats: { pace: 80, shooting: 70, passing: 60 } };
  assert.equal(statMath.inGameSum(player), 210);
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
  const player = { stats: { speed: 90, stamina: 70, strength: 80 } };
  assert.equal(statMath.profileSum(player, ['speed', 'stamina', 'doesNotExist']), 160);
});

test('profileSum of an empty statKeys array is 0 (no crash)', () => {
  const player = { stats: { speed: 90, stamina: 70, strength: 80 } };
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

test('groupStatKeys buckets known keys and puts unknowns in Other', () => {
  const groups = statMath.groupStatKeys(['finishing', 'stamina', 'someWeirdKey']);
  const byLabel = {};
  groups.forEach((g) => { byLabel[g.label] = g.keys; });
  assert.ok(byLabel.Physical.includes('stamina'));
  assert.ok(byLabel.Attacking.includes('finishing'));
  assert.ok(byLabel.Other.includes('someWeirdKey'));
});
