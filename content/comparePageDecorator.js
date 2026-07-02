// ComparePageDecorator — injects an "In-game stats" pill into each /compare mastery-static-card.
// Classic script: attaches to globalThis.uflx.comparePageDecorator. Runs only on /compare.
(function (root) {
  'use strict';

  var DECOR_ATTR = 'data-uflx-compare-decorated';
  var ID_ATTR = 'data-uflx-compare-id';
  var PILL_CLASS = 'uflx-compare-ingame';

  var scheduled = false;
  var observer = null;

  function send(msg) { return chrome.runtime.sendMessage(msg); }

  function isComparePage() { return location.pathname === '/compare'; }

  // Parse every p{n} query param (forward-compatible if the site adds p4, p5, …), ordered by n.
  function parseIds() {
    var params = new URLSearchParams(location.search);
    var entries = [];
    params.forEach(function (val, key) {
      var m = /^p(\d+)$/.exec(key);
      if (!m) return;
      var id = Number(val);
      if (Number.isFinite(id)) entries.push({ n: Number(m[1]), id: id });
    });
    entries.sort(function (a, b) { return a.n - b.n; });
    return entries.map(function (e) { return e.id; });
  }

  // Top-level compare cards only (skip cards nested inside tooltips/previews).
  function topLevelCards() {
    var all = Array.prototype.slice.call(document.querySelectorAll('div.mastery-static-card'));
    return all.filter(function (card) {
      return !card.parentElement || !card.parentElement.closest('div.mastery-static-card');
    });
  }

  function makePill(total, failed) {
    var pill = document.createElement('div');
    pill.className = PILL_CLASS;
    pill.appendChild(document.createTextNode('In-game '));
    var b = document.createElement('b');
    b.textContent = failed ? '\u2014' : String(Math.round(total));
    pill.appendChild(b);
    if (failed) pill.title = 'Could not fetch this player\u2019s stats';
    return pill;
  }

  function placePill(card, pill) {
    var img = card.querySelector('img');
    if (img && img.parentNode) img.insertAdjacentElement('afterend', pill);
    else card.appendChild(pill);
  }

  async function decorateCard(card, id) {
    if (card.getAttribute(ID_ATTR) === String(id)) return; // already decorated for this id (cache-safe)

    // Reset any prior pill (e.g. the p{n} id changed via SPA navigation).
    card.querySelectorAll('.' + PILL_CLASS).forEach(function (n) { n.remove(); });
    card.setAttribute(DECOR_ATTR, '1');
    card.setAttribute(ID_ATTR, String(id));

    var total = null;
    var failed = false;
    try {
      var res = await send({ type: root.messages.PLAYER_GET, playerId: id });
      if (res && res.player) total = root.statMath.inGameSum(res.player);
      else { failed = true; console.warn('[uflx] compare fetch failed for', id, res && res.error); }
    } catch (e) {
      failed = true;
      console.warn('[uflx] compare fetch error for', id, e);
    }

    // The card may have been re-targeted to a different id while we awaited.
    if (card.getAttribute(ID_ATTR) !== String(id)) return;
    placePill(card, makePill(total, failed));
  }

  function decorate() {
    if (!isComparePage()) return;
    var ids = parseIds();
    var cards = topLevelCards();
    var count = Math.min(ids.length, cards.length);
    for (var i = 0; i < count; i++) decorateCard(cards[i], ids[i]);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () { scheduled = false; decorate(); });
  }

  function start() {
    if (!isComparePage()) return;
    schedule();
    if (!observer) {
      observer = new MutationObserver(function () { if (isComparePage()) schedule(); });
      if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function rescan() { if (isComparePage()) schedule(); }
  function handleSelectionChanged() { if (isComparePage()) schedule(); }

  root.comparePageDecorator = {
    start: start,
    rescan: rescan,
    handleSelectionChanged: handleSelectionChanged
  };
})(globalThis.uflx = globalThis.uflx || {});
