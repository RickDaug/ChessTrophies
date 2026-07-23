// Fallback guard for the socket.io client.
//
// The PRIMARY copy is now the vendored, same-origin vendor/socket.io.min.js
// (see index.html) — it used to be loaded from cdnjs with `crossorigin` but no
// `integrity` hash, so a CDN compromise could have run arbitrary script. With
// script-src 'self' there is no CDN origin to fall back to any more; the only
// sensible retry is the same same-origin file (covers a transient network blip
// or a corrupted cache entry on the first request).
//
// This file is loaded as an external script for CSP script-src 'self'. It is
// `defer`red, so document.write() is NOT usable here — we append a real <script>
// element instead. Socket connection is lazy (app.js calls
// window.__connectGameSocket() on demand), so a slightly later `io` is fine.
(function () {
  if (typeof window.io !== 'undefined') return;
  var s = document.createElement('script');
  s.src = 'vendor/socket.io.min.js?v=20260606a&retry=1';
  s.async = false; // keep execution ordered relative to other injected scripts
  document.head.appendChild(s);
})();
