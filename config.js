/*
 * ChessTrophies runtime config.
 *
 * SERVER_URL resolution (see app.js):
 *     window.CT_SERVER_URL || window.location.origin
 *
 * WEB build: the page is served from the same origin as the API
 * (Railway / your custom domain), so window.location.origin is already
 * correct and we deliberately leave CT_SERVER_URL unset.
 *
 * NATIVE build (Capacitor / Android): the bundle is loaded from a local
 * source (the Capacitor WebView, a capacitor:// or file:// scheme) which is
 * NOT the API host, so the client must be pointed at the hosted backend.
 */
(function () {
  'use strict';

  // The hosted backend the NATIVE app talks to.
  var BACKEND_URL = 'https://chesstrophies-production.up.railway.app';

  try {
    // Primary, most reliable signal: Capacitor injects this global in the app.
    var isCapacitor =
      !!(window.Capacitor && (window.Capacitor.isNativePlatform
        ? window.Capacitor.isNativePlatform()
        : window.Capacitor.platform && window.Capacitor.platform !== 'web'));

    // Fallback signals for non-http(s) shells (older Capacitor, file://).
    var proto = ((window.location && window.location.protocol) || '').toLowerCase();
    var isLocalScheme = (proto === 'capacitor:' || proto === 'file:');

    if ((isCapacitor || isLocalScheme) && !window.CT_SERVER_URL) {
      window.CT_SERVER_URL = BACKEND_URL;
    }
  } catch (e) {
    // On any error, fall back to same-origin (web default) — never throws.
  }
})();
