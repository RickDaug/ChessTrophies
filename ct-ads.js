/* ct-ads.js — AdMob banner integration for the ChessTrophies Capacitor app.
 *
 * Scaffolded with Google's official TEST ad unit ids, so it runs and shows real
 * test ads immediately without an AdMob account. REPLACE the ids in AD_UNITS
 * (and the app id in AndroidManifest.xml) with your real ones before shipping.
 *
 * Behaviour:
 *   - No-ops entirely on the web build (Vercel) — AdMob is native-only. The
 *     existing HTML placeholder ad slots (renderAdSlot in app.js) still run there.
 *   - Shows a bottom banner only for FREE users on a native device.
 *   - Premium users (isPremium) never see a banner; app.js calls refresh() with
 *     the current premium state on login, on premium toggle, and on sign-out.
 *
 * Public API (window.CT_Ads):
 *   refresh(isPremium)  show the banner for free users, hide it for premium ones
 *   hide()              remove the banner (used on sign-out)
 *   isNative()          true only inside the Capacitor native shell
 *   AD_UNITS            the ad unit ids in use (test ids by default)
 */
(function () {
  'use strict';

  // Google's official TEST ad unit ids — safe to ship in dev, never billed.
  // TODO(production): swap these for your real AdMob unit ids.
  var AD_UNITS = {
    banner: 'ca-app-pub-3940256099942544/6300978111',
    interstitial: 'ca-app-pub-3940256099942544/1033173712',
    rewarded: 'ca-app-pub-3940256099942544/5224354917',
  };

  var st = { initialized: false, bannerShown: false, premium: false };

  function cap() { return (typeof window !== 'undefined') ? window.Capacitor : null; }
  function isNative() {
    var c = cap();
    return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform());
  }
  function admob() {
    var c = cap();
    return (c && c.Plugins && c.Plugins.AdMob) || null;
  }

  async function ensureInit() {
    if (st.initialized) return true;
    if (!isNative()) return false;
    var AdMob = admob();
    if (!AdMob) return false;
    try {
      // initializeForTesting routes every request to Google's test fill, so we
      // never accidentally serve (or click) a live ad during development.
      await AdMob.initialize({ initializeForTesting: true });
      st.initialized = true;
      return true;
    } catch (e) {
      console.warn('[ct-ads] AdMob.initialize failed', e);
      return false;
    }
  }

  async function showBanner() {
    if (!isNative() || st.premium || st.bannerShown) return;
    if (!(await ensureInit())) return;
    var AdMob = admob();
    if (!AdMob) return;
    try {
      await AdMob.showBanner({
        adId: AD_UNITS.banner,
        adSize: 'ADAPTIVE_BANNER',
        position: 'BOTTOM_CENTER',
        margin: 0,
        isTesting: true,
      });
      st.bannerShown = true;
    } catch (e) {
      console.warn('[ct-ads] showBanner failed', e);
    }
  }

  async function hideBanner() {
    if (!st.bannerShown) return;
    var AdMob = admob();
    if (!AdMob) return;
    try { await AdMob.hideBanner(); } catch (e) {}
    try { await AdMob.removeBanner(); } catch (e) {}
    st.bannerShown = false;
  }

  // Reconcile the banner with the user's premium state. Called by app.js.
  function refresh(isPremium) {
    st.premium = !!isPremium;
    if (!isNative()) return;
    if (st.premium) hideBanner();
    else showBanner();
  }

  window.CT_Ads = {
    refresh: refresh,
    hide: hideBanner,
    isNative: isNative,
    AD_UNITS: AD_UNITS,
  };
})();
