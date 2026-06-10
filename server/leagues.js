// Friend Leagues — private clubs with a join code + a members-only leaderboard.
//
// A signed-in user creates a league (gets a short shareable CODE), shares the
// code with friends, and they join. Each league has a members-only leaderboard
// ranked by the live chess ELO on the users table. Leagues are for REAL accounts
// only (every route requireAuth) — there's no guest participation.
//
// Layer model (mirrors arena.js / challenges.js): this module is the data +
// REST surface only. It is failure-isolated (never throws to the client), uses
// the backend-agnostic store facade with `?` placeholders (auto-translated to
// $1.. on Postgres), and is mounted in server.js via mountLeagues(app). The DDL
// for the two tables lives in db.js (SQLite) + db-pg.js (Postgres).

import { requireAuth } from './auth.js';
import * as store from './store.js';

// --- Config -----------------------------------------------------------------
const NAME_MIN = 2;
const NAME_MAX = 40;
const CODE_LEN = 5;                 // 5 uppercase chars -> ~60M codes
const MAX_OWNED = 20;               // a user can OWN at most this many leagues
const MAX_MEMBERSHIPS = 50;         // a user can BELONG to at most this many
const CODE_RETRIES = 8;             // collision retries when minting a code

// Unambiguous uppercase alphabet (no O/0/I/1) so a shared code is easy to type.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function rid() {
  return 'lg_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

function randomCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

// Trim + cap a league name; returns '' if it's not a usable string.
function cleanName(s) {
  const cleaned = (typeof s === 'string' ? s : '').replace(/[<>]/g, '').trim().slice(0, NAME_MAX);
  return cleaned;
}

// Normalize a submitted code: uppercase, strip non-alphanumerics, cap length.
function cleanCode(s) {
  return (typeof s === 'string' ? s : '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
}

// --- Tiny in-memory token bucket per user (create/join abuse guard) ----------
const buckets = new Map();
function allow(key, perWindow = 12, windowMs = 60000) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) { b = { start: now, n: 0 }; buckets.set(key, b); }
  b.n++;
  if (buckets.size > 5000) { for (const [k, v] of buckets) if (now - v.start > windowMs) buckets.delete(k); }
  return b.n <= perWindow;
}

// --- Data helpers -----------------------------------------------------------

async function getLeague(id) {
  return (await store.get('SELECT * FROM leagues WHERE id = ?', [id])) || null;
}

async function getLeagueByCode(code) {
  return (await store.get('SELECT * FROM leagues WHERE code = ?', [code])) || null;
}

async function isMember(leagueId, userId) {
  const row = await store.get(
    'SELECT 1 AS x FROM league_members WHERE league_id = ? AND user_id = ? LIMIT 1',
    [leagueId, userId]
  );
  return !!row;
}

async function memberCount(leagueId) {
  const row = await store.get('SELECT COUNT(*) AS n FROM league_members WHERE league_id = ?', [leagueId]);
  return Number(row && row.n) || 0;
}

// Mint a code that isn't already taken (retry on collision). Returns null if we
// somehow can't find a free code (effectively impossible at this scale).
async function mintUniqueCode() {
  for (let i = 0; i < CODE_RETRIES; i++) {
    const code = randomCode();
    const existing = await getLeagueByCode(code);
    if (!existing) return code;
  }
  return null;
}

