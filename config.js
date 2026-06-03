/*
 * ChessTrophies runtime config.
 *
 * SERVER_URL resolution (see app.js):
 *     window.CT_SERVER_URL || window.location.origin
 *
 * The client must point at the hosted backend whenever the page is NOT being
 * served by that backend itself. Three cases:
 *   - NATIVE (Capacitor / file://): the bundle loads from a local scheme that is
 *     not the API host -> use BACKEND_URL.
 *   - HOSTED WEB on a different origin (e.g. Vercel www.playchesstrophies.com):
 *     the static host has no /api, so same-origin requests 404/redirect and login
 *     silently fails -> use BACKEND_URL (cross-origin to Railway; the server CORS
 *     allowlist must include this web origin).
 *   - SAME-ORIGIN as the backend (the Railway URL) or LOCAL DEV (localhost): the
 *     API is already same-origin, so leave CT_SERVER_URL unset.
 */
(function () {
  'use strict';

  // The hosted backend (Railway). The native app and any off-origin web host
  // (Vercel) must talk to this directly.
  var BACKEND_URL = 'https://chesstrophies-production.up.railway.app';

  try {
    if (window.CT_SERVER_URL) return; // explicit override always wins

    // Primary, most reliable signal: Capacitor injects this global in the app.
    var isCapacitor =
      !!(window.Capacitor && (window.Capacitor.isNativePlatform
        ? window.Capacitor.isNativePlatform()
        : window.Capacitor.platform && window.Capacitor.platform !== 'web'));

    var loc = window.location || {};
    var proto = (loc.protocol || '').toLowerCase();
    var host = (loc.hostname || '').toLowerCase();
    var fullHost = (loc.host || '').toLowerCase();

    // Non-http(s) shells (older Capacitor, file://).
    var isLocalScheme = (proto === 'capacitor:' || proto === 'file:');
    // Local development: you run the API on the same local origin.
    var isLocalDev = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '';
    // Already on the backend host -> same-origin is correct, no override.
    var onBackendHost = fullHost.indexOf('chesstrophies-production.up.railway.app') !== -1;

    if (isCapacitor || isLocalScheme || (!isLocalDev && !onBackendHost)) {
      window.CT_SERVER_URL = BACKEND_URL;
    }
  } catch (e) {
    // On any error, fall back to same-origin (web default) — never throws.
  }
})();
