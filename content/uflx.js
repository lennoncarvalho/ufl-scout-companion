// Entry point — runs last in the content-script load order. Wires the SW message listener and
// boots the three feature modules (each guards its own path/DOM preconditions).
(function (root) {
  'use strict';

  var M = root.messages;

  // Listen for broadcasts + targeted messages from the service worker.
  chrome.runtime.onMessage.addListener(function (message) {
    var type = message && message.type;
    switch (type) {
      case M.OPEN_COMPARISON:
        root.comparisonModal.open();
        break;

      case M.SELECTION_CHANGED:
        root.cardDecorator.setSelection(message.list);
        root.comparisonModal.handleSelectionChanged(message.list);
        root.comparePageDecorator.handleSelectionChanged();
        break;

      case M.PROFILE_CHANGED:
        root.comparisonModal.handleProfileChanged(message.activeProfileId);
        break;

      case M.RESCAN:
        root.cardDecorator.rescan();
        root.comparePageDecorator.rescan();
        root.comparisonModal.handleRouteChange();
        break;

      default:
        break;
    }
    // One-way messages only — no response, so nothing is returned here.
  });

  // Announce readiness so the service worker can flush any queued OPEN_COMPARISON.
  try {
    chrome.runtime.sendMessage({ type: M.READY }).catch(function () { /* SW may be starting */ });
  } catch (e) { /* ignore */ }

  function boot() {
    try { root.cardDecorator.start(); } catch (e) { console.warn('[uflx] cardDecorator failed', e); }
    try { root.comparisonModal.init(); } catch (e) { console.warn('[uflx] comparisonModal failed', e); }
    try { root.comparePageDecorator.start(); } catch (e) { console.warn('[uflx] comparePageDecorator failed', e); }
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})(globalThis.uflx = globalThis.uflx || {});
