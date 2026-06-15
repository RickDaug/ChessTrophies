/*
 * ChessTrophies runtime config (web-only).
 *
 * SERVER_URL resolution (see app.js):
 *     window.CT_SERVER_URL || window.location.origin
 *
 * The client must point at the hosted backend whenever the page is NOT being
 * served by that backend itself:
 *   - HOSTED WEB on a different origin (e.g. Vercel www.playchesstrophies.com):
 *     the static host has no /api, so same-origin requests would 404 and login
 *     silently fail -> use BACKEND_URL (cross-origin to Railway; the server CORS
 *     allowlist must include this web origin).
 *   - SAME-ORIGIN as the backend (the Railway URL) or LOCAL DEV (localhost): the
 *     API is already same-origin, so leave CT_SERVER_URL unset.
 */
(function () {
  'use strict';

  // The hosted backend (Railway). Any off-origin web host (Vercel) talks here.
  //
  // ── BACKEND ORIGIN: SOURCE-OF-TRUTH ───────────────────────────────────────
  // This origin is duplicated in THREE places that MUST stay in sync, or login
  // and realtime sockets silently break when the host changes:
  //   1. THIS constant (BACKEND_URL) — the client's API/socket target.
  //   2. index.html CSP `connect-src` — must allow https:// AND wss:// of it,
  //      or the browser blocks the fetch/WebSocket.
  //   3. server/server.js DEFAULT_WEB_ORIGINS — CORS allowlist (the reverse:
  //      the WEB origins allowed to call this backend).
  // If you migrate the backend host, update ALL THREE. (No build step injects
  // this — it is intentionally a plain literal so it works on a static host.)
  var BACKEND_URL = 'https://chesstrophies-production.up.railway.app';

  try {
    if (window.CT_SERVER_URL) return; // explicit override always wins

    var loc = window.location || {};
    var host = (loc.hostname || '').toLowerCase();
    var fullHost = (loc.host || '').toLowerCase();

    // Local development: you run the API on the same local origin.
    var isLocalDev = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '';
    // Already on the backend host -> same-origin is correct, no override.
    var onBackendHost = fullHost.indexOf('chesstrophies-production.up.railway.app') !== -1;

    if (!isLocalDev && !onBackendHost) {
      window.CT_SERVER_URL = BACKEND_URL;
    }
  } catch (e) {
    // On any error, fall back to same-origin (web default) — never throws.
  }
})();
