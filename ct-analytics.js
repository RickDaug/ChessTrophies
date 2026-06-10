/* ct-analytics.js — ChessTrophies privacy-light product analytics (window.CT_Analytics).
 *
 * Tiny, dependency-free, fire-and-forget event tracking. Designed so it can
 * NEVER break gameplay: every public method swallows all errors and no-ops
 * gracefully when fetch is unavailable.
 *
 * PRIVACY: the only identifier it stores is an ANONYMOUS random visitor id in
 * localStorage (`ct_vid`). NO PII, NO fingerprinting, no cookies, no IP logging
 * here. The optional userId is the app's own signed-in/guest id (window.CT.user.id)
 * if a session already exists — never collected by this module.
 *
 * track(name, meta?) POSTs JSON { name, visitorId, userId, meta } to /api/events
 * on the app's API base (window.CT_SERVER_URL || same-origin — the same origin
 * resolution config.js/ct-push.js use), with keepalive:true so events survive a
 * page unload. Errors (incl. a 404 in the static test harness) are swallowed.
 *
 * Event names are allowlisted; anything off-list is a silent no-op.
 */
(function () {
  'use strict';

  var VID_KEY = 'ct_vid';

  // ONLY these event names are ever sent. Off-list names are dropped silently.
  var ALLOWED = {
    land: 1,
    play_start: 1,
    play_finish: 1,
    signup_cta_view: 1,
    signup: 1,
    arena_join: 1,
    puzzle_solve: 1,
    premium_view: 1,
    purchase: 1,
  };

  // Same origin resolution the rest of the app uses (config.js sets
  // window.CT_SERVER_URL for off-origin web hosts; else same-origin).
  function apiBase() {
    var base;
    try { base = (window.CT_SERVER_URL || (window.location && window.location.origin) || ''); }
    catch (e) { base = ''; }
    return String(base).replace(/\/$/, '');
  }

  // Anonymous, stable-per-device visitor id. Generated once and persisted; if
  // localStorage is unavailable we fall back to a per-session in-memory id so
  // events still correlate within a single page load (and never throw).
  var _memVid = null;
  function visitorId() {
    try {
      var v = window.localStorage.getItem(VID_KEY);
      if (!v) {
        v = newId();
        window.localStorage.setItem(VID_KEY, v);
      }
      return v;
    } catch (e) {
      if (!_memVid) _memVid = newId();
      return _memVid;
    }
  }

  function newId() {
    var rnd;
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        var a = new Uint32Array(2);
        window.crypto.getRandomValues(a);
        rnd = a[0].toString(36) + a[1].toString(36);
      }
    } catch (e) { rnd = null; }
    if (!rnd) rnd = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return 'v_' + rnd;
  }

  // The app's current user id (signed-in OR guest) if a session exists, else null.
  // Never PII — it's the app's own opaque user id.
  function currentUserId() {
    try {
      if (window.CT && window.CT.user && window.CT.user.id != null) return window.CT.user.id;
    } catch (e) { /* ignore */ }
    return null;
  }

  // Fire-and-forget. Returns nothing; never throws, never blocks the UI.
  function track(name, meta) {
    try {
      if (!name || !ALLOWED[name]) return;
      if (typeof fetch !== 'function') return;
      var body = JSON.stringify({
        name: name,
        visitorId: visitorId(),
        userId: currentUserId(),
        meta: (meta && typeof meta === 'object') ? meta : null,
      });
      // keepalive lets the request outlive a page unload (e.g. land/purchase).
      var p = fetch(apiBase() + '/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        credentials: 'omit',
        cache: 'no-store',
      });
      // Swallow network/HTTP errors (a 404 in the static harness is expected).
      if (p && typeof p.then === 'function') p.then(noop, noop);
    } catch (e) { /* analytics must never break gameplay */ }
  }

  function noop() {}

  window.CT_Analytics = {
    track: track,
    // Exposed for debugging/tests; harmless + side-effect-free reads.
    visitorId: visitorId,
  };
})();
