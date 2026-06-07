// Fallback: if the CDN copy of socket.io failed to load (blocked/offline/CDN
// outage), synchronously inject the locally-bundled client so realtime play
// still works. Externalized from an inline <script> for CSP script-src 'self';
// this file is loaded as a synchronous (non-async/defer) external script right
// after the socket.io CDN tag, so its document.write still runs during parse and
// keeps load order before app scripts.
if (typeof window.io === 'undefined') {
  document.write('<script src="vendor/socket.io.min.js?v=20260606a"><\/script>');
}
