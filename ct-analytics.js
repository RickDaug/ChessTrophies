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
  var SRC_KEY = 'ct_src';   // first-touch traffic attribution (set once per visitor)
  var UTM_MAX = 64;         // hard cap on any single utm/ref string

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

  // --- First-touch traffic-source attribution -------------------------------
  // Captured ONCE per visitor on first sight and persisted in localStorage so it
  // stays stable across the session/visits. PII-free: we keep only the referrer
  // HOSTNAME (never the full URL) plus the campaign-tag UTM params, each capped.
  var _memSrc = null;

  function clamp(s) {
    if (s == null) return '';
    s = String(s);
    return s.length > UTM_MAX ? s.slice(0, UTM_MAX) : s;
  }

  // Referrer hostname, or 'direct' if empty / same-origin (self-referral).
  function refHost() {
    try {
      var r = document.referrer;
      if (!r) return 'direct';
      var h = new URL(r).hostname;
      var self = (window.location && window.location.hostname) || '';
      if (!h || h === self) return 'direct';
      return clamp(h);
    } catch (e) { return 'direct'; }
  }

  // Build the first-touch src object from the CURRENT page (called only once).
  function captureSrc() {
    var utm = { utm_source: '', utm_medium: '', utm_campaign: '' };
    try {
      var q = new URLSearchParams((window.location && window.location.search) || '');
      utm.utm_source = clamp(q.get('utm_source') || '');
      utm.utm_medium = clamp(q.get('utm_medium') || '');
      utm.utm_campaign = clamp(q.get('utm_campaign') || '');
    } catch (e) { /* ignore */ }
    var path = '';
    try { path = clamp((window.location && window.location.pathname) || ''); } catch (e) { path = ''; }
    return {
      ref: refHost(),
      utm_source: utm.utm_source,
      utm_medium: utm.utm_medium,
      utm_campaign: utm.utm_campaign,
      landingPath: path,
      ts: Date.now(),
    };
  }

  // Return the stored first-touch src, capturing + persisting it on first visit.
  function firstTouchSrc() {
    try {
      var raw = window.localStorage.getItem(SRC_KEY);
      if (raw) { try { return JSON.parse(raw); } catch (e) { /* fall through to recapture */ } }
      var s = captureSrc();
      try { window.localStorage.setItem(SRC_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
      return s;
    } catch (e) {
      if (!_memSrc) _memSrc = captureSrc();
      return _memSrc;
    }
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
      var outMeta = (meta && typeof meta === 'object') ? meta : null;
      // First-touch attribution: auto-attach the stored `src` to the `land`
      // event (and only land, to keep payloads small) when the caller didn't
      // already provide one. This lets app.js keep calling track('land') as-is.
      if (name === 'land' && !(outMeta && outMeta.src)) {
        try {
          var src = firstTouchSrc();
          if (src) outMeta = Object.assign({}, outMeta || {}, { src: src });
        } catch (e) { /* attribution is best-effort; never break the land event */ }
      }
      var body = JSON.stringify({
        name: name,
        visitorId: visitorId(),
        userId: currentUserId(),
        meta: outMeta,
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
