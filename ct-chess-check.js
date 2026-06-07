// chess.js load check — externalized from an inline <script> for CSP
// script-src 'self'. Loaded right after chess.min.js.
document.addEventListener('DOMContentLoaded', function () {
  if (typeof Chess === 'undefined') {
    const warn = document.createElement('div');
    warn.style.cssText = 'max-width:480px;margin:0 auto;padding:24px 18px;color:#fff;font-family:Inter,Arial,sans-serif;line-height:1.5;';
    warn.textContent = 'Chess.js failed to load. Please refresh the page or check your network connection.';
    document.body.appendChild(warn);
  }
});