// --- REST -------------------------------------------------------------------
export function mountLeagues(app) {
  // CREATE — body { name }. Mints a unique code, adds the owner as a member.
  // Returns { id, code, name }.
  app.post('/api/leagues', requireAuth, async (req, res) => {
    if (!allow('cr:' + req.userId)) return res.status(429).json({ error: 'Slow down — too many leagues too fast.' });
    try {
      const name = cleanName(req.body && req.body.name);
      if (name.length < NAME_MIN) return res.status(400).json({ error: `Name must be ${NAME_MIN}–${NAME_MAX} characters.` });

      const owned = await store.get('SELECT COUNT(*) AS n FROM leagues WHERE owner_id = ?', [req.userId]);
      if ((Number(owned && owned.n) || 0) >= MAX_OWNED) {
        return res.status(409).json({ error: `You can own at most ${MAX_OWNED} leagues.` });
      }

      const code = await mintUniqueCode();
      if (!code) return res.status(503).json({ error: 'Could not generate a code — please try again.' });

      const id = rid();
      const now = Date.now();
      await store.run(
        'INSERT INTO leagues (id, name, code, owner_id, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, name, code, req.userId, now]
      );
      // Add the owner as the first member (idempotent guard for safety).
      await store.run(
        'INSERT OR IGNORE INTO league_members (league_id, user_id, joined_at) VALUES (?, ?, ?)',
        [id, req.userId, now]
      );
      res.json({ id, code, name });
    } catch (e) {
      console.error('[leagues] create failed', e && e.message);
      res.status(500).json({ error: 'Could not create the league.' });
    }
  });

  // JOIN — body { code }. Idempotent. 404 on a bad code. Caps memberships.
  // Returns { id, name }.
  app.post('/api/leagues/join', requireAuth, async (req, res) => {
    if (!allow('jn:' + req.userId)) return res.status(429).json({ error: 'Slow down — too many joins too fast.' });
    try {
      const code = cleanCode(req.body && req.body.code);
      if (code.length !== CODE_LEN) return res.status(400).json({ error: 'Enter the full join code.' });

      const league = await getLeagueByCode(code);
      if (!league) return res.status(404).json({ error: 'No league found with that code.' });

      // Already a member? Idempotent success (don't count it against the cap).
      if (await isMember(league.id, req.userId)) {
        return res.json({ id: league.id, name: league.name });
      }

      const mine = await store.get('SELECT COUNT(*) AS n FROM league_members WHERE user_id = ?', [req.userId]);
      if ((Number(mine && mine.n) || 0) >= MAX_MEMBERSHIPS) {
        return res.status(409).json({ error: `You can belong to at most ${MAX_MEMBERSHIPS} leagues.` });
      }

      await store.run(
        'INSERT OR IGNORE INTO league_members (league_id, user_id, joined_at) VALUES (?, ?, ?)',
        [league.id, req.userId, Date.now()]
      );
      res.json({ id: league.id, name: league.name });
    } catch (e) {
      console.error('[leagues] join failed', e && e.message);
      res.status(500).json({ error: 'Could not join the league.' });
    }
  });

  // LEAVE — drop the caller's membership. The league persists even if the owner
  // leaves (simplest behavior; the code still works for the remaining members).
  app.post('/api/leagues/:id/leave', requireAuth, async (req, res) => {
    try {
      await store.run(
        'DELETE FROM league_members WHERE league_id = ? AND user_id = ?',
        [String(req.params.id).slice(0, 64), req.userId]
      );
      res.json({ ok: true });
    } catch (e) {
      console.error('[leagues] leave failed', e && e.message);
      res.status(500).json({ error: 'Could not leave the league.' });
    }
  });

  // MINE — leagues the caller belongs to: [{id, name, code, members, isOwner}].
  app.get('/api/leagues/mine', requireAuth, async (req, res) => {
    try {
      const rows = await store.all(
        `SELECT l.id AS id, l.name AS name, l.code AS code, l.owner_id AS owner_id,
                (SELECT COUNT(*) FROM league_members m2 WHERE m2.league_id = l.id) AS members
           FROM league_members m
           JOIN leagues l ON l.id = m.league_id
          WHERE m.user_id = ?
          ORDER BY l.created_at DESC`,
        [req.userId]
      );
      const leagues = (rows || []).map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        members: Number(r.members) || 0,
        isOwner: r.owner_id === req.userId,
      }));
      res.json({ leagues });
    } catch (e) {
      console.error('[leagues] mine failed', e && e.message);
      res.status(500).json({ error: 'Could not load your leagues.' });
    }
  });

  // LEADERBOARD — MEMBER-ONLY (403 otherwise). Ranks members by live chess ELO.
  // Returns { name, code, members:[{username, elo, wins, losses, isOwner}] }.
  app.get('/api/leagues/:id/leaderboard', requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id).slice(0, 64);
      const league = await getLeague(id);
      if (!league) return res.status(404).json({ error: 'League not found.' });
      if (!(await isMember(id, req.userId))) {
        return res.status(403).json({ error: 'Join this league to see its leaderboard.' });
      }
      const rows = await store.all(
        `SELECT u.id AS id, u.username AS username, u.elo AS elo, u.wins AS wins, u.losses AS losses
           FROM league_members m
           JOIN users u ON u.id = m.user_id
          WHERE m.league_id = ?
          ORDER BY u.elo DESC, u.wins DESC
          LIMIT 200`,
        [id]
      );
      const members = (rows || []).map((r) => ({
        username: r.username || '—',
        elo: Number(r.elo) || 0,
        wins: Number(r.wins) || 0,
        losses: Number(r.losses) || 0,
        isOwner: r.id === league.owner_id,
      }));
      res.json({ name: league.name, code: league.code, members });
    } catch (e) {
      console.error('[leagues] leaderboard failed', e && e.message);
      res.status(500).json({ error: 'Could not load the leaderboard.' });
    }
  });
}
