// Redis-backed shared state for 1v1 online games (horizontal-scaling mode).
//
// This module is ONLY used when REDIS_URL is set. It mirrors game.js's in-memory
// 1v1 lifecycle (matchmaking -> game -> moves + clocks -> finish), but keeps all
// state in Redis so the game can be handled by ANY instance, and uses the
// Socket.IO Redis adapter for cross-instance delivery:
//   - per-user room  "u:<uid>"   (each socket joins it at auth) lets any instance
//     target a user wherever they're connected (io.to('u:'+uid).emit / socketsJoin)
//   - game room      "<gameId>"  carries move/over broadcasts to both players
//
// The in-memory path in game.js is left untouched; this is a parallel impl.
import { Chess } from 'chess.js';
import crypto from 'crypto';
import { db, getUserById, areBlocked } from './db.js';

// ---- keys ----
const K = {
  game: (id) => `ct:g:${id}`,
  active: 'ct:games:active',          // set of active gameIds
  userGame: (uid) => `ct:ua:${uid}`,  // uid -> gameId
  queue: 'ct:mmq',                    // hash uid -> JSON entry
  lockGame: (id) => `ct:lk:g:${id}`,
  lockMm: 'ct:lk:mm',
  recent: (id) => `ct:rg:${id}`,      // finished-game snapshot for rematch (TTL)
  offers: (id) => `ct:ro:${id}`,      // set of uids who offered a rematch (TTL)
};
const DISCONNECT_GRACE_MS = 30000;
const RECENT_TTL_MS = 120000;
const REMATCH_TTL_MS = 30000;
const userRoom = (uid) => `u:${uid}`;
// Emit a game event to BOTH players via their per-user rooms (joined at auth).
// This is reliable across instances via the Redis adapter and avoids any
// socketsJoin propagation-timing races.
function emitGame(io, g, event, data) {
  io.to(userRoom(g.white)).to(userRoom(g.black)).emit(event, data);
}

// ---- pure helpers (duplicated from game.js on purpose to keep this module
// decoupled; these are stable) ----
// One timed control + unlimited (mirrors game.js / app.js) to avoid splitting the queue.
const TC_ALLOWLIST = new Set(['10+0', 'unlimited']);
function normalizeTc(tc) { return (typeof tc === 'string' && TC_ALLOWLIST.has(tc)) ? tc : 'unlimited'; }
// Server decides the canonical 1v1 mode; only 'casual' is unrated, anything else
// (incl. unknown/garbage) folds to 'ranked' so a client can't force unrated.
function normalizeMode(m) { return m === 'casual' ? 'casual' : 'ranked'; }
function parseTc(tc) {
  const key = normalizeTc(tc);
  if (key === 'unlimited') return null;
  const m = /^(\d+)\+(\d+)$/.exec(key);
  return m ? { initialMs: Number(m[1]) * 60000, incrementMs: Number(m[2]) * 1000 } : null;
}
function makeClock(parsed) {
  if (!parsed) return null;
  return { w: parsed.initialMs, b: parsed.initialMs, incrementMs: parsed.incrementMs, running: 'w', turnStartedAt: Date.now() };
}
function eloDelta(a, b, score) { const K2 = 32; const exp = 1 / (1 + Math.pow(10, (b - a) / 400)); return Math.round(K2 * (score - exp)); }
function publicUser(u) { return { id: u.id, username: u.username, elo: u.elo, wins: u.wins, losses: u.losses, isPremium: !!u.is_premium, avatarStock: u.avatar_stock || 'av_knight', avatarDataUrl: u.avatar_data_url || '' }; }
function newGameId() { return 'g_' + crypto.randomBytes(6).toString('hex'); }
function colorHasMatingMaterial(chess, color) {
  try {
    let knights = 0, bishops = 0;
    for (const row of chess.board()) for (const sq of row) {
      if (!sq || sq.color !== color) continue;
      if (sq.type === 'q' || sq.type === 'r' || sq.type === 'p') return true;
      if (sq.type === 'n') knights++; else if (sq.type === 'b') bishops++;
    }
    return knights + bishops >= 2;
  } catch { return true; }
}

