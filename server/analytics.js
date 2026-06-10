// Privacy-light product analytics — a thin event-funnel layer.
//
// We record COARSE, anonymous product events (a small fixed allowlist of stage
// names) keyed by a client-generated `visitorId` (not a tracking cookie, not PII)
// so the admin dashboard can show a basic acquisition funnel and daily traffic.
// No IPs, emails, or free-form strings are persisted — `meta` is an optional tiny
// JSON blob the caller may attach (capped hard). Guests fire events too, so the
// ingest endpoint is PUBLIC (no auth); an in-memory token bucket per visitor+IP
// keeps an attacker from flooding the table.
//
// Backend-agnostic: all reads/writes go through the store facade (SQLite default,
// Postgres when DB_BACKEND=postgres). SQL is portable (`?` placeholders, no
// SQLite-only date functions — day buckets are precomputed in JS as UTC
// 'YYYY-MM-DD' strings). Nothing here throws to the client.

import * as store from './store.js';

// The ONLY event names we accept. Anything else is rejected with 400 so the
// table can't be polluted with arbitrary names. Order is irrelevant here; the
// funnel order is defined in analyticsStats().
const ALLOWED_EVENTS = new Set([
  'land',
  'play_start',
  'play_finish',
  'signup_cta_view',
  'signup',
  'arena_join',
  'puzzle_solve',
  'premium_view',
  'purchase',
]);

const VISITOR_ID_MAX = 64;
const META_MAX = 512;

// --- In-memory per-(visitor+IP) token bucket rate limiter -------------------
// ~30 events / 10s. Buckets live only in this process (best-effort; a flood
// across replicas is still bounded per replica). Idle buckets are swept lazily.
const RATE_MAX = 30;          // tokens
const RATE_WINDOW_MS = 10000; // refill window for a full bucket
const REFILL_PER_MS = RATE_MAX / RATE_WINDOW_MS;
const buckets = new Map(); // key -> { tokens, last }
let lastSweep = Date.now();

function rateLimited(key, now) {
  let b = buckets.get(key);
  if (!b) { b = { tokens: RATE_MAX, last: now }; buckets.set(key, b); }
  // Refill based on elapsed time, capped at RATE_MAX.
  b.tokens = Math.min(RATE_MAX, b.tokens + (now - b.last) * REFILL_PER_MS);
  b.last = now;
  // Periodically drop stale buckets so the Map can't grow unbounded.
  if (now - lastSweep > 60000) {
    for (const [k, v] of buckets) { if (now - v.last > RATE_WINDOW_MS * 3) buckets.delete(k); }
    lastSweep = now;
  }
  if (b.tokens < 1) return true;
  b.tokens -= 1;
  return false;
}

// UTC 'YYYY-MM-DD' for a ms timestamp.
function dayKeyOf(ts) { return new Date(ts).toISOString().slice(0, 10); }
// The day_key N days before today (UTC), used as a `day_key >= ?` cutoff.
function cutoffDayKey(days) { return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); }

// Best-effort client IP (behind a proxy we see x-forwarded-for). Only used to
// scope the rate-limit bucket — it is NOT persisted.
function clientIp(req) {
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return (req.ip || (req.socket && req.socket.remoteAddress) || '').toString();
}

