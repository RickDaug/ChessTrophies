/* ct-push.js — ChessTrophies Web Push client (window.CT_Push).
 *
 * Re-engagement push notifications. Fully self-contained + CSP-safe (no inline
 * code; exposed on window.CT_Push). Degrades SILENTLY everywhere it can't run:
 *   - the browser lacks Notification / serviceWorker / PushManager
 *   - the backend reports push disabled (no VAPID keys -> /api/push/config
 *     returns { enabled:false })
 *   - the user hasn't granted (or has denied) notification permission
 *
 * It relies on window.CT_Auth for the bearer token + API base + the api()
 * helper, and on the already-registered service worker (ct-sw-register.js).
 *
 * The main loop wires the <script> tag, the CT_Push.init() call, and a tasteful
 * "Turn on notifications?" prompt that calls CT_Push.subscribe().
 */
(function () {
  'use strict';

  var state = {
    supported: false,    // browser feature-detect result
    enabled: false,      // backend has VAPID configured
    publicKey: null,     // VAPID public key from the server
    permission: 'default', // Notification.permission snapshot
    subscribed: false,   // we currently hold a push subscription
    initDone: false,
  };

  function supported() {
    return (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window
    );
  }

  // Use CT_Auth's authenticated fetch helper so the bearer token + API base are
  // handled identically to the rest of the app. Returns null on any failure.
  function auth() { return window.CT_Auth || null; }
  async function apiGet(path) {
    var a = auth();
    if (!a || typeof a.api !== 'function') return null;
    try { return await a.api(path); } catch (e) { return null; }
  }
  async function apiPost(path, body) {
    var a = auth();
    if (!a || typeof a.api !== 'function') return null;
    return a.api(path, { method: 'POST', body: JSON.stringify(body || {}) });
  }

  // base64url VAPID key -> Uint8Array (required shape for applicationServerKey).
  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function swRegistration() {
    if (!('serviceWorker' in navigator)) return null;
    try { return await navigator.serviceWorker.ready; }
    catch (e) { return null; }
  }

  // Feature-detect, read the current permission, and fetch the server config so
  // we know whether push is enabled + which VAPID key to use. Also reflects any
  // EXISTING subscription so isSubscribed() is accurate without re-subscribing.
  // Safe to call on every app entry; never throws.
  async function init() {
    state.initDone = true;
    state.supported = supported();
    if (!state.supported) return state;
    try { state.permission = Notification.permission; } catch (e) { state.permission = 'default'; }

    var cfg = await apiGet('/api/push/config');
    if (cfg && cfg.enabled && cfg.publicKey) {
      state.enabled = true;
      state.publicKey = cfg.publicKey;
    } else {
      state.enabled = false;
      state.publicKey = null;
    }

    // Reflect an existing subscription (e.g. a returning user on this device).
    if (state.enabled && state.permission === 'granted') {
      try {
        var reg = await swRegistration();
        if (reg) {
          var existing = await reg.pushManager.getSubscription();
          state.subscribed = !!existing;
        }
      } catch (e) { /* ignore */ }
    }
    return state;
  }

  // Request permission, get the SW registration, subscribe with the server's
  // VAPID public key, and POST the subscription to the backend. Returns true on
  // success; resolves false (never throws) when unsupported/disabled/denied so a
  // UI prompt can fail gracefully. Requires a logged-in session (a token) to
  // persist the sub server-side.
  async function subscribe() {
    if (!state.initDone) await init();
    if (!state.supported || !state.enabled || !state.publicKey) return false;
    var a = auth();
    if (!a || typeof a.isServerLoggedIn !== 'function' || !a.isServerLoggedIn()) return false;

    var perm = state.permission;
    if (perm !== 'granted') {
      try { perm = await Notification.requestPermission(); }
      catch (e) { return false; }
      state.permission = perm;
    }
    if (perm !== 'granted') return false;

    var reg = await swRegistration();
    if (!reg) return false;

    var sub;
    try {
      sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(state.publicKey),
        });
      }
    } catch (e) {
      return false;
    }

    try {
      await apiPost('/api/push/subscribe', { subscription: sub.toJSON ? sub.toJSON() : sub });
      state.subscribed = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  // Unsubscribe locally AND tell the backend to drop the row. Best-effort; never
  // throws. Returns true if a subscription was removed.
  async function unsubscribe() {
    if (!state.initDone) await init();
    if (!state.supported) return false;
    var reg = await swRegistration();
    if (!reg) return false;
    var sub = null;
    try { sub = await reg.pushManager.getSubscription(); } catch (e) { sub = null; }
    if (!sub) { state.subscribed = false; return false; }
    var endpoint = sub.endpoint;
    try { await sub.unsubscribe(); } catch (e) { /* keep going; still tell server */ }
    try { await apiPost('/api/push/unsubscribe', { endpoint: endpoint }); } catch (e) { /* ignore */ }
    state.subscribed = false;
    return true;
  }

  // True when push is usable on this device AND the backend has it configured.
  function isEnabled() {
    return !!(state.supported && state.enabled);
  }

  // True when we currently hold an active subscription on this device.
  function isSubscribed() {
    return !!state.subscribed;
  }

  function getState() { return Object.assign({}, state); }

  window.CT_Push = {
    init: init,
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    isEnabled: isEnabled,
    isSubscribed: isSubscribed,
    getState: getState,
  };
})();
