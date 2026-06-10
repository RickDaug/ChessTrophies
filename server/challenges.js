// Shareable "beat the Computer" challenge links — the growth loop.
//
// A player creates a challenge (their name + the bot difficulty they want the
// recipient to face, plus an optional claim like "I won in 24 moves"). The link
// `<site>?c=<id>` is shared; whoever opens it plays that same bot difficulty as a
// guest — no signup needed — then is looped back to challenge someone else + a
// signup nudge. plays/beats tally the social proof ("N tried, M beat it").
//
// Public + lightweight: anyone (incl. guests) can create + open challenges.
// Rate-limited, validated, failure-isolated. Mounted in server.js.

import * as store from './store.js';

const NAME_MAX = 40;
const META_MAX = 256;
const ELO_MIN = 400, ELO_MAX = 2400;
const STRIP_ANGLE = /[<>]/g; // defence-in-depth; the client also escapes on render

// Tiny in-memory token bucket per IP so the endpoint can't be flooded.
const buckets = new Map();
function allow(key, perWindow = 20, windowMs = 10000) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) { b = { start: now, n: 0 }; buckets.set(key, b); }
  b.n++;
  if (buckets.size > 5000) { for (const [k, v] of buckets) if (now - v.start > windowMs) buckets.delete(k); }
  return b.n <= perWindow;
}
function ipOf(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'anon'; }
function rid() { return Math.random().toString(36).slice(2, 7) + Math.random().toString(36).slice(2, 7); }
function clampElo(v) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(ELO_MIN, Math.min(ELO_MAX, n)) : 1200; }

// Trim + cap the challenger name; keep spaces/digits/punctuation in real names.
function cleanName(s) {
  const cleaned = (typeof s === 'string' ? s : '').replace(STRIP_ANGLE, '').trim().slice(0, NAME_MAX);
  return cleaned || 'A player';
}

function shape(row) {
  if (!row) return null;
  let meta = null;
  try { meta = row.meta ? JSON.parse(row.meta) : null; } catch (e) { meta = null; }
  return {
    id: row.id,
    challengerName: row.challenger_name,
    kind: row.kind || 'beat_bot',
    elo: Number(row.elo) || 1200,
    meta,
    plays: Number(row.plays) || 0,
    beats: Number(row.beats) || 0,
  };
}

export function mountChallenges(app) {
  // CREATE — body { challengerName, elo, meta? }. Returns { id }.
  app.post('/api/challenges', async (req, res) => {
    if (!allow('c:' + ipOf(req))) return res.status(429).json({ error: 'Slow down.' });
    try {
      const b = req.body || {};
      const challengerName = cleanName(b.challengerName);
      const elo = clampElo(b.elo);
      let meta = null;
      if (b.meta && typeof b.meta === 'object') {
        const s = JSON.stringify(b.meta);
        if (s.length <= META_MAX) meta = s;
      }
      const challengerId = (typeof b.challengerId === 'string' && b.challengerId.slice(0, 64)) || null;
      const id = rid();
      await store.run(
        'INSERT INTO challenges (id, challenger_name, challenger_id, kind, elo, meta, plays, beats, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)',
        [id, challengerName, challengerId, 'beat_bot', elo, meta, Date.now()]
      );
      res.json({ id });
    } catch (e) {
      console.error('[challenges] create failed', e && e.message);
      res.status(500).json({ error: 'Could not create the challenge.' });
    }
  });

  // FETCH — public. Returns the challenge or 404.
  app.get('/api/challenges/:id', async (req, res) => {
    try {
      const row = await store.get('SELECT * FROM challenges WHERE id = ?', [String(req.params.id).slice(0, 32)]);
      const c = shape(row);
      if (!c) return res.status(404).json({ error: 'Challenge not found.' });
      res.json(c);
    } catch (e) {
      res.status(500).json({ error: 'Could not load the challenge.' });
    }
  });

  // RESULT — body { beat:bool }. Tally a completed attempt. Returns { plays, beats }.
  app.post('/api/challenges/:id/result', async (req, res) => {
    if (!allow('r:' + ipOf(req))) return res.status(429).json({ error: 'Slow down.' });
    try {
      const id = String(req.params.id).slice(0, 32);
      const beat = !!(req.body && req.body.beat);
      await store.run('UPDATE challenges SET plays = plays + 1, beats = beats + ? WHERE id = ?', [beat ? 1 : 0, id]);
      const row = await store.get('SELECT plays, beats FROM challenges WHERE id = ?', [id]);
      res.json({ plays: Number(row && row.plays) || 0, beats: Number(row && row.beats) || 0 });
    } catch (e) {
      res.status(500).json({ error: 'Could not record the result.' });
    }
  });
}