export function mountAnalytics(app) {
  // PUBLIC: ingest a single product event. Guests fire these, so there is no
  // auth. Validates against the allowlist, rate-limits per visitor+IP, and never
  // throws to the client (always returns a JSON status).
  app.post('/api/events', async (req, res) => {
    try {
      const body = (req && req.body) || {};
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!ALLOWED_EVENTS.has(name)) {
        return res.status(400).json({ error: 'Unknown event name.' });
      }
      let visitorId = typeof body.visitorId === 'string' ? body.visitorId.trim() : '';
      if (!visitorId) return res.status(400).json({ error: 'visitorId is required.' });
      if (visitorId.length > VISITOR_ID_MAX) visitorId = visitorId.slice(0, VISITOR_ID_MAX);

      const now = Date.now();
      const ip = clientIp(req);
      if (rateLimited(visitorId + '|' + ip, now)) {
        return res.status(429).json({ error: 'Too many events.' });
      }

      // userId is optional (signed-in users) — capped, never required.
      let userId = null;
      if (typeof body.userId === 'string' && body.userId.trim()) {
        userId = body.userId.trim().slice(0, 64);
      }

      // meta: optional small JSON. Stringify + hard cap; drop if it doesn't fit
      // (we never want a giant blob, and never want this to throw).
      let meta = null;
      if (body.meta != null) {
        try {
          const s = JSON.stringify(body.meta);
          if (typeof s === 'string' && s.length <= META_MAX) meta = s;
        } catch (e) { meta = null; }
      }

      await store.run(
        `INSERT INTO analytics_events (name, visitor_id, user_id, day_key, created_at, meta)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [name, visitorId, userId, dayKeyOf(now), now, meta]
      );
      return res.json({ ok: true });
    } catch (e) {
      // Never leak internals / never 500 the public ingest path. The client
      // doesn't care if telemetry failed; just log it server-side.
      console.error('[analytics] ingest failed:', e && e.message ? e.message : e);
      return res.status(200).json({ ok: false });
    }
  });
}

// Funnel stages, in display order: each is one allowlisted event whose distinct
// visitor count over the last 30 days forms a funnel step.
const FUNNEL = [
  { stage: 'Landed',          key: 'land' },
  { stage: 'Played',          key: 'play_start' },
  { stage: 'Finished a game', key: 'play_finish' },
  { stage: 'Saw sign-up',     key: 'signup_cta_view' },
  { stage: 'Signed up',       key: 'signup' },
];

// A fully-zeroed shape so the admin route always has something safe to render.
function emptyStats() {
  return {
    funnel: FUNNEL.map(s => ({ stage: s.stage, key: s.key, visitors: 0 })),
    today: { visitors: 0, plays: 0, signups: 0 },
    daily: [],
    returning: { visitorsToday: 0, returningToday: 0 },
    topEvents: [],
  };
}

// Compute the stats.analytics shape. Failure-isolated: any error returns the
// zeroed shape rather than throwing into the admin route. Portable SQL via the
// store facade (works on SQLite + Postgres).
export async function analyticsStats() {
  try {
    const today = dayKeyOf(Date.now());
    const cut30 = cutoffDayKey(30);

    const num = async (sql, p = []) => { const r = await store.get(sql, p); return r ? Number(r.n) || 0 : 0; };

    // Funnel: distinct visitors per stage event over the last 30 days.
    const funnel = [];
    for (const s of FUNNEL) {
      const visitors = await num(
        'SELECT COUNT(DISTINCT visitor_id) AS n FROM analytics_events WHERE name = ? AND day_key >= ?',
        [s.key, cut30]
      );
      funnel.push({ stage: s.stage, key: s.key, visitors });
    }

    // Today's snapshot.
    const today_ = {
      visitors: await num('SELECT COUNT(DISTINCT visitor_id) AS n FROM analytics_events WHERE day_key = ?', [today]),
      plays:    await num("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'play_start' AND day_key = ?", [today]),
      signups:  await num("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'signup' AND day_key = ?", [today]),
    };

    // Daily traffic (last 14 days, oldest->newest), zero-filled. We build the
    // date list in JS and left-join the per-day aggregates we read in one pass.
    const cut14 = cutoffDayKey(13); // include today => 14 days total
    const dayRows = await store.all(
      `SELECT day_key,
              COUNT(DISTINCT visitor_id) AS visitors,
              SUM(CASE WHEN name = 'play_start' THEN 1 ELSE 0 END) AS plays
       FROM analytics_events
       WHERE day_key >= ?
       GROUP BY day_key`,
      [cut14]
    );
    const byDay = new Map();
    for (const r of (dayRows || [])) {
      byDay.set(String(r.day_key), { visitors: Number(r.visitors) || 0, plays: Number(r.plays) || 0 });
    }
    const daily = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const agg = byDay.get(d) || { visitors: 0, plays: 0 };
      daily.push({ date: d, visitors: agg.visitors, plays: agg.plays });
    }

    // Returning visitors: of the distinct visitors seen today, how many also
    // appear on an EARLIER day_key (i.e. not their first-ever day). We group by
    // visitor over ALL rows, keep those seen today (MAX(...today...) = 1) whose
    // earliest day_key predates today (MIN(day_key) < today).
    const visitorsToday = today_.visitors;
    const returningToday = await num(
      `SELECT COUNT(*) AS n FROM (
         SELECT visitor_id FROM analytics_events
         GROUP BY visitor_id
         HAVING MAX(CASE WHEN day_key = ? THEN 1 ELSE 0 END) = 1
            AND MIN(day_key) < ?
       ) t`,
      [today, today]
    );

    // topEvents: event row counts over the last 30 days, desc.
    const topRows = await store.all(
      'SELECT name, COUNT(*) AS count FROM analytics_events WHERE day_key >= ? GROUP BY name ORDER BY count DESC',
      [cut30]
    );
    const topEvents = (topRows || []).map(r => ({ name: String(r.name), count: Number(r.count) || 0 }));

    return {
      funnel,
      today: today_,
      daily,
      returning: { visitorsToday, returningToday },
      topEvents,
    };
  } catch (e) {
    console.error('[analytics] analyticsStats failed:', e && e.message ? e.message : e);
    return emptyStats();
  }
}

// Optional boot log so it's obvious analytics ingest is mounted.
export function logAnalyticsStatus() {
  console.log('[analytics] product-analytics ingest mounted at POST /api/events (privacy-light, public, rate-limited).');
}
