// Global error visibility — surface field failures that would otherwise be silent.
// Externalized from an inline <head> <script> so the CSP can use script-src 'self'
// (no 'unsafe-inline'). Loaded synchronously as the FIRST script in <head> so it
// installs these handlers before any other code runs.
window.addEventListener('error', function (e) {
  try { console.error('[CT error]', (e && e.message) || e, e && e.filename, e && e.lineno); } catch (_) {}
});
window.addEventListener('unhandledrejection', function (e) {
  try { console.error('[CT error] unhandled rejection:', e && e.reason); } catch (_) {}
});
