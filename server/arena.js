// Arena tournaments — live, time-boxed events with continuous pairing, a live
// leaderboard, win-streak scoring, and bot-backfill so there's always a game.
// See ARENA_DESIGN.md for the full design.
//
// LAYER 1 (this module): pure scoring, the rolling lifecycle/scheduler, the
// scores upsert, and the REST surface. It touches NOTHING in the realtime game
// loop — the realtime pool + pairing + the finishGame hook live in game.js
// (Layer 2) and call recordArenaResult() exported here, exactly like the
// Seasons hook calls store.recordSeasonResult().
//
// Kill switch: ARENA_ENABLED (default ON). When '0', every route is inert and
// the scheduler never creates arenas — mirrors RANKED_ENABLED.

import { requireAuth } from './auth.js';
import * as store from './store.js';

// --- Config (tunable constants) --------------------------------------------
export const ARENA_DURATION_MS = Number(process.env.ARENA_DURATION_MS) || 30 * 60 * 1000; // each arena runs 30 min
export const ARENA_BREAK_MS = Number(process.env.ARENA_BREAK_MS) || 10 * 60 * 1000;       // gap before the next one
export const ARENA_TC = '5+0';                   // blitz: quick games, fast re-pair
export const ARENA_BOT_WAIT_MS = Number(process.env.ARENA_BOT_WAIT_MS) || 8 * 1000; // pool wait before a bot game (L2)

// Themed arena names, cycled deterministically by start slot.
const ARENA_NAMES = [
  'Blitz Arena', 'Knight Owl Arena', 'Gambit Arena', 'Endgame Arena',
  'Rapid Fire Arena', 'Checkmate Arena', 'Castle Siege Arena', 'Pawn Storm Arena',
  'Open File Arena', 'Zugzwang Arena', 'Fianchetto Arena', 'Skewer Arena',
];

export function arenaEnabled() {
  return process.env.ARENA_ENABLED !== '0';
}

// --- Pure scoring -----------------------------------------------------------
// Win = 2, Draw = 1, Loss = 0; a player already on >=2 consecutive wins earns 3
// for each further win (the 🔥 streak bonus). Draw/loss reset the streak.
// Pure + side-effect-free → unit tested.
export function arenaScore(result, streakBefore) {
  const sb = Math.max(0, streakBefore | 0);
  if (result === 'win') {
    const onFire = sb >= 2;
    return { points: onFire ? 3 : 2, streakAfter: sb + 1, onFire };
  }
  if (result === 'draw') return { points: 1, streakAfter: 0, onFire: false };
  return { points: 0, streakAfter: 0, onFire: false }; // loss / anything else
}

function pickName(startsAt) {
  const slot = Math.floor(startsAt / ARENA_DURATION_MS);
  return ARENA_NAMES[((slot % ARENA_NAMES.length) + ARENA_NAMES.length) % ARENA_NAMES.length];
}

function rid() {
  return 'arena_' + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
}

// --- Lifecycle --------------------------------------------------------------

// The live arena right now (status flipped to 'live' by advanceLifecycle), or null.
export async function liveArena(now = Date.now()) {
  return (await store.get(
    "SELECT * FROM arenas WHERE status = 'live' AND starts_at <= ? AND ends_at > ? ORDER BY starts_at ASC LIMIT 1",
    [now, now]
  )) || null;
}

// The soonest arena that hasn't ended yet and isn't the live one.
export async function nextArena(now = Date.now()) {
  return (await store.get(
    "SELECT * FROM arenas WHERE status = 'upcoming' AND ends_at > ? ORDER BY starts_at ASC LIMIT 1",
    [now]
  )) || null;
}

export async function getArena(id) {
  return (await store.get('SELECT * FROM arenas WHERE id = ?', [id])) || null;
}

