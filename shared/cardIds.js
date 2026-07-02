// Card-id helpers — distinguish the *person* (uflId) from the *card variant* (the promo release).
//
// Why this exists: every card anchor for the same footballer shares the SAME numeric path id,
// which is the person-level `uflId` (e.g. all 9 Valverde cards link to `/players/957/...`).
// The stat API (`/api/players/{id}`) is keyed on the per-variant id instead (e.g. 69361), which
// the site embeds in the card render image `.../static-cards/{variantId}-{hash}.png`. These
// helpers extract the right id so the extension selects/fetches the exact card that was clicked.
//
// Classic script: attaches to globalThis.uflx.cardIds. Pure (string in / value out) so the Node
// test runner can require it directly — no DOM, no chrome.* here.
(function (root) {
  'use strict';

  // Person id + slug from a card href, e.g. "/players/957/valverde/t3/nike-surge"
  //   -> { uflId: 957, slug: "valverde/t3/nike-surge" }.
  // The slug (promo/mastery segments) is what disambiguates the variant for the same person.
  function parseCardRef(href) {
    if (!href) return null;
    var path = String(href);
    try { path = new URL(href, 'https://uflscout.com').pathname; } catch (e) { /* keep raw */ }
    var m = /^\/players\/(\d+)(?:\/([^?#]*))?/.exec(path);
    if (!m) return null;
    var slug = (m[2] || '').replace(/\/+$/, '');
    return { uflId: Number(m[1]), slug: slug };
  }

  // Variant id embedded in a static-card image URL, e.g.
  //   ".../static-cards/69361-cec2c3f336193664.png?width=300" -> 69361.
  // Dynamically generated base/mastery cards use ".../static-cards/dyn/{uflId}-{ts}.png"; that
  // path carries the *person* id, not a variant id, so it is intentionally NOT matched here.
  function variantIdFromImageSrc(src) {
    if (!src) return null;
    var m = /\/static-cards\/(\d+)-/.exec(String(src));
    return m ? Number(m[1]) : null;
  }

  root.cardIds = {
    parseCardRef: parseCardRef,
    variantIdFromImageSrc: variantIdFromImageSrc
  };
})(globalThis.uflx = globalThis.uflx || {});