// ---- Redis lock (SET NX PX + Lua compare-del) ----
const UNLOCK_LUA = `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`;
async function withLock(R, key, fn, { ttlMs = 5000, tries = 50, waitMs = 20 } = {}) {
  const token = crypto.randomBytes(8).toString('hex');
  let held = false;
  for (let i = 0; i < tries; i++) {
    const ok = await R.set(key, token, 'PX', ttlMs, 'NX');
    if (ok) { held = true; break; }
    await new Promise((r) => setTimeout(r, waitMs));
  }
  if (!held) throw new Error('lock timeout: ' + key);
  try { return await fn(); }
  finally { try { await R.eval(UNLOCK_LUA, 1, key, token); } catch { /* lock expired */ } }
}

// ---- game (de)serialization ----
async function loadGame(R, gameId) {
  const raw = await R.get(K.game(gameId));
  return raw ? JSON.parse(raw) : null;
}
async function saveGame(R, g) { await R.set(K.game(g.id), JSON.stringify(g)); }
function chessOf(g) { const c = new Chess(); if (g.pgn) { try { c.loadPgn(g.pgn); } catch { c.load(g.fen); } } return c; }
function clockStartSnap(clock, parsed) {
  if (!clock || !parsed) return null;
  return { initialMs: parsed.initialMs, incrementMs: clock.incrementMs, w: clock.w, b: clock.b, running: clock.running, serverNow: Date.now() };
}
function clockMoveSnap(clock) { return { w: clock.w, b: clock.b, running: clock.running, serverNow: Date.now() }; }

// ---------------------------------------------------------------------------
// Presence / auth resume
// ---------------------------------------------------------------------------
// Called from the auth handler (redis mode). Joins the per-user room so this
// user is reachable from any instance, and resumes an in-progress game.
export async function onAuth(io, R, socket, uid) {
  socket.join(userRoom(uid));
  const gameId = await R.get(K.userGame(uid));
  if (!gameId) return;
  await withLock(R, K.lockGame(gameId), async () => {
    const g = await loadGame(R, gameId);
    if (!g || g.ended || (g.white !== uid && g.black !== uid)) return;
    // The socket already joined its per-user room above; game events reach it there.
    if (g.disconnectedUid === uid) {
      g.disconnectedUid = null; g.graceUntil = null;
      await saveGame(R, g);
      const opp = g.white === uid ? g.black : g.white;
      io.to(userRoom(opp)).emit('opponent_reconnected', { gameId });
    }
    const chess = chessOf(g);
    const yourColor = g.white === uid ? 'w' : 'b';
    const clockSnap = g.clock ? { w: g.clock.w, b: g.clock.b, running: g.clock.running, serverNow: Date.now() } : null;
    socket.emit('game_state', {
      gameId, fen: chess.fen(), mode: g.mode, yourColor,
      white: publicUser(getUserById(g.white)), black: publicUser(getUserById(g.black)),
      clock: clockSnap,
    });
  });
}

// ---------------------------------------------------------------------------
// Matchmaking (shared queue, atomic pairing under a Redis lock)
// ---------------------------------------------------------------------------
export async function joinQueue(io, R, uid, { mode, tc }) {
  const user = getUserById(uid);
  if (!user) return;
  const entry = { uid, elo: user.elo, joinedAt: Date.now(), mode: normalizeMode(mode), tc: normalizeTc(tc) };
  await R.hset(K.queue, uid, JSON.stringify(entry));
  await tryPair(io, R);
}
export async function leaveQueue(R, uid) { await R.hdel(K.queue, uid); }

async function tryPair(io, R) {
  let pair = null;
  await withLock(R, K.lockMm, async () => {
    const all = await R.hgetall(K.queue);
    const entries = Object.values(all).map((s) => JSON.parse(s)).sort((a, b) => a.joinedAt - b.joinedAt);
    for (const a of entries) {
      const tol = Math.min(500, 50 + Math.floor((Date.now() - a.joinedAt) / 1000) * 25);
      const b = entries.find((x) => x.uid !== a.uid && x.mode === a.mode && x.tc === a.tc && Math.abs(x.elo - a.elo) <= tol && !areBlocked(a.uid, x.uid));
      if (b) { await R.hdel(K.queue, a.uid, b.uid); pair = [a, b]; break; }
    }
  });
  if (pair) {
    const [a, b] = Math.random() < 0.5 ? pair : [pair[1], pair[0]];
    await startGame(io, R, a, b); // a = white
  }
}

