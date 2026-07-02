// Options page — stat-profile CRUD + active-profile picker. Classic script, no inline handlers.
(function (root) {
  'use strict';

  var statMath = root.statMath;
  var messages = root.messages;
  var keys = root.storageKeys;
  var defaults = root.defaultProfiles;

  var SYNC_WARN_BYTES = 90000; // headroom under the 100 KB chrome.storage.sync total quota

  var state = {
    profiles: {},
    activeProfileId: '',
    selectedProfileId: '',
    universe: []
  };

  // ---- helpers ----------------------------------------------------------------------------
  function send(msg) { return chrome.runtime.sendMessage(msg); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'type') node.type = v;
        else node.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function slugify(name) {
    var base = String(name || 'profile').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (base || 'profile') + '-' + Date.now().toString(36);
  }

  function orderedProfileIds() {
    return Object.keys(state.profiles).sort(function (a, b) {
      var pa = state.profiles[a], pb = state.profiles[b];
      // defaults first, then alphabetical by name
      if (!!pa.isDefault !== !!pb.isDefault) return pa.isDefault ? -1 : 1;
      return String(pa.name).localeCompare(String(pb.name));
    });
  }

  // ---- persistence ------------------------------------------------------------------------
  async function persist() {
    var payload = {};
    payload[keys.PROFILES] = state.profiles;
    payload[keys.ACTIVE_PROFILE_ID] = state.activeProfileId;
    try {
      await chrome.storage.sync.set(payload);
    } catch (e) {
      showWarning('Could not save — ' + (e && e.message ? e.message : 'sync storage error') + '.');
      return;
    }
    checkQuota();
  }

  function checkQuota() {
    var size = JSON.stringify(state.profiles || {}).length;
    if (size > SYNC_WARN_BYTES) {
      showWarning('Your profiles are getting large (' + size + ' bytes). chrome.storage.sync caps at ~100 KB; consider trimming profiles.');
    } else {
      hideWarning();
    }
  }

  function showWarning(text) {
    var box = document.getElementById('uflx-opt-warning');
    box.textContent = text;
    box.hidden = false;
  }

  function hideWarning() {
    var box = document.getElementById('uflx-opt-warning');
    box.hidden = true;
    box.textContent = '';
  }

  // Tell the service worker to fan PROFILE_CHANGED out to open uflscout.com tabs.
  function broadcastProfileChanged() {
    try { send({ type: messages.PROFILE_CHANGED, activeProfileId: state.activeProfileId }); } catch (e) { /* ignore */ }
  }

  // ---- data load --------------------------------------------------------------------------
  async function computeUniverse() {
    var set = {};
    function add(list) { (list || []).forEach(function (k) { set[k] = true; }); }

    // 1) keys used by existing profiles
    Object.keys(state.profiles).forEach(function (id) { add(state.profiles[id].statKeys); });
    // 2) keys the extension knows about (fallback universe)
    add(statMath.knownStatKeys());
    // 3) real keys discovered from any cached/selected players
    try {
      var sel = await send({ type: messages.SELECTION_GET });
      var ids = ((sel && sel.list) || []).map(function (e) { return Number(e.id); }).filter(Number.isFinite);
      if (ids.length) {
        var res = await send({ type: messages.PLAYERS_GET_MANY, playerIds: ids });
        ((res && res.players) || []).forEach(function (entry) {
          if (entry && entry.player) add(statMath.discoverStatKeys(entry.player));
        });
      }
    } catch (e) { /* offline / no players — fallback universe is enough */ }

    state.universe = Object.keys(set).sort();
  }

  async function load() {
    var stored = await chrome.storage.sync.get([keys.PROFILES, keys.ACTIVE_PROFILE_ID]);
    var profiles = stored[keys.PROFILES];
    var hasProfiles = profiles && typeof profiles === 'object' && Object.keys(profiles).length > 0;
    if (!hasProfiles) {
      var def = defaults.build();
      state.profiles = def.profiles;
      state.activeProfileId = def.activeProfileId;
      await persist();
    } else {
      state.profiles = profiles;
      state.activeProfileId = stored[keys.ACTIVE_PROFILE_ID] && profiles[stored[keys.ACTIVE_PROFILE_ID]]
        ? stored[keys.ACTIVE_PROFILE_ID] : Object.keys(profiles)[0];
    }
    state.selectedProfileId = state.activeProfileId;
    await computeUniverse();
    render();
  }

  // ---- rendering: left list ---------------------------------------------------------------
  function renderList() {
    var list = document.getElementById('uflx-profile-list');
    list.innerHTML = '';
    orderedProfileIds().forEach(function (id) {
      var p = state.profiles[id];
      var li = el('li', {
        class: 'uflx-profile-item'
          + (id === state.selectedProfileId ? ' is-selected' : '')
          + (id === state.activeProfileId ? ' is-active' : '')
      });

      var nameBtn = el('button', { class: 'uflx-profile-name', type: 'button' }, [
        el('span', { class: 'uflx-profile-name-text', text: p.name }),
        p.isDefault ? el('span', { class: 'uflx-badge-default', text: 'default' }) : null,
        id === state.activeProfileId ? el('span', { class: 'uflx-badge-active', text: 'active' }) : null
      ]);
      nameBtn.addEventListener('click', function () { selectProfile(id); });
      li.appendChild(nameBtn);

      var actions = el('div', { class: 'uflx-profile-actions' });

      var activateBtn = el('button', { class: 'uflx-btn uflx-btn--sm', type: 'button', text: 'Activate' });
      activateBtn.disabled = id === state.activeProfileId;
      activateBtn.addEventListener('click', function () { activateProfile(id); });
      actions.appendChild(activateBtn);

      var renameBtn = el('button', { class: 'uflx-btn uflx-btn--sm', type: 'button', text: 'Rename' });
      renameBtn.addEventListener('click', function () { renameProfile(id); });
      actions.appendChild(renameBtn);

      var delBtn = el('button', { class: 'uflx-btn uflx-btn--sm uflx-btn--danger', type: 'button', text: 'Delete' });
      delBtn.addEventListener('click', function () { deleteProfile(id); });
      actions.appendChild(delBtn);

      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  // ---- rendering: right editor ------------------------------------------------------------
  function renderEditor() {
    var title = document.getElementById('uflx-editor-title');
    var count = document.getElementById('uflx-editor-count');
    var editor = document.getElementById('uflx-editor');
    editor.innerHTML = '';

    var p = state.profiles[state.selectedProfileId];
    if (!p) {
      title.textContent = 'Select a profile';
      count.textContent = '';
      editor.appendChild(el('div', { class: 'uflx-editor-empty', text: 'Pick a profile on the left to edit its stats.' }));
      return;
    }

    title.textContent = p.name;
    count.textContent = p.statKeys.length + ' stat' + (p.statKeys.length === 1 ? '' : 's') + ' selected';

    var selected = new Set(p.statKeys);
    var groups = statMath.groupStatKeys(state.universe);

    groups.forEach(function (group) {
      var section = el('div', { class: 'uflx-stat-group' }, [
        el('div', { class: 'uflx-stat-group-title', text: group.label })
      ]);
      var grid = el('div', { class: 'uflx-stat-grid' });
      group.keys.forEach(function (key) {
        var input = el('input', { type: 'checkbox', class: 'uflx-stat-cb' });
        input.checked = selected.has(key);
        input.addEventListener('change', function () { toggleStat(state.selectedProfileId, key, input.checked); });
        var label = el('label', { class: 'uflx-stat-label' }, [
          input,
          el('span', { text: statMath.humanizeStatKey(key) })
        ]);
        grid.appendChild(label);
      });
      section.appendChild(grid);
      editor.appendChild(section);
    });
  }

  function render() {
    renderList();
    renderEditor();
  }

  // ---- actions ----------------------------------------------------------------------------
  function selectProfile(id) {
    state.selectedProfileId = id;
    render();
  }

  async function activateProfile(id) {
    if (!state.profiles[id]) return;
    state.activeProfileId = id;
    await persist();
    broadcastProfileChanged();
    render();
  }

  async function newProfile() {
    var name = window.prompt('Name for the new profile:', 'My Profile');
    if (name == null) return;
    name = name.trim();
    if (!name) return;
    var id = slugify(name);
    state.profiles[id] = { id: id, name: name, statKeys: [], isDefault: false };
    state.selectedProfileId = id;
    await persist();
    render();
  }

  async function renameProfile(id) {
    var p = state.profiles[id];
    if (!p) return;
    var name = window.prompt('Rename profile:', p.name);
    if (name == null) return;
    name = name.trim();
    if (!name) return;
    p.name = name;
    await persist();
    if (id === state.activeProfileId) broadcastProfileChanged();
    render();
  }

  async function deleteProfile(id) {
    var p = state.profiles[id];
    if (!p) return;
    if (!window.confirm('Delete profile "' + p.name + '"?')) return;
    delete state.profiles[id];

    if (state.activeProfileId === id) {
      state.activeProfileId = Object.keys(state.profiles)[0] || '';
    }
    if (state.selectedProfileId === id) {
      state.selectedProfileId = state.activeProfileId || Object.keys(state.profiles)[0] || '';
    }
    await persist();
    broadcastProfileChanged();
    render();
  }

  async function toggleStat(profileId, key, checked) {
    var p = state.profiles[profileId];
    if (!p) return;
    var set = new Set(p.statKeys);
    if (checked) set.add(key); else set.delete(key);
    p.statKeys = Array.from(set);
    await persist();
    // live-update the modal's Custom column if this is the active profile
    if (profileId === state.activeProfileId) broadcastProfileChanged();
    // refresh only the count label without rebuilding the whole grid (keeps focus/scroll)
    var count = document.getElementById('uflx-editor-count');
    if (count && state.selectedProfileId === profileId) {
      count.textContent = p.statKeys.length + ' stat' + (p.statKeys.length === 1 ? '' : 's') + ' selected';
    }
    // keep the left-list selected/active state in sync
    renderList();
  }

  async function resetDefaults() {
    if (!window.confirm('Reset the default profiles (CB, FB, CM, …) to their shipped stat sets? Your custom profiles are kept.')) return;
    var def = defaults.build();
    Object.keys(def.profiles).forEach(function (id) {
      state.profiles[id] = def.profiles[id];
    });
    if (!state.profiles[state.activeProfileId]) state.activeProfileId = def.activeProfileId;
    state.selectedProfileId = state.activeProfileId;
    await persist();
    broadcastProfileChanged();
    render();
  }

  // ---- boot -------------------------------------------------------------------------------
  function wire() {
    document.getElementById('uflx-new-profile').addEventListener('click', newProfile);
    document.getElementById('uflx-reset-defaults').addEventListener('click', resetDefaults);
  }

  document.addEventListener('DOMContentLoaded', function () {
    wire();
    load();
  });
})(globalThis.uflx = globalThis.uflx || {});
