// ComparisonModal — near-full-screen in-site overlay with the sortable/filterable table.
// Classic script: attaches to globalThis.uflx.comparisonModal.
(function (root) {
  'use strict';

  var ROOT_ID = 'uflx-modal-root';

  // Fixed leading/trailing columns; stat-key columns are injected between them at render time.
  var LEAD_COLS = [
    { key: '__toggle', label: '', sortable: false },
    { key: 'name', label: 'Player', sortable: true },
    { key: 'rating', label: 'Rating', sortable: true },
    { key: 'position', label: 'Position', sortable: true }
  ];

  var state = {
    open: false,
    rows: [],            // [{ id, name, rating, position, image, stats, inGame, custom, _player }]
    statKeys: [],        // union of discovered stat keys across all rows
    profiles: {},        // Record<id, Profile>
    activeProfileId: '',
    sort: { key: 'inGame', dir: 'desc' },
    filters: { position: new Set() },
    prevOverflow: '',
    keydownHandler: null
  };

  function send(msg) { return chrome.runtime.sendMessage(msg); }

  // ---- small DOM helper -------------------------------------------------------------------
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

  function pick(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = obj ? obj[keys[i]] : undefined;
      if (v != null && v !== '') return v;
    }
    return undefined;
  }

  function toNumber(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function fmt(v) {
    return v == null ? '\u2014' : String(Math.round(v));
  }

  // Ensure a usable absolute URL for a card render (the API sometimes returns a relative path).
  function normalizeImage(src) {
    if (!src) return '';
    var s = String(src);
    if (/^https?:\/\//.test(s)) return s;
    if (s.charAt(0) === '/') return 'https://cdn.uflscout.com' + s;
    return s;
  }

  function extractMeta(player, id) {
    var p = player || {};
    var pos = pick(p, ['position', 'pos', 'mainPosition']);
    if (pos == null && Array.isArray(p.positions) && p.positions.length) pos = p.positions[0];
    return {
      id: id,
      // Prefer the card label ("VALVERDE"), then the display name, then the full name.
      name: pick(p, ['cardName', 'card_name', 'ckaName', 'cka_name', 'displayName', 'shortName', 'knownAs', 'name', 'fullName']) || ('#' + id),
      rating: toNumber(pick(p, ['rating', 'overall', 'ovr'])),
      position: pos != null ? String(pos) : '',
      image: normalizeImage(pick(p, ['masteryCustomImageUrl', 'mastery_custom_image_url', 'imageUrl', 'image_url', 'cardImage', 'image', 'cardUrl', 'card', 'staticCard']))
    };
  }

  function activeStatKeys() {
    var prof = state.profiles[state.activeProfileId];
    return prof && Array.isArray(prof.statKeys) ? prof.statKeys : [];
  }

  function recomputeCustom() {
    var keys = activeStatKeys();
    state.rows.forEach(function (row) {
      row.custom = root.statMath.profileSum(row._player, keys);
    });
  }

  // ---- data build -------------------------------------------------------------------------
  function buildRows(selection, playersById) {
    var rows = [];
    var keySet = new Set();
    var custKeys = activeStatKeys();

    selection.forEach(function (entry) {
      var id = Number(entry && entry.id);
      if (!Number.isFinite(id)) return;
      var player = playersById[id] || null;
      var meta = extractMeta(player, id);
      var stats = root.statMath.resolveStatDict(player);
      Object.keys(stats).forEach(function (k) { keySet.add(k); });
      rows.push({
        id: id,
        name: meta.name,
        rating: meta.rating,
        position: meta.position,
        image: meta.image,
        stats: stats,
        inGame: root.statMath.inGameSum(player),
        custom: root.statMath.profileSum(player, custKeys),
        _player: player
      });
    });

    state.rows = rows;
    // Drop unwanted columns (GK stats, promo/alt-id metadata) and de-duplicate
    // snake_case/camelCase pairs before sorting for display.
    state.statKeys = root.statMath.displayStatKeys(Array.from(keySet).sort());
  }

  function distinctValues(field) {
    var set = new Set();
    state.rows.forEach(function (r) { if (r[field] !== '' && r[field] != null) set.add(String(r[field])); });
    return Array.from(set).sort();
  }

  function applyFilters(rows) {
    return rows.filter(function (r) {
      return ['position'].every(function (f) {
        var sel = state.filters[f];
        return sel.size === 0 || sel.has(String(r[f]));
      });
    });
  }

  // ---- rendering --------------------------------------------------------------------------
  function ensureRoot() {
    var node = document.getElementById(ROOT_ID);
    if (node) return node;
    node = el('div', { id: ROOT_ID });
    node.appendChild(el('div', { class: 'uflx-modal-backdrop' }));
    node.appendChild(el('div', { class: 'uflx-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Player comparison' }));
    document.body.appendChild(node);

    node.querySelector('.uflx-modal-backdrop').addEventListener('click', close);
    return node;
  }

  function headerCell(colKey, label, sortable) {
    var attrs = { class: 'uflx-th' };
    var indicator = '';
    if (sortable) {
      attrs.class += ' uflx-th--sortable';
      attrs['data-col'] = colKey;
      if (state.sort.key === colKey) {
        attrs.class += ' uflx-th--active';
        indicator = state.sort.dir === 'asc' ? ' \u25B2' : ' \u25BC';
      }
    }
    var th = el('th', attrs, [label + indicator]);
    if (sortable) th.addEventListener('click', function () { onSort(colKey); });
    return th;
  }

  function buildHead() {
    var tr = el('tr');

    // Fixed toggle (remove) column stays first.
    tr.appendChild(headerCell(LEAD_COLS[0].key, LEAD_COLS[0].label, LEAD_COLS[0].sortable));

    // Aggregate columns (In-game + Custom) come next so they are the leading data columns.
    tr.appendChild(headerCell('inGame', 'In-game', true));
    var prof = state.profiles[state.activeProfileId];
    var custLabel = 'Custom' + (prof ? ' (' + prof.name + ')' : '');
    tr.appendChild(headerCell('custom', custLabel, true));

    // Remaining descriptive columns (Player, Rating, Position).
    LEAD_COLS.slice(1).forEach(function (c) { tr.appendChild(headerCell(c.key, c.label, c.sortable)); });

    // Then the individual stat-key columns.
    state.statKeys.forEach(function (k) {
      tr.appendChild(headerCell(k, root.statMath.humanizeStatKey(k), true));
    });
    return el('thead', null, [tr]);
  }

  function buildRow(row) {
    const tr = el('tr', {'data-id': String(row.id)});

    // toggle (−) cell
    const rm = el('button', {
      class: 'uflx-row-remove',
      type: 'button',
      title: 'Remove from selection',
      'aria-label': 'Remove from selection'
    }, ['\u2212']);
    rm.addEventListener('click', function () { onRemove(row.id); });
    tr.appendChild(el('td', { class: 'uflx-td uflx-td--toggle' }, [rm]));

    // aggregate cells (In-game + Custom) come first, mirroring the header order
    tr.appendChild(el('td', { class: 'uflx-td uflx-td--agg' }, [fmt(row.inGame)]));
    tr.appendChild(el('td', { class: 'uflx-td uflx-td--agg' }, [fmt(row.custom)]));

    // player cell (image if available, else name)
    const playerCellChildren = [];
    if (row.image) {
      const img = el('img', {class: 'uflx-modal-card-img', src: row.image, alt: row.name, loading: 'lazy'});
      img.addEventListener('error', function () { img.style.display = 'none'; });
      // Anchor (opens the original UFL Scout player page in a new tab) styled to keep the
      // previous DIV's block layout so the card visuals are unchanged. Same class as before.
      const imgContainer = el('a', {
        class: 'uflx-modal-img-holder',
        href: 'https://uflscout.com/players/' + row.id,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: 'Open ' + row.name + ' on UFL Scout'
      }, [img]);
      playerCellChildren.push(imgContainer);
    }
    playerCellChildren.push(el('span', { class: 'uflx-modal-name', text: row.name }));
    tr.appendChild(el('td', { class: 'uflx-td uflx-td--player' }, playerCellChildren));

    tr.appendChild(el('td', { class: 'uflx-td' }, [fmt(row.rating)]));
    tr.appendChild(el('td', { class: 'uflx-td' }, [row.position || '\u2014']));

    state.statKeys.forEach(function (k) {
      var v = row.stats[k];
      tr.appendChild(el('td', { class: 'uflx-td uflx-td--stat' }, [v == null ? '\u2014' : String(v)]));
    });

    return tr;
  }

  function renderChips(container) {
    container.innerHTML = '';
    ['position'].forEach(function (field) {
      var values = distinctValues(field);
      if (!values.length) return;
      var group = el('div', { class: 'uflx-filter-group' }, [
        el('span', { class: 'uflx-filter-label', text: field.charAt(0).toUpperCase() + field.slice(1) })
      ]);
      values.forEach(function (val) {
        var active = state.filters[field].has(val);
        var chip = el('button', {
          class: 'uflx-chip' + (active ? ' uflx-chip--on' : ''),
          type: 'button',
          text: val
        });
        chip.addEventListener('click', function () {
          if (state.filters[field].has(val)) state.filters[field].delete(val);
          else state.filters[field].add(val);
          renderChips(container);
          renderBody();
        });
        group.appendChild(chip);
      });
      container.appendChild(group);
    });
  }

  function renderBody() {
    var modal = document.querySelector('#' + ROOT_ID + ' .uflx-modal');
    if (!modal) return;
    var tableWrap = modal.querySelector('.uflx-table-wrap');
    if (!tableWrap) return;

    if (!state.rows.length) {
      tableWrap.innerHTML = '';
      tableWrap.appendChild(el('div', { class: 'uflx-empty' }, [
        'No players selected yet \u2014 click ', el('b', null, ['+']), ' on any card.'
      ]));
      return;
    }

    var visible = applyFilters(state.rows);
    var sorted = root.statMath.sortByColumn(visible, state.sort.key, state.sort.dir);

    var tbody = el('tbody');
    if (!sorted.length) {
      tbody.appendChild(el('tr', null, [
        el('td', { class: 'uflx-td uflx-empty-cell', colspan: String(LEAD_COLS.length + state.statKeys.length + 2) }, ['No players match the current filters.'])
      ]));
    } else {
      sorted.forEach(function (row) { tbody.appendChild(buildRow(row)); });
    }

    var table = el('table', { class: 'uflx-table' }, [buildHead(), tbody]);
    tableWrap.innerHTML = '';
    tableWrap.appendChild(table);
  }

  function renderHeaderBar(modal) {
    var bar = el('div', { class: 'uflx-modal-header' });

    bar.appendChild(el('div', { class: 'uflx-modal-title', text: 'UFL Scout \u2014 Comparison' }));

    // active profile picker
    var profileWrap = el('label', { class: 'uflx-profile-picker' }, [el('span', { text: 'Custom profile:' })]);
    var select = el('select', { class: 'uflx-profile-select' });
    Object.keys(state.profiles).forEach(function (id) {
      var opt = el('option', { value: id, text: state.profiles[id].name });
      if (id === state.activeProfileId) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', function () { setActiveProfile(select.value); });
    profileWrap.appendChild(select);
    bar.appendChild(profileWrap);

    var closeBtn = el('button', { class: 'uflx-modal-close', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close' }, ['\u2715']);
    closeBtn.addEventListener('click', close);
    bar.appendChild(closeBtn);

    modal.appendChild(bar);

    var chips = el('div', { class: 'uflx-filter-row' });
    modal.appendChild(chips);
    renderChips(chips);

    modal.appendChild(el('div', { class: 'uflx-table-wrap' }));
  }

  function renderShell() {
    var node = ensureRoot();
    var modal = node.querySelector('.uflx-modal');
    modal.innerHTML = '';
    renderHeaderBar(modal);
    renderBody();
  }

  // ---- interactions -----------------------------------------------------------------------
  function onSort(colKey) {
    if (state.sort.key !== colKey) {
      state.sort = { key: colKey, dir: 'desc' };
    } else if (state.sort.dir === 'desc') {
      state.sort.dir = 'asc';
    } else {
      state.sort = { key: 'inGame', dir: 'desc' }; // tri-state -> back to default
    }
    renderBody();
  }

  async function onRemove(id) {
    try {
      await send({ type: root.messages.SELECTION_TOGGLE, playerId: id });
      // The SELECTION_CHANGED broadcast will trigger rebuild(); update locally too for immediacy.
      state.rows = state.rows.filter(function (r) { return r.id !== id; });
      renderBody();
    } catch (e) {
      console.warn('[uflx] remove failed', e);
    }
  }

  async function setActiveProfile(id) {
    if (!id || id === state.activeProfileId) return;
    state.activeProfileId = id;
    try { await chrome.storage.sync.set({ [root.storageKeys.ACTIVE_PROFILE_ID]: id }); } catch (e) { /* ignore */ }
    recomputeCustom();
    renderShell();
    try { chrome.runtime.sendMessage({ type: root.messages.PROFILE_CHANGED, activeProfileId: id }); } catch (e) { /* ignore */ }
  }

  // ---- public lifecycle -------------------------------------------------------------------
  async function rebuild(selectionOverride) {
    var selection = selectionOverride;
    if (!selection) {
      var selRes = await send({ type: root.messages.SELECTION_GET });
      selection = (selRes && selRes.list) || [];
    }

    var profRes = await send({ type: root.messages.PROFILES_GET });
    state.profiles = (profRes && profRes.profiles) || {};
    var incomingActive = profRes && profRes.activeProfileId;
    if (!state.activeProfileId || !state.profiles[state.activeProfileId]) {
      state.activeProfileId = incomingActive && state.profiles[incomingActive]
        ? incomingActive : Object.keys(state.profiles)[0] || '';
    }

    var ids = selection.map(function (e) { return Number(e.id); }).filter(Number.isFinite);
    var playersById = {};
    if (ids.length) {
      var res = await send({ type: root.messages.PLAYERS_GET_MANY, playerIds: ids });
      ((res && res.players) || []).forEach(function (entry) {
        if (entry && entry.player) playersById[entry.id] = entry.player;
      });
    }

    buildRows(selection, playersById);
    renderShell();
  }

  function attachKeydown() {
    state.keydownHandler = function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    };
    document.addEventListener('keydown', state.keydownHandler, true);
  }

  async function open() {
    if (state.open) { await rebuild(); return; }
    state.open = true;
    state.prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    renderShell(); // shows a shell (empty) immediately
    attachKeydown();
    await rebuild();
  }

  function close() {
    state.open = false;
    var node = document.getElementById(ROOT_ID);
    if (node && node.parentNode) node.parentNode.removeChild(node);
    document.body.style.overflow = state.prevOverflow || '';
    if (state.keydownHandler) {
      document.removeEventListener('keydown', state.keydownHandler, true);
      state.keydownHandler = null;
    }
  }

  function toggle() { if (state.open) close(); else open(); }

  function handleSelectionChanged(list) {
    if (state.open) rebuild(list);
  }

  function handleProfileChanged(activeProfileId) {
    if (!state.open) return;
    if (activeProfileId && activeProfileId !== state.activeProfileId && state.profiles[activeProfileId]) {
      state.activeProfileId = activeProfileId;
      recomputeCustom();
      renderShell();
    }
  }

  function handleRouteChange() { if (state.open) close(); }

  function init() { /* nothing to pre-wire; listeners are attached on open */ }

  root.comparisonModal = {
    init: init,
    open: open,
    close: close,
    toggle: toggle,
    isOpen: function () { return state.open; },
    handleSelectionChanged: handleSelectionChanged,
    handleProfileChanged: handleProfileChanged,
    handleRouteChange: handleRouteChange
  };
})(globalThis.uflx = globalThis.uflx || {});