// Guarantee at least one arena is live-or-upcoming. The next one starts after a
// break following the most recent arena's end (so there's a visible "next arena
// in M:SS" gap), or immediately if there's no history.
export async function ensureArena(now = Date.now()) {
  if (!arenaEnabled()) return null;
  const open = await store.get(
    "SELECT * FROM arenas WHERE status IN ('live', 'upcoming') AND ends_at > ? ORDER BY starts_at ASC LIMIT 1",
    [now]
  );
  if (open) return open;
  const last = await store.get('SELECT ends_at FROM arenas ORDER BY ends_at DESC LIMIT 1');
  const startsAt = last && last.ends_at ? Math.max(now, Number(last.ends_at) + ARENA_BREAK_MS) : now;
  const endsAt = startsAt + ARENA_DURATION_MS;
  const id = rid();
  await store.run(
    'INSERT INTO arenas (id, name, tc, starts_at, ends_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, pickName(startsAt), ARENA_TC, startsAt, endsAt, startsAt <= now ? 'live' : 'upcoming', now]
  );
  return getArena(id);
}

// Advance every arena's status for the current time + finalize any that ended,
// then make sure a future arena exists. Failure-isolated by the caller (the
// scheduler tick). Returns a small summary for logs/tests.
export async function advanceLifecycle(now = Date.now(), io = null, deps = {}) {
  if (!arenaEnabled()) return { flipped: 0, finalized: 0 };
  // upcoming -> live
  await store.run("UPDATE arenas SET status = 'live' WHERE status = 'upcoming' AND starts_at <= ?", [now]);
  // live -> finished (+ finalize)
  const ending = await store.all("SELECT * FROM arenas WHERE status = 'live' AND ends_at <= ?", [now]);
  for (const a of ending) {
    try { await finalizeArena(a, now, io, deps); }
    catch (e) { console.error('[arena] finalize failed for', a.id, e && e.message); }
  }
  await ensureArena(now);
  return { flipped: 1, finalized: ending.length };
}

// Crown the champion (top score with at least one game) and close the arena.
// Trophy + notify are Layer 4 (injected via deps so the L2/L4 wiring can add
// them without changing this signature). Always sets status='finished'.
export async function finalizeArena(arena, now = Date.now(), io = null, deps = {}) {
  let championId = null, championPoints = 0;
  try {
    const top = await store.get(
      'SELECT user_id, points FROM arena_scores WHERE arena_id = ? AND games > 0 ORDER BY points DESC, games ASC, peak_elo DESC LIMIT 1',
      [arena.id]
    );
    championId = top ? top.user_id : null;
    championPoints = top ? (Number(top.points) || 0) : 0;
  } catch (e) { /* leave champion null */ }
  await store.run("UPDATE arenas SET status = 'finished', champion_id = ? WHERE id = ?", [championId, arena.id]);
  if (championId && typeof deps.onChampion === 'function') {
    try { await deps.onChampion({ arena, championId, championPoints, io }); } catch (e) { console.error('[arena] onChampion hook failed', e && e.message); }
  }
  return championId;
}

// Recent finished arenas with their champion's name — for the client "past
// champions" strip + admin stats. Best-effort; empty on error.
export async function recentChampions(limit = 5) {
  try {
    return (await store.all(
      `SELECT a.id AS id, a.name AS name, a.ends_at AS endsAt, u.username AS champion
         FROM arenas a JOIN users u ON u.id = a.champion_id
        WHERE a.status = 'finished' AND a.champion_id IS NOT NULL
        ORDER BY a.ends_at DESC LIMIT ?`,
      [limit]
    )) || [];
  } catch (e) { return []; }
}

// --- Participation + scoring ------------------------------------------------

// Idempotently enroll a user in an arena (creates a zeroed scores row). Returns
// false if the arena isn't joinable (not live/upcoming or disabled).
export async function joinArena(arenaId, userId, now = Date.now()) {
  if (!arenaEnabled()) return false;
  const a = await getArena(arenaId);
  if (!a || a.status === 'finished' || Number(a.ends_at) <= now) return false;
  await store.run(
    'INSERT INTO arena_scores (arena_id, user_id, joined_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(arena_id, user_id) DO NOTHING',
    [arenaId, userId, now, now]
  );
  return true;
}

