// CardDecorator — detects player-card anchors and injects the +/- selection toggle.
// Classic script: attaches to globalThis.uflx.cardDecorator.
//
// A card is identified by its per-variant id (the specific promo/mastery release), NOT by the
// person-level uflId shared across all of a player's cards. The variant id is read for free from
// the card render image (.../static-cards/{variantId}-...png). Dynamically generated base/mastery
// cards use .../static-cards/dyn/{uflId}-...png (no variant id), so those are resolved lazily via
// the service worker (RESOLVE_VARIANT) from the card's own detail page — see variantResolver.js.
(function (root) {
  'use strict';

  var DECORATED_ATTR = 'data-uflx-decorated';

  // Only decorate player anchors that live inside the main results grid (#player-grid) or the
  // search-results list (a <ul>). This keeps the +/- badge out of unwanted spots such as related-
  // player carousels, tooltips, the detail-page hero and the /compare cards.
  var SCOPE_SELECTOR =
    '#player-grid a[href^="/players/"]:not([' + DECORATED_ATTR + ']), ' +
    'ul a[href^="/players/"]:not([' + DECORATED_ATTR + '])';

  var selectedIds = new Set();          // variant ids currently in the selection list
  var observer = null;
  var scheduled = false;
  var pending = new Set();
  var resolveCache = new Map();         // "uflId/slug" -> variantId (session-lived, content side)
  var resolveInFlight = new Map();      // "uflId/slug" -> Promise<variantId|null>

  function send(msg) {
    return chrome.runtime.sendMessage(msg);
  }

  // First static-card image src associated with the anchor (inside it, else its nearest card
  // container). Its presence also tells us the anchor is a real card (vs. a plain text link).
  function cardImageSrc(anchor) {
    function fromImg(img) {
      if (!img) return null;
      var s = img.getAttribute('src') || img.getAttribute('data-src') || img.currentSrc || img.src || '';
      if (s.indexOf('static-cards') !== -1) return s;
      var srcset = img.getAttribute('srcset');
      if (srcset && srcset.indexOf('static-cards') !== -1) return srcset;
      return null;
    }
    var imgs = anchor.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var hit = fromImg(imgs[i]);
      if (hit) return hit;
    }
    var container = anchor.closest('li, article, [class*="card"], div');
    if (container) {
      var outer = container.querySelectorAll('img[src*="static-cards"]');
      if (outer.length) return outer[0].getAttribute('src') || outer[0].src;
    }
    return null;
  }

  function badgeVariantId(btn) {
    var n = Number(btn.dataset.uflxId);
    return Number.isFinite(n) ? n : null;
  }

  function renderBadge(btn) {
    var id = badgeVariantId(btn);
    var inList = id != null && selectedIds.has(id);
    btn.textContent = inList ? '\u2212' : '+'; // "−" / "+"
    btn.classList.toggle('uflx-toggle--in', inList);
    btn.title = inList ? 'Remove from comparison' : 'Add to comparison';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(inList));
  }

  // Resolve (and memoise) the variant id for a dyn card from its uflId + slug.
  function resolveVariant(uflId, slug) {
    var key = uflId + '/' + slug;
    if (resolveCache.has(key)) return Promise.resolve(resolveCache.get(key));
    if (resolveInFlight.has(key)) return resolveInFlight.get(key);

    var p = send({ type: root.messages.RESOLVE_VARIANT, uflId: uflId, slug: slug })
      .then(function (res) {
        var id = res && Number.isFinite(res.variantId) ? res.variantId : null;
        if (id != null) resolveCache.set(key, id);
        return id;
      })
      .catch(function () { return null; })
      .finally(function () { resolveInFlight.delete(key); });

    resolveInFlight.set(key, p);
    return p;
  }

  function applyResolvedId(btn, id) {
    if (id == null || !btn.isConnected) return;
    btn.dataset.uflxId = String(id);
    renderBadge(btn);
  }

  async function onToggle(btn) {
    var id = badgeVariantId(btn);
    if (id == null) {
      // Dyn card whose variant id isn't known yet — resolve on demand before toggling.
      btn.classList.add('uflx-toggle--busy');
      try {
        id = await resolveVariant(Number(btn.dataset.uflxUfl), btn.dataset.uflxSlug || '');
      } finally {
        btn.classList.remove('uflx-toggle--busy');
      }
      if (id == null) { console.warn('[uflx] could not resolve card variant'); return; }
      btn.dataset.uflxId = String(id);
    }

    // Optimistic flip for snappiness; the SELECTION_CHANGED broadcast reconciles everything.
    if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
    renderBadge(btn);
    try {
      var res = await send({ type: root.messages.SELECTION_TOGGLE, playerId: id });
      if (res && typeof res.inList === 'boolean') {
        if (res.inList) selectedIds.add(id); else selectedIds.delete(id);
        refreshAll();
      }
    } catch (e) {
      console.warn('[uflx] toggle failed', e);
    }
  }

  function decorate(anchor) {
    if (!anchor || anchor.getAttribute(DECORATED_ATTR)) return;
    var ref = root.cardIds.parseCardRef(anchor.getAttribute('href') || anchor.href);
    if (!ref || !Number.isFinite(ref.uflId)) return;
    anchor.setAttribute(DECORATED_ATTR, '1');

    // Marker used purely as the :hover target for revealing the badge (adds no positioning of its
    // own), so hover works regardless of the anchor's original CSS position.
    anchor.classList.add('uflx-toggle-host');

    // Ensure the badge can be absolutely positioned without disturbing the site's layout.
    try {
      if (getComputedStyle(anchor).position === 'static') anchor.classList.add('uflx-card-host');
    } catch (e) { anchor.classList.add('uflx-card-host'); }

    var imgSrc = cardImageSrc(anchor);
    var variantId = root.cardIds.variantIdFromImageSrc(imgSrc);

    var btn = document.createElement('button');
    btn.className = 'uflx-toggle';
    btn.type = 'button';
    btn.dataset.uflxUfl = String(ref.uflId);
    btn.dataset.uflxSlug = ref.slug;
    if (variantId != null) btn.dataset.uflxId = String(variantId);
    renderBadge(btn);
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      onToggle(btn);
    });
    anchor.appendChild(btn);

    // Dyn card (real card image but no embedded variant id): resolve eagerly so the badge shows
    // the correct +/- state without waiting for a click. Non-card links (no card image) are left
    // unresolved and only resolve on click, to avoid unnecessary detail-page fetches.
    if (variantId == null && imgSrc) {
      resolveVariant(ref.uflId, ref.slug).then(function (id) { applyResolvedId(btn, id); });
    }
  }

  function scheduleFlush() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(flush);
  }

  function flush() {
    scheduled = false;
    var batch = Array.from(pending);
    pending.clear();
    batch.forEach(decorate);
  }

  function collect() {
    var nodes = document.querySelectorAll(SCOPE_SELECTOR);
    nodes.forEach(function (n) { pending.add(n); });
    if (pending.size) scheduleFlush();
  }

  function refreshAll() {
    document.querySelectorAll('.uflx-toggle').forEach(function (btn) {
      renderBadge(btn);
    });
  }

  function setSelection(list) {
    selectedIds.clear();
    (Array.isArray(list) ? list : []).forEach(function (e) {
      var n = Number(e && e.id);
      if (Number.isFinite(n)) selectedIds.add(n);
    });
    refreshAll();
  }

  async function loadSelection() {
    try {
      var res = await send({ type: root.messages.SELECTION_GET });
      setSelection(res && res.list);
    } catch (e) { /* ignore — badges default to "+" */ }
  }

  function rescan() { collect(); }

  async function start() {
    if (observer) { rescan(); return; }
    await loadSelection();
    collect();
    observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes && mutations[i].addedNodes.length) { collect(); break; }
      }
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  }

  root.cardDecorator = {
    start: start,
    rescan: rescan,
    setSelection: setSelection,
    refreshAll: refreshAll
  };
})(globalThis.uflx = globalThis.uflx || {});