// ---------------------------------------------------------------------------
// Game start
// ---------------------------------------------------------------------------
async function startGame(io, R, whiteEntry, blackEntry) {
  const id = newGameId();
  const tc = normalizeTc(whiteEntry.tc);
  const parsed = parseTc(tc);
  const clock = makeClock(parsed);
  const wUser = getUserById(whiteEntry.uid), bUser = getUserById(blackEntry.uid);
  if (!wUser || !bUser) return;
  const g = {
    id, white: whiteEntry.uid, black: blackEntry.uid, mode: normalizeMode(whiteEntry.mode),
    tc, clock, pgn: '', started: Date.now(),
    whiteEloBefore: wUser.elo, blackEloBefore: bUser.elo,
    ended: false, disconnectedUid: null, graceUntil: null,
  };
  await saveGame(R, g);
  await R.sadd(K.active, id);
  await R.set(K.userGame(whiteEntry.uid), id);
  await R.set(K.userGame(blackEntry.uid), id);
  emitGame(io, g, 'match_found', {
    gameId: id, white: publicUser(wUser), black: publicUser(bUser),
    mode: g.mode, tc, clock: clockStartSnap(clock, parsed),
  });
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------
export async function handleMove(io, R, socket, uid, { gameId, from, to, promotion }) {
  await withLock(R, K.lockGame(gameId), async () => {
    const g = await loadGame(R, gameId);
    if (!g || g.ended) return;
    const color = g.white === uid ? 'w' : g.black === uid ? 'b' : null;
    if (!color) return;
    const chess = chessOf(g);
    if (chess.turn() !== color) return;
    const move = chess.move({ from, to, promotion: promotion || 'q' });
    if (!move) { socket.emit('illegal_move', { gameId, from, to }); return; }
    let clockPayload = null;
    if (g.clock) {
      const c = g.clock;
      c[color] -= Date.now() - c.turnStartedAt;
      if (c[color] <= 0) { c[color] = 0; await finishTimeout(io, R, g, chess, color); return; }
      c[color] += c.incrementMs;
      c.running = color === 'w' ? 'b' : 'w';
      c.turnStartedAt = Date.now();
      clockPayload = clockMoveSnap(c);
    }
    g.pgn = chess.pgn();
    await saveGame(R, g);
    emitGame(io, g, 'move_made', { gameId, move, fen: chess.fen(), clock: clockPayload });
    if (chess.isGameOver()) await finishGame(io, R, g, {}, chess);
  });
}

export async function handleResign(io, R, uid, gameId) {
  await withLock(R, K.lockGame(gameId), async () => {
    const g = await loadGame(R, gameId);
    if (!g || g.ended) return;
    if (g.white !== uid && g.black !== uid) return;
    const winner = g.white === uid ? g.black : g.white;
    await finishGame(io, R, g, { reason: 'resignation', winnerId: winner }, chessOf(g));
  });
}

// ---------------------------------------------------------------------------
// Disconnect grace + sweep
// ---------------------------------------------------------------------------
// On disconnect we do NOT forfeit immediately. We stamp a grace deadline on the
// game and notify the opponent; the sweep (which runs on every instance) forfeits
// the game once the deadline passes IF the player hasn't reconnected. Reconnect
// from any instance clears the deadline (see onAuth). The clock keeps running,
// so a flag-fall during the grace ends the game first.
export async function onDisconnect(io, R, uid) {
  await R.hdel(K.queue, uid);
  await leaveRematch(io, R, uid); // retract any pending rematch offer
  const gameId = await R.get(K.userGame(uid));
  if (!gameId) return;
  await withLock(R, K.lockGame(gameId), async () => {
    const g = await loadGame(R, gameId);
    if (!g || g.ended) return;
    g.disconnectedUid = uid;
    g.graceUntil = Date.now() + DISCONNECT_GRACE_MS;
    await saveGame(R, g);
    const opp = g.white === uid ? g.black : g.white;
    io.to(userRoom(opp)).emit('opponent_disconnected', { gameId, graceMs: DISCONNECT_GRACE_MS });
  });
}

// Per-instance sweep: flag running sides whose clock hit zero (e.g. a player who
// never moved). Each instance sweeps; the per-game lock + ended flag make it safe.
export function startSweep(io, R) {
  const timer = setInterval(async () => {
    let ids = [];
    try { ids = await R.smembers(K.active); } catch { return; }
    const now = Date.now();
    for (const id of ids) {
      try {
        await withLock(R, K.lockGame(id), async () => {
          const g = await loadGame(R, id);
          if (!g) { await R.srem(K.active, id); return; }
          if (g.ended) return;
          // Disconnect-grace expiry (applies to clocked AND unlimited games).
          if (g.disconnectedUid && g.graceUntil && g.graceUntil <= now) {
            const winner = g.disconnectedUid === g.white ? g.black : g.white;
            await finishGame(io, R, g, { reason: 'disconnect', winnerId: winner }, chessOf(g));
            return;
          }
          // Clock flag-fall.
          if (!g.clock) return;
          const remaining = g.clock[g.clock.running] - (now - g.clock.turnStartedAt);
          if (remaining <= 0) { g.clock[g.clock.running] = 0; await finishTimeout(io, R, g, chessOf(g), g.clock.running); }
        }, { tries: 3 });
      } catch { /* contended; next tick */ }
    }
  }, 1000);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

async function finishTimeout(io, R, g, chess, flagColor) {
  const winnerColor = flagColor === 'w' ? 'b' : 'w';
  const winnerId = colorHasMatingMaterial(chess, winnerColor) ? (winnerColor === 'w' ? g.white : g.black) : null;
  await finishGame(io, R, g, { reason: 'timeout', winnerId }, chess);
}

// ---------------------------------------------------------------------------
// Finish (ELO + persist atomically, broadcast, cleanup) — mirrors game.js
// ---------------------------------------------------------------------------
async function finishGame(io, R, g, override, chess) {
  if (g.ended) return;
  g.ended = true;
  await saveGame(R, g);
  let winnerId = override.winnerId || null;
  let reason = override.reason || (chess.isCheckmate() ? 'checkmate' : (chess.isDraw() ? 'draw' : 'unknown'));
  if (!winnerId && override.winnerId === undefined && chess.isCheckmate()) {
    winnerId = chess.turn() === 'w' ? g.black : g.white;
  }
  const isDraw = !winnerId;
  const whiteUser = getUserById(g.white), blackUser = getUserById(g.black);
  let wd = 0, bd = 0;
  if (g.mode === 'ranked' && whiteUser && blackUser) {
    const whiteScore = isDraw ? 0.5 : (winnerId === g.white ? 1 : 0);
    wd = eloDelta(whiteUser.elo, blackUser.elo, whiteScore);
    bd = eloDelta(blackUser.elo, whiteUser.elo, 1 - whiteScore);
  }
  try {
    db.transaction(() => {
      if (g.mode === 'ranked') {
        const up = db.prepare(`UPDATE users SET elo = elo + ?, wins = wins + ?, losses = losses + ?, draws = draws + ?,
            current_streak = CASE WHEN ? THEN current_streak + 1 ELSE 0 END,
            best_streak = MAX(best_streak, CASE WHEN ? THEN current_streak + 1 ELSE 0 END) WHERE id = ?`);
        up.run(wd, isDraw ? 0 : (winnerId === g.white ? 1 : 0), isDraw ? 0 : (winnerId === g.white ? 0 : 1), isDraw ? 1 : 0,
          isDraw ? 0 : (winnerId === g.white ? 1 : 0), isDraw ? 0 : (winnerId === g.white ? 1 : 0), g.white);
        up.run(bd, isDraw ? 0 : (winnerId === g.black ? 1 : 0), isDraw ? 0 : (winnerId === g.black ? 0 : 1), isDraw ? 1 : 0,
          isDraw ? 0 : (winnerId === g.black ? 1 : 0), isDraw ? 0 : (winnerId === g.black ? 1 : 0), g.black);
      }
      db.prepare(`INSERT INTO games (id, white_id, black_id, mode, result, winner_id, pgn,
                                     white_elo_before, black_elo_before, white_elo_delta, black_elo_delta, created_at, ended_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(g.id, g.white, g.black, g.mode, reason, winnerId, chess.pgn(), g.whiteEloBefore, g.blackEloBefore, wd, bd, g.started, Date.now());
    })();
  } catch (e) { console.error('[scale] finish persist failed', e && e.message); }
  emitGame(io, g, 'game_over', { gameId: g.id, winnerId, reason, whiteDelta: wd, blackDelta: bd, pgn: chess.pgn() });
  await R.del(K.game(g.id));
  await R.srem(K.active, g.id);
  await R.del(K.userGame(g.white));
  await R.del(K.userGame(g.black));
  // Short-lived snapshot so a rematch can be set up after the game object is gone.
  await R.set(K.recent(g.id), JSON.stringify({ whiteUid: g.white, blackUid: g.black, mode: g.mode, tc: g.tc }), 'PX', RECENT_TTL_MS);
}

// ---------------------------------------------------------------------------
// Rematch (1v1) — shared across instances
// ---------------------------------------------------------------------------
const uoffKey = (uid) => `ct:uoff:${uid}`; // reverse pointer: uid -> gameId it offered on

async function recentOf(R, gameId) {
  const raw = await R.get(K.recent(gameId));
  return raw ? JSON.parse(raw) : null;
}

export async function handleRematchOffer(io, R, uid, gameId) {
  const rg = await recentOf(R, gameId);
  if (!rg || (rg.whiteUid !== uid && rg.blackUid !== uid)) return;
  const opp = rg.whiteUid === uid ? rg.blackUid : rg.whiteUid;
  if (await R.sismember(K.offers(gameId), opp)) { await startRematch(io, R, gameId, rg); return; }
  await R.sadd(K.offers(gameId), uid);
  await R.pexpire(K.offers(gameId), REMATCH_TTL_MS);
  await R.set(uoffKey(uid), gameId, 'PX', REMATCH_TTL_MS);
  io.to(userRoom(opp)).emit('rematch_offered', { gameId, from: publicUser(getUserById(uid)) });
  // Best-effort expiry notice (Redis TTL also auto-cleans the offer set).
  const t = setTimeout(async () => {
    try {
      if (await R.sismember(K.offers(gameId), uid)) {
        await R.del(K.offers(gameId)); await R.del(uoffKey(uid));
        io.to(userRoom(uid)).to(userRoom(opp)).emit('rematch_expired', { gameId });
      }
    } catch { /* ignore */ }
  }, REMATCH_TTL_MS);
  if (typeof t.unref === 'function') t.unref();
}

export async function handleRematchAccept(io, R, uid, gameId) {
  const rg = await recentOf(R, gameId);
  if (!rg || (rg.whiteUid !== uid && rg.blackUid !== uid)) return;
  const opp = rg.whiteUid === uid ? rg.blackUid : rg.whiteUid;
  if (await R.sismember(K.offers(gameId), opp)) { await startRematch(io, R, gameId, rg); return; }
  // No standing offer yet -> treat accept as an offer so the flow still completes.
  await R.sadd(K.offers(gameId), uid);
  await R.pexpire(K.offers(gameId), REMATCH_TTL_MS);
  await R.set(uoffKey(uid), gameId, 'PX', REMATCH_TTL_MS);
}

export async function handleRematchDecline(io, R, uid, gameId) {
  const rg = await recentOf(R, gameId);
  if (!rg || (rg.whiteUid !== uid && rg.blackUid !== uid)) return;
  const offerer = rg.whiteUid === uid ? rg.blackUid : rg.whiteUid;
  await R.del(K.offers(gameId)); await R.del(uoffKey(uid)); await R.del(uoffKey(offerer));
  io.to(userRoom(offerer)).emit('rematch_declined', { gameId });
}

// Retract a user's pending offer on disconnect; tell the opponent it expired.
async function leaveRematch(io, R, uid) {
  const gameId = await R.get(uoffKey(uid));
  if (!gameId) return;
  await R.del(uoffKey(uid));
  if (await R.sismember(K.offers(gameId), uid)) {
    await R.del(K.offers(gameId));
    const rg = await recentOf(R, gameId);
    if (rg) {
      const opp = rg.whiteUid === uid ? rg.blackUid : rg.whiteUid;
      io.to(userRoom(opp)).emit('rematch_expired', { gameId });
    }
  }
}

// Start a rematch: same players, same mode/tc, COLORS SWAPPED (prev Black -> White).
async function startRematch(io, R, gameId, rg) {
  await R.del(K.offers(gameId)); await R.del(K.recent(gameId));
  await R.del(uoffKey(rg.whiteUid)); await R.del(uoffKey(rg.blackUid));
  const newWhite = getUserById(rg.blackUid), newBlack = getUserById(rg.whiteUid);
  if (!newWhite || !newBlack) return;
  await startGame(io, R,
    { uid: rg.blackUid, elo: newWhite.elo, mode: rg.mode, tc: rg.tc },
    { uid: rg.whiteUid, elo: newBlack.elo, mode: rg.mode, tc: rg.tc });
}
