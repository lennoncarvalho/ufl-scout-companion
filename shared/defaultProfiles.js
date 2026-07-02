// Seed stat profiles shipped on install (classic script).
// Attaches to globalThis.uflx.defaultProfiles. The service worker imports this file for its
// side effect (ES-module `import` of a namespace-attaching classic script) so seeding and the
// options page share a single source of truth.
//
// NOTE: the statKeys below are best-effort seeds. `/api/players/{id}` is the authority for the
// real key names; run a live probe and adjust these lists (or edit them in the Options page) if
// a key does not match. `statMath.discoverStatKeys` adapts the UI automatically at runtime.
(function (root) {
  'use strict';

  var PROFILES = [
    {
      id: 'cb', name: 'Center Back', isDefault: true,
      statKeys: ['defensiveAwareness', 'marking', 'standingTackle', 'slidingTackle', 'interceptions',
        'heading', 'headingAccuracy', 'strength', 'jumping', 'reactions',
        'acceleration', 'sprintSpeed', 'stamina', 'shortPassing', 'ballControl']
    },
    {
      id: 'fb', name: 'Full Back', isDefault: true,
      statKeys: ['defensiveAwareness', 'standingTackle', 'slidingTackle', 'interceptions',
        'acceleration', 'sprintSpeed', 'stamina', 'crossing', 'shortPassing', 'longPassing',
        'ballControl', 'dribbling', 'agility', 'balance', 'reactions', 'strength']
    },
    {
      id: 'cm', name: 'Central Midfielder', isDefault: true,
      statKeys: ['shortPassing', 'longPassing', 'vision', 'ballControl', 'dribbling', 'composure',
        'stamina', 'reactions', 'interceptions', 'defensiveAwareness', 'longShots', 'curve',
        'agility', 'balance']
    },
    {
      id: 'cdm', name: 'Defensive Midfielder', isDefault: true,
      statKeys: ['defensiveAwareness', 'standingTackle', 'interceptions', 'shortPassing',
        'longPassing', 'vision', 'stamina', 'strength', 'reactions', 'composure', 'ballControl',
        'heading']
    },
    {
      id: 'cam', name: 'Attacking Midfielder', isDefault: true,
      statKeys: ['shortPassing', 'longPassing', 'vision', 'crossing', 'curve', 'freeKicks',
        'ballControl', 'dribbling', 'agility', 'balance', 'reactions', 'composure', 'longShots',
        'finishing', 'positioning']
    },
    {
      id: 'w', name: 'Winger', isDefault: true,
      statKeys: ['acceleration', 'sprintSpeed', 'agility', 'balance', 'dribbling', 'ballControl',
        'crossing', 'curve', 'finishing', 'positioning', 'shotPower', 'reactions', 'stamina',
        'vision', 'shortPassing']
    },
    {
      id: 'st', name: 'Striker', isDefault: true,
      statKeys: ['finishing', 'shotPower', 'longShots', 'positioning', 'volleys', 'penalties',
        'heading', 'headingAccuracy', 'ballControl', 'dribbling', 'composure', 'reactions',
        'acceleration', 'sprintSpeed', 'strength', 'jumping']
    },
    {
      id: 'gk', name: 'Goalkeeper', isDefault: true,
      statKeys: ['gkDiving', 'gkHandling', 'gkKicking', 'gkReflexes', 'gkPositioning', 'gkSpeed',
        'reactions', 'jumping']
    }
  ];

  // Build a fresh ProfilesState: { profiles: Record<id, Profile>, activeProfileId }.
  function build() {
    var profiles = {};
    for (var i = 0; i < PROFILES.length; i++) {
      var p = PROFILES[i];
      profiles[p.id] = { id: p.id, name: p.name, statKeys: p.statKeys.slice(), isDefault: true };
    }
    return { profiles: profiles, activeProfileId: PROFILES[0].id };
  }

  root.defaultProfiles = {
    list: PROFILES,
    build: build
  };
})(globalThis.uflx = globalThis.uflx || {});
