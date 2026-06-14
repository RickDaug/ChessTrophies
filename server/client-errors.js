// Client-side error sink — visibility into FIRST-SESSION JS crashes.
//
// The client (ct-onerror.js) installs window 'error' + 'unhandledrejection'
// handlers as the very first script; previously they only console.error'd, so a
// JS exception that white-screened a brand-new visitor on some device/browser was
// invisible to us and fatal to that activation. This endpoint receives those
// reports so they land in the server logs (Railway) + Sentry when configured.
//
// PUBLIC (errors happen pre-auth and for guests), in-memory rate-limited per IP,
// validates + clamps every field, and NEVER throws to the client. PRIVACY: we
// keep only the error message, the source URL, line/col, a truncated stack, the
// UA string, the path, and the anonymous visitorId — no PII, no IP persisted (the
// IP scopes the rate-limit bucket then is discarded).

// --- In-memory per-IP token bucket (mirrors analytics.js) -------------------
// Errors should be rare, so this is tight: ~10 reports / 30s per IP. Buckets are
// per-process (best-effort under multi-instance) and swept lazily.
const RATE_MAX = 10;
const RATE_WINDOW_MS = 30000;
const REFILL_PER_MS = RATE_MAX / RATE_WINDOW_MS;
const buckets = new Map(); // key -> { tokens, last }
let lastSweep = Date.now();

function rateLimited(key, now) {
  let b = buckets.get(key);
  if (!b) { b = { tokens: RATE_MAX, last: now }; buckets.set(key, b); }
  b.tokens = Math.min(RATE_MAX, b.tokens + (now - b.last) * REFILL_PER_MS);
  b.last = now;
  if (now - lastSweep > 60000) {
    for (const [k, v] of buckets) { if (now - v.last > RATE_WINDOW_MS * 3) buckets.delete(k); }
    lastSweep = now;
  }
  if (b.tokens < 1) return true;
  b.tokens -= 1;
  return false;
}

function clip(s, n) {
  if (s == null) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n) : s;
}

// Best-effort client IP — only used to scope the rate-limit bucket, never stored.
function clientIp(req) {
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return (req.ip || (req.socket && req.socket.remoteAddress) || '').toString();
}

// Mount POST /api/client-error. Run AFTER express.json() (req.body parsed).
// opts.report(info) is an optional sink (server.js wires it to Sentry) — any
// throw it makes is swallowed so a reporting failure can't 500 the endpoint.
export function mountClientErrors(app, opts = {}) {
  const report = typeof opts.report === 'function' ? opts.report : null;
  app.post('/api/client-error', (req, res) => {
    try {
      const now = Date.now();
      if (rateLimited('ce:' + clientIp(req), now)) return res.status(429).json({ ok: false });
      const b = (req && req.body) || {};
      const message = clip(b.message, 500);
      if (!message) return res.status(400).json({ ok: false, error: 'message required' });
      const info = {
        kind: clip(b.kind, 32) || 'error', // 'error' | 'unhandledrejection'
        message,
        source: clip(b.source, 300),
        line: Number.isFinite(+b.line) ? +b.line : null,
        col: Number.isFinite(+b.col) ? +b.col : null,
        stack: clip(b.stack, 2000),
        path: clip(b.path, 300),
        ua: clip((req.headers && req.headers['user-agent']) || '', 300),
        visitorId: clip(b.visitorId, 64),
      };
      // Always log (→ Railway logs = baseline visibility).
      console.error('[client-error]', JSON.stringify(info));
      // Forward to the richer sink (Sentry) when wired; never let it throw.
      if (report) { try { report(info); } catch (e) { /* reporting must not 500 */ } }
      res.json({ ok: true });
    } catch (e) {
      // The whole point is visibility — never throw back at a crashing client.
      try { res.status(200).json({ ok: false }); } catch (e2) {}
    }
  });
}
