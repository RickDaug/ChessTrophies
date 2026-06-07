/* ct-ads.js — ads shim (web-only build).
 *
 * The app shipped a native Capacitor AdMob banner here; that native path was
 * removed when the project went web-only. The in-page HTML ad slots
 * (renderAdSlot in app.js) are the web ad surface — wire those to AdSense (or
 * another web network) when you monetize.
 *
 * This shim keeps window.CT_Ads's public API so app.js's calls
 * (refresh / hide on login, premium toggle, and sign-out) stay safe no-ops.
 *
 * Public API (window.CT_Ads):
 *   refresh(isPremium)  no-op on web (kept for call-site compatibility)
 *   hide()              no-op on web
 *   isNative()          always false on the web build
 */
(function () {
  'use strict';
  function noop() {}
  window.CT_Ads = {
    refresh: noop,
    hide: noop,
    isNative: function () { return false; },
  };
})();