// Score one finished arena game for ONE player. Only scores players who JOINED
// (a row exists) — this naturally excludes bots and non-participants. result is
// 'win' | 'loss' | 'draw'. A plain read-modify-write (no transaction needed: a
// user is only ever in one game at a time, so per-user score writes are already
// serialized). Returns { scored, points, streak, onFire }.
export async function recordArenaResult({ arenaId, userId, result, elo = 0, now = Date.now() }) {
  if (!arenaEnabled() || !arenaId || !userId) return { scored: false };
  const row = await store.get(
    'SELECT points, games, wins, draws, losses, streak, best_streak, peak_elo FROM arena_scores WHERE arena_id = ? AND user_id = ?',
    [arenaId, userId]
  );
  if (!row) return { scored: false }; // didn't join / bot / not a participant
  const sc = arenaScore(result, row.streak);
  const games = row.games + 1;
  const wins = row.wins + (result === 'win' ? 1 : 0);
  const draws = row.draws + (result === 'draw' ? 1 : 0);
  const losses = row.losses + (result === 'loss' ? 1 : 0);
  const points = row.points + sc.points;
  const streak = sc.streakAfter;
  const best = Math.max(row.best_streak, streak);
  const peak = Math.max(row.peak_elo, elo || 0);
  await store.run(
    'UPDATE arena_scores SET points = ?, games = ?, wins = ?, draws = ?, losses = ?, streak = ?, best_streak = ?, peak_elo = ?, updated_at = ? WHERE arena_id = ? AND user_id = ?',
    [points, games, wins, draws, losses, streak, best, peak, now, arenaId, userId]
  );
  return { scored: true, points, streak, onFire: sc.onFire };
}

// --- Leaderboard ------------------------------------------------------------
export async function arenaStandings(arenaId, limit = 50) {
  const rows = await store.all(
    `SELECT s.user_id AS userId, u.username AS username, s.points AS points, s.games AS games,
            s.wins AS wins, s.draws AS draws, s.losses AS losses, s.streak AS streak
       FROM arena_scores s JOIN users u ON u.id = s.user_id
      WHERE s.arena_id = ?
      ORDER BY s.points DESC, s.games ASC, s.peak_elo DESC
      LIMIT ?`,
    [arenaId, limit]
  );
  return (rows || []).map((r, i) => ({
    rank: i + 1,
    userId: r.userId,
    username: r.username || '—',
    points: Number(r.points) || 0,
    games: Number(r.games) || 0,
    wins: Number(r.wins) || 0,
    draws: Number(r.draws) || 0,
    losses: Number(r.losses) || 0,
    streak: Number(r.streak) || 0,
    onFire: (Number(r.streak) || 0) >= 2,
  }));
}

// The caller's own standing (points + rank), or null if they haven't joined.
export async function userStanding(arenaId, userId) {
  const me = await store.get(
    'SELECT points, games, wins, draws, losses, streak FROM arena_scores WHERE arena_id = ? AND user_id = ?',
    [arenaId, userId]
  );
  if (!me) return null;
  const ahead = await store.get(
    'SELECT COUNT(*) AS n FROM arena_scores WHERE arena_id = ? AND points > ?',
    [arenaId, me.points]
  );
  return {
    points: Number(me.points) || 0,
    games: Number(me.games) || 0,
    wins: Number(me.wins) || 0,
    draws: Number(me.draws) || 0,
    losses: Number(me.losses) || 0,
    streak: Number(me.streak) || 0,
    onFire: (Number(me.streak) || 0) >= 2,
    rank: (Number(ahead && ahead.n) || 0) + 1,
  };
}

// Summarize an arena row + its top players for the API.
async function summarize(a, topN = 8) {
  if (!a) return null;
  return {
    id: a.id,
    name: a.name,
    tc: a.tc,
    startsAt: Number(a.starts_at),
    endsAt: Number(a.ends_at),
    status: a.status,
    championId: a.champion_id || null,
    players: (await store.get('SELECT COUNT(*) AS n FROM arena_scores WHERE arena_id = ?', [a.id]).catch(() => null)) || { n: 0 },
    top: await arenaStandings(a.id, topN).catch(() => []),
  };
}

