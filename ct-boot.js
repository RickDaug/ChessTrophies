/* ct-boot.js — runs in <head> BEFORE the body paints.
 *
 * Prevents the sign-in screen from flashing for an already-signed-in user on
 * refresh: if a session exists, mark <html> so CSS hides the auth form and shows
 * a neutral splash until app.js picks the right screen. app.js clears the marker
 * once it has decided (see init()/doneBoot). A fallback timer clears it too, so a
 * JS failure can never leave the splash stuck.
 */
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
