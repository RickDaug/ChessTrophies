/* ct-head.js — the two render-blocking <head> scripts, merged into ONE request.
 *
 * Was: ct-onerror.js + ct-boot.js (two separate synchronous <head> <script>s).
 * PageSpeed flagged each as a render-blocking request; combining them removes one
 * network round-trip on the critical path while preserving order and timing:
 *   1) the global error handler installs FIRST (before any other code runs), then
 *   2) the boot-splash marker is set BEFORE the body paints.
 * Both are independent synchronous IIFEs, so concatenation is behaviour-identical.
 * Externalized (not inline) so the CSP keeps script-src 'self' (no 'unsafe-inline').
 */

// ── 1. Global error visibility ───────────────────────────────────────────────
// Surface field failures that would otherwise be silent. Installed as the very
// first thing so it catches errors from every later script. Beyond console.error
// it reports to the server (POST /api/client-error) so a JS exception that
// white-screens a brand-new visitor isn't invisible. Fire-and-forget: NEVER
// throws, swallows all network errors, capped + deduped per page load, no PII.
(function () {
  'use strict';

  var MAX_REPORTS = 8; // per page load — a tight cap so a crash loop can't flood
  var sent = 0;
  var seen = {};       // dedupe identical (message|source|line) reports

  // Same API base the rest of the app uses (config.js sets CT_SERVER_URL for the
  // off-origin web host; else same-origin). Resolved lazily at report time so it
  // picks up CT_SERVER_URL even though this script loads before config.js.
  function apiBase() {
    try { return String(window.CT_SERVER_URL || (window.location && window.location.origin) || '').replace(/\/$/, ''); }
    catch (e) { return ''; }
  }
  function vid() { try { return window.localStorage.getItem('ct_vid') || ''; } catch (e) { return ''; } }
  function noop() {}

  function report(kind, message, source, line, col, stack) {
    try {
      if (typeof fetch !== 'function') return;
      if (sent >= MAX_REPORTS) return;
      var key = String(message || '') + '|' + String(source || '') + '|' + String(line || '');
      if (seen[key]) return;
      seen[key] = 1;
      sent++;
      var body = JSON.stringify({
        kind: kind,
        message: String(message == null ? '' : message).slice(0, 500),
        source: String(source || '').slice(0, 300),
        line: (typeof line === 'number') ? line : null,
        col: (typeof col === 'number') ? col : null,
        stack: String(stack || '').slice(0, 2000),
        path: (window.location && window.location.pathname) || '',
        visitorId: vid(),
      });
      var p = fetch(apiBase() + '/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,   // survive a page unload / white-screen
        credentials: 'omit',
        cache: 'no-store',
      });
      if (p && typeof p.then === 'function') p.then(noop, noop);
    } catch (_) { /* reporting must never break the page further */ }
  }

  window.addEventListener('error', function (e) {
    try { console.error('[CT error]', (e && e.message) || e, e && e.filename, e && e.lineno); } catch (_) {}
    try {
      var stk = (e && e.error && e.error.stack) ? e.error.stack : '';
      report('error', (e && e.message) || 'error', e && e.filename, e && e.lineno, e && e.colno, stk);
    } catch (_) {}
  });
  window.addEventListener('unhandledrejection', function (e) {
    try { console.error('[CT error] unhandled rejection:', e && e.reason); } catch (_) {}
    try {
      var r = e && e.reason;
      var msg = (r && r.message) ? r.message : String(r);
      var stk = (r && r.stack) ? r.stack : '';
      report('unhandledrejection', msg, '', null, null, stk);
    } catch (_) {}
  });
})();

// ── 2. Boot splash (runs BEFORE the body paints) ─────────────────────────────
// Prevents the sign-in screen from flashing for an already-signed-in user on
// refresh: if a session exists, mark <html> so CSS hides the auth form and shows
// a neutral splash until app.js picks the right screen. app.js clears the marker
// once it has decided (see init()/doneBoot). A fallback timer clears it too, so a
// JS failure can never leave the splash stuck.
(function () {
  'use strict';
  try {
    var raw = sessionStorage.getItem('chesstrophies_session_v1') ||
              localStorage.getItem('chesstrophies_session_v1');
    if (raw) {
      var s = JSON.parse(raw);
      // A token (real login), a guest flag, or a stored userId (offline) all mean
      // "don't show the sign-in form first".
      if (s && (s.token || s.guest || s.userId)) {
        document.documentElement.classList.add('ct-has-session');
      }
    }
  } catch (e) { /* storage blocked: fall through to normal sign-in screen */ }
  // Safety net: never let the splash linger if app.js never runs.
  try {
    setTimeout(function () {
      document.documentElement.classList.remove('ct-has-session');
    }, 8000);
  } catch (e) {}
})();