// --- REST -------------------------------------------------------------------
export function mountArena(app) {
  // PUBLIC: lets the client show/hide the arena UI.
  app.get('/api/arena/config', (req, res) => {
    res.json({ enabled: arenaEnabled(), tc: ARENA_TC, durationMs: ARENA_DURATION_MS });
  });

  // PUBLIC: the live arena + the next upcoming one, each with a top-8 board.
  app.get('/api/arena/current', async (req, res) => {
    if (!arenaEnabled()) return res.json({ enabled: false, live: null, next: null });
    try {
      const now = Date.now();
      const live = await liveArena(now);
      const next = await nextArena(now);
      const out = { enabled: true, live: await summarize(live), next: await summarize(next), champions: await recentChampions(3) };
      // normalize players count shape
      if (out.live) out.live.players = Number(out.live.players.n) || 0;
      if (out.next) out.next.players = Number(out.next.players.n) || 0;
      res.json(out);
    } catch (e) {
      console.error('[arena] /current failed', e && e.message);
      res.status(500).json({ error: 'Could not load arenas.' });
    }
  });

  // PUBLIC: full standings for one arena.
  app.get('/api/arena/:id/leaderboard', async (req, res) => {
    try {
      const standings = await arenaStandings(req.params.id, 100);
      res.json({ standings });
    } catch (e) {
      res.status(500).json({ error: 'Could not load standings.' });
    }
  });

  // AUTH: enroll the caller (idempotent). The actual pairing runs over the
  // socket pool (Layer 2); this just makes them a scored participant.
  app.post('/api/arena/:id/join', requireAuth, async (req, res) => {
    if (!arenaEnabled()) return res.status(503).json({ error: 'Arenas are not enabled.' });
    try {
      const ok = await joinArena(req.params.id, req.userId, Date.now());
      if (!ok) return res.status(409).json({ error: 'This arena is not open to join.' });
      const standing = await userStanding(req.params.id, req.userId);
      res.json({ ok: true, standing });
    } catch (e) {
      console.error('[arena] join failed', e && e.message);
      res.status(500).json({ error: 'Could not join the arena.' });
    }
  });

  // AUTH: stop being paired (keeps your score on the board). Pool removal is
  // Layer 2; here we just ack so the client flow works pre-realtime.
  app.post('/api/arena/:id/leave', requireAuth, async (req, res) => {
    res.json({ ok: true });
  });

  // AUTH: the caller's own standing in an arena.
  app.get('/api/arena/:id/standing', requireAuth, async (req, res) => {
    try {
      const standing = await userStanding(req.params.id, req.userId);
      res.json({ joined: !!standing, standing: standing || null });
    } catch (e) {
      res.status(500).json({ error: 'Could not load your standing.' });
    }
  });
}

// --- Scheduler --------------------------------------------------------------
let schedTimer = null;
// Start the rolling scheduler. Runs an immediate ensure + lifecycle pass, then
// ticks. The tick is fully failure-isolated so it can never crash the server.
// `io` is passed through for the Layer 2 pairing pass + champion notifications.
export function startArenaScheduler(io = null, deps = {}) {
  if (!arenaEnabled()) return;
  const tick = async () => {
    try { await advanceLifecycle(Date.now(), io, deps); }
    catch (e) { console.error('[arena] scheduler tick failed', e && e.message); }
    // Layer 2 will add: try { await runArenaPairing(io); } catch {}
  };
  // Immediate bootstrap, then every 5s.
  tick();
  schedTimer = setInterval(tick, 5000);
  if (schedTimer.unref) schedTimer.unref();
}

export function stopArenaScheduler() {
  if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
}

export function logArenaStatus() {
  if (arenaEnabled()) {
    console.log(`[arena] ENABLED — rolling ${ARENA_DURATION_MS / 60000}min arenas (${ARENA_TC}), ${ARENA_BREAK_MS / 60000}min break. Set ARENA_ENABLED=0 to disable.`);
  } else {
    console.warn('[arena] DISABLED (ARENA_ENABLED=0) — all /api/arena/* routes inert, no arenas scheduled.');
  }
}
