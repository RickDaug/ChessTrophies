// Global error visibility — surface field failures that would otherwise be silent.
// Externalized from an inline <head> <script> so the CSP can use script-src 'self'
// (no 'unsafe-inline'). Loaded synchronously as the FIRST script in <head> so it
// installs these handlers before any other code runs.
//
// Beyond console.error, it ALSO reports to the server (POST /api/client-error) so a
// JS exception that white-screens a brand-new visitor is no longer invisible to us
// (the activation funnel was blind to first-session crashes). Fire-and-forget, like
// ct-analytics: it NEVER throws, swallows all network errors, is capped per page
// load + deduped so a render loop can't flood, and sends NO PII (message, source,
// line/col, a truncated stack, path, anonymous visitorId).
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
