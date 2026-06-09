// In-memory game state + matchmaking + Socket.IO handlers.
// When REDIS_URL is set (multi-instance mode) the 1v1 lifecycle is delegated to
// scale-store.js (shared Redis state); the in-memory path below is used as-is for
// single-instance mode and for 2v2 (which stays single-instance for now).
import { Chess } from 'chess.js';
import crypto from 'crypto';
import { createRequire } from 'module';
import { db, getUserById, areBlocked } from './db.js';
import * as store from './store.js';
import * as scale from './scale-store.js';
import * as scaleTeam from './scale-team.js';
import { botMove, botEngineReady } from './bot.js';
import { sendPushToUser } from './push.js';
import { recordArenaResult, liveArena, joinArena, arenaEnabled, ARENA_BOT_WAIT_MS } from './arena.js';

// --- RANKED bot-backfill (cold-start: no humans online) --------------------
// When a player waits in the ranked 1v1 queue past this window with no human
// match, the server starts a game against a SERVER-AUTHORITATIVE engine bot so
// they never sit stuck. The bot:
//   - plays at the HUMAN's CURRENT rating (a fair fight => ELO-neutral in
//     expectation; also kills rating-farming),
//   - is honestly LABELED (opponent username 'Computer 🤖', isBot:true, its elo),
//   - runs in the SAME flow: every HUMAN move is validated exactly as a normal
//     ranked game, and after each human move the server computes + applies +
//     broadcasts the bot's reply (respecting turn + clocks),
//   - updates ELO + persists via the existing finishGame path (human's rating
//     moves vs the bot's rating = the human's rating at match time).
// 2v2 stays human-only. Bot games are NEVER created in multi-instance (scaleR)
// mode here — the single-instance in-memory path owns matchmaking there.
const BOT_BACKFILL_MS = Number(process.env.BOT_BACKFILL_MS) || 16_000;
const BOT_DISPLAY_NAME = 'Computer 🤖';
function newBotUid() { return 'bot_' + crypto.randomBytes(6).toString('hex'); }
function isBotUid(uid) { return typeof uid === 'string' && uid.startsWith('bot_'); }
// Per-queued-user backfill timers so we can cancel on match/leave/disconnect.
const botBackfillTimers = new Map(); // uid -> timeout

// ===========================================================================
// SEASONS — monthly competitive ladder (deterministic, no cron) -------------
// ===========================================================================
// The "current season" is just the UTC calendar month. Everything below is pure
// date math from a given timestamp — no Date.now() randomness, no scheduled job:
//   * id    = "YYYY-MM" (e.g. "2026-06")
//   * name  = "June 2026"
//   * start = first instant of the month (UTC)
//   * end   = first instant of NEXT month (UTC, exclusive) = endsAt
// daysRemaining is ceil((endsAt - at) / day) so the client can render a
// "season ends in N days" countdown from the API's endsAt without its own clock
// quirks. Exported so test/season.mjs can assert the math directly.
const SEASON_MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
const DAY_MS = 24 * 60 * 60 * 1000;

export function seasonInfo(at = Date.now()) {
  const d = new Date(at);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-based
  const seasonId = `${y}-${String(m + 1).padStart(2, '0')}`;
  const name = `${SEASON_MONTHS[m]} ${y}`;
  const startsAt = Date.UTC(y, m, 1);
  const endsAt = Date.UTC(y, m + 1, 1); // first instant of next month (exclusive)
  const daysRemaining = Math.max(0, Math.ceil((endsAt - at) / DAY_MS));
  return { seasonId, name, startsAt, endsAt, daysRemaining };
}

// The season id immediately PRECEDING the season that contains `at` (for
// end-of-season recognition: last month's champion).
export function previousSeasonId(at = Date.now()) {
  const d = new Date(at);
  // Step back to the last day of the previous month, then read its season id.
  return seasonInfo(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).seasonId;
}

// ---------------------------------------------------------------------------
// Checkers engine (additive). The engine ships as a UMD/CommonJS script at the
// repo root (checkers.js). The build also copies it next to the server files in
// the Docker image (/app/checkers.js). Load it via createRequire, trying both
// the dev layout (server/ -> ../checkers.js) and the Docker layout
// (./checkers.js) so the same code works in both. NOTE: this is purely additive
// — chess play does not depend on it in any way.
const _require = createRequire(import.meta.url);
let CT_Checkers = null;
for (const p of ['../checkers.js', './checkers.js']) {
  try { CT_Checkers = _require(p); break; } catch { /* try next */ }
}
if (!CT_Checkers) console.error('[checkers] engine not found at ../checkers.js or ./checkers.js — checkers disabled');

// Ranked play on/off — a seasonal switch via env (mirrors server.js). Ranked is
// now ON by default; set RANKED_ENABLED=0 (or 'false') to turn it OFF. Enforced
// server-side here so a tampered client can't queue ranked matchmaking while
// ranked is disabled. Casual paths (friendly challenge, checkers friend challenge,
// rematches) are NOT gated.
const RANKED_DISABLED_MSG = 'Ranked play is coming soon.';
function rankedEnabled() {
  const v = String(process.env.RANKED_ENABLED ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return true; // default ON
}

const activeGames = new Map();     // gameId -> { white, black, chess, mode, started }
const userActiveGame = new Map();  // uid -> gameId (1v1, mirrors userActiveTeamGame)
const matchmakingQueue = new Map(); // userId -> { socketId, elo, joinedAt, mode }
const userSocket = new Map();      // userId -> socketId
const socketUser = new Map();      // socketId -> userId
const chatBuckets = new Map();     // userId -> { tokens, lastRefill }
const mmBuckets = new Map();       // userId -> { tokens, lastRefill }

// --- Arena tournaments (realtime; Layer 2 of ARENA_DESIGN.md) ---------------
// arenaPool is the WAITING ROOM: users currently looking for an arena game.
// Once paired they're removed; when their arena game ends they're re-pooled
// (requeueArena). arenaMembership remembers which live arena each participant
// belongs to, so re-pooling survives across games. Single-instance only (gated
// on !scaleR, exactly like ranked bot-backfill).
const arenaPool = new Map();        // uid -> { socketId, elo, arenaId, joinedAt }
const arenaMembership = new Map();  // uid -> arenaId (current arena the user joined)
let arenaPairTimer = null;

// --- Rematch (1v1) state ---
// recentGames: short-lived snapshot of a finished 1v1 so a rematch can be set up
// after the game object is gone. gameId -> { whiteUid, blackUid, mode, tc, expireTimer }.
const recentGames = new Map();
// rematchOffers: standing rematch offers. gameId -> { offers: Set<uid>, expireTimer }.
const rematchOffers = new Map();
const RECENT_GAME_TTL_MS = 120_000;
const REMATCH_OFFER_TTL_MS = 30_000;
const DISCONNECT_GRACE_MS = 30_000;

// --- 2v2 (team) state ---
const teamQueue = new Map();       // entryId -> { id, type:'solo'|'duo', members:[{uid,socketId,elo}], joinedAt }
const duoInvites = new Map();      // inviteId -> { hostId, hostSocketId, guestId, createdAt, expiresAt }
const activeTeamGames = new Map(); // gameId -> team game object (see startTeamGame)
const userActiveTeamGame = new Map(); // uid -> gameId (so we can find which game on resign/move)
const teamMmBuckets = new Map();   // uid -> token bucket

// --- 1v1 FRIENDLY challenge state ---
// Online unrated 1v1 invite to a specific FRIEND. ALWAYS casual — never ranked
// (ranked 1v1 stays random-matchmaking-only; see startChallengeGame which forces
// mode='casual'). Modeled on duoInvites.
// inviteId -> { id, fromId, fromSocketId, toId, tc, createdAt, expiresAt, expireTimer }.
const challengeInvites = new Map();
const CHALLENGE_INVITE_TTL_MS = 60_000;

// --- CHECKERS FRIENDLY challenge state (additive) ---
// Dedicated invite map for the FRIEND checkers challenge the client emits via the
// `checkers_challenge_*` events (parallel to, and independent from, the chess
// `challengeInvites` above). ALWAYS casual / UNRATED on accept (mode forced to
// 'casual' server-side; ranked checkers stays matchmaking-only). Same TTL/expiry
// + disconnect-cleanup behavior as the chess challenge invites.
// inviteId -> { id, fromId, fromSocketId, toId, size, rules, createdAt, expiresAt, expireTimer }.
const checkersChallengeInvites = new Map();

// ===========================================================================
// CHECKERS (additive — fully parallel to the chess lifecycle above)
// ===========================================================================
// Server-authoritative: each game's engine state lives here and is the single
// source of truth. Every move is re-validated with the engine; illegal moves are
// rejected. State is single-instance (in-memory); when REDIS_URL is set the
// chess paths use the shared store, but checkers stays single-instance — the
// handlers below simply don't consult `scaleR`, so they keep working and never
// throw when Redis is configured (documented limitation: no cross-instance
// checkers resume/scale yet).
const activeCheckersGames = new Map();  // gameId -> { id, white, black, game, mode, size, rules, started, eloBefore, rated }
const userActiveCheckersGame = new Map(); // uid -> gameId
// Separate matchmaking queue keyed by `${size}|${rules}|${mode}` bucket.
const checkersQueue = new Map();        // uid -> { socketId, elo, joinedAt, mode, size, rules }
const checkersMmBuckets = new Map();    // uid -> token bucket

function newCheckersGameId() { return 'ck_' + crypto.randomBytes(6).toString('hex'); }

// Normalise client-supplied checkers params to a safe, allowlisted shape. The
// server decides the canonical mode (only 'casual' is unrated; anything else
// folds to 'ranked' so a client cannot smuggle an unrated value the other way).
function normalizeCheckersSize(size) { return Number(size) === 10 ? 10 : 8; }
function normalizeCheckersRules(rules, size) {
  if (rules === 'casual') return 'casual';
  // Official sets are size-locked by the engine: acf=8, fmjd=10. Snap to the
  // valid official ruleset for the chosen size; unknown values default official.
  return size === 10 ? 'fmjd' : 'acf';
}
function normalizeCheckersMode(m) { return m === 'casual' ? 'casual' : 'ranked'; }
// Which checkers Elo column applies to a board size.
function checkersEloColumn(size) { return size === 10 ? 'elo_checkers_10' : 'elo_checkers_8'; }
// Which ranked-games-played counter column applies to a board size. Returns from
// a FIXED two-value allowlist (never raw input) so the column name is safe to
// interpolate into SQL. Defaults to the 8x8 counter for any non-10 size.
function checkersGamesColumn(size) { return size === 10 ? 'checkers10_games' : 'checkers8_games'; }
function checkersEloOf(user, size) {
  const v = size === 10 ? user.elo_checkers_10 : user.elo_checkers_8;
  return Number.isFinite(v) ? v : 1200;
}
// Is this user currently in ANY game (chess 1v1/2v2 or checkers)?
function isUserInAnyGame(uid) {
  return userActiveGame.has(uid) || userActiveTeamGame.has(uid) || userActiveCheckersGame.has(uid);
}

// Module-level io handle so non-socket code (e.g. Express friend-request routes
// via notifyUser) can push events to a specific connected user.
let ioRef = null;
// Emit `event` to a user IF they currently have a live socket. Returns whether a
// socket was found. Used to deliver real-time friend requests/accepts.
export function notifyUser(userId, event, data) {
  if (!ioRef) return false;
  const sid = userSocket.get(String(userId));
  if (!sid) return false;
  const sock = ioRef.sockets.sockets.get(sid);
  if (!sock) return false;
  sock.emit(event, data);
  return true;
}
// Distinct authenticated users with a live socket right now (admin "online" stat).
export function getOnlineUserCount() {
  return userSocket.size;
}

// --- Time controls (server-authoritative clocks) ---
// Allowlisted keys; anything else is treated as 'unlimited' (no clock).
// Kept to a single timed control + unlimited so the matchmaking pool stays one
// timed bucket (mirrors the two-option client picker in app.js). Any legacy key
// from older clients folds into 'unlimited' rather than spawning a stray bucket.
// '5+0'/'3+2' are blitz controls used by arena tournaments (arena.js ARENA_TC).
// The client's 1v1 picker still only offers 10+0/unlimited; these are reachable
// only via server-created arena games, so adding them changes no existing flow.
const TC_ALLOWLIST = new Set(['10+0', '5+0', '3+2', 'unlimited']);

// Normalise an incoming tc value to an allowlisted key (defaults to 'unlimited').
function normalizeTc(tc) {
  return (typeof tc === 'string' && TC_ALLOWLIST.has(tc)) ? tc : 'unlimited';
}

// Server decides the canonical 1v1 mode (the client cannot smuggle an arbitrary
// string). Only 'casual' is unrated; anything else (including garbage/unknown)
// folds to 'ranked' so an attacker can't silently make a game unrated.
function normalizeMode(m) {
  return m === 'casual' ? 'casual' : 'ranked';
}

// Parse an allowlisted tc key into { initialMs, incrementMs } or null for unlimited.
function parseTc(tc) {
  const key = normalizeTc(tc);
  if (key === 'unlimited') return null;
  const m = /^(\d+)\+(\d+)$/.exec(key);
  if (!m) return null;
  return { initialMs: Number(m[1]) * 60 * 1000, incrementMs: Number(m[2]) * 1000 };
}

// Build the clock object for a fresh clocked game (or null for unlimited).
function makeClock(parsed) {
  if (!parsed) return null;
  return {
    w: parsed.initialMs,
    b: parsed.initialMs,
    incrementMs: parsed.incrementMs,
    running: 'w',
    turnStartedAt: Date.now(),
  };
}

// Wire-shape for match_found / team_match_found.
function clockSnapshotForStart(clock, parsed) {
  if (!clock || !parsed) return null;
  return {
    initialMs: parsed.initialMs,
    incrementMs: clock.incrementMs,
    w: clock.w,
    b: clock.b,
    running: clock.running,
    serverNow: Date.now(),
  };
}

// Wire-shape for move_made.
function clockSnapshotForMove(clock) {
  return { w: clock.w, b: clock.b, running: clock.running, serverNow: Date.now() };
}

// Timeout-scoring nicety: a side that flags loses, UNLESS the side that would
// WIN on time has insufficient mating material — in which case it's a draw.
// We test the winning color's own pieces: a lone king, K+N, or K+B (any number
// of same-color bishops) cannot force mate, so the win is downgraded to a draw.
function colorHasMatingMaterial(chess, color) {
  try {
    const board = chess.board();
    let knights = 0, bishops = 0;
    for (const row of board) {
      for (const sq of row) {
        if (!sq || sq.color !== color) continue;
        const t = sq.type;
        if (t === 'q' || t === 'r' || t === 'p') return true; // can mate
        if (t === 'n') knights++;
        else if (t === 'b') bishops++;
      }
    }
    // King-only, K+single minor cannot force mate. K + (2+ knights) or
    // K + bishop(s) + knight, etc. -> treat as sufficient (be permissive).
    if (knights + bishops >= 2) return true;
    return false; // lone K, K+N, or K+B
  } catch {
    return true; // on any error, don't downgrade the result
  }
}

// Finish a clocked 1v1 game on a flag by `flagColor` ('w'|'b'). Normally a loss
// for the flagger; downgraded to a draw if the winner can't mate.
function timeoutFinishGame(io, game, flagColor) {
  const winnerColor = flagColor === 'w' ? 'b' : 'w';
  if (!colorHasMatingMaterial(game.chess, winnerColor)) {
    finishGame(io, game, { reason: 'timeout', winnerId: null });
    return;
  }
  const winnerId = winnerColor === 'w' ? game.white : game.black;
  finishGame(io, game, { reason: 'timeout', winnerId });
}

// Finish a clocked 2v2 game on a flag by team `flagColor`.
function timeoutFinishTeamGame(io, tg, flagColor) {
  const winnerColor = flagColor === 'w' ? 'b' : 'w';
  if (!colorHasMatingMaterial(tg.chess, winnerColor)) {
    finishTeamGame(io, tg, { reason: 'timeout', winnerColor: null });
    return;
  }
  finishTeamGame(io, tg, { reason: 'timeout', winnerColor });
}

function newGameId() { return 'g_' + crypto.randomBytes(6).toString('hex'); }
function newDuoInviteId() { return 'di_' + crypto.randomBytes(5).toString('hex'); }
function newTeamEntryId() { return 'tq_' + crypto.randomBytes(5).toString('hex'); }
function newChallengeInviteId() { return 'ci_' + crypto.randomBytes(5).toString('hex'); }

// Are two users confirmed friends? Mirrors /api/friends/add: a confirmed
// friendship is stored as a row in `friendships`. Backend-agnostic via the store
// facade so it works on SQLite and Postgres.
async function areFriends(a, b) {
  const row = await store.get('SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?', [a, b]);
  return !!row;
}

// Is this user currently mid-game (1v1 or 2v2, in-memory path)?
function isUserInGame(uid) {
  return userActiveGame.has(uid) || userActiveTeamGame.has(uid);
}

// Tear down a challenge invite (drop its record + cancel its expire timer).
function clearChallengeInvite(inviteId) {
  const inv = challengeInvites.get(inviteId);
  if (!inv) return;
  if (inv.expireTimer) clearTimeout(inv.expireTimer);
  challengeInvites.delete(inviteId);
}

// Tear down a checkers-challenge invite (drop its record + cancel its expire
// timer). Mirrors clearChallengeInvite for the dedicated checkers invite map.
function clearCheckersChallengeInvite(inviteId) {
  const inv = checkersChallengeInvites.get(inviteId);
  if (!inv) return;
  if (inv.expireTimer) clearTimeout(inv.expireTimer);
  checkersChallengeInvites.delete(inviteId);
}

function consumeBucket(map, key, burst, refillPerSecond) {
  const now = Date.now();
  const bucket = map.get(key) || { tokens: burst, lastRefill: now };
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(burst, bucket.tokens + elapsed * refillPerSecond);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) {
    map.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  map.set(key, bucket);
  return true;
}

function eloDelta(a, b, score) {
  const K = 32;
  const exp = 1 / (1 + Math.pow(10, (b - a) / 400));
  return Math.round(K * (score - exp));
}

// Single timeout sweep timer (lives for the server lifetime). Scans clocked
// games for a running side whose remaining time has hit zero even though they
// never sent a move, and flags them.
let timeoutSweepTimer = null;
function startTimeoutSweep(io) {
  if (timeoutSweepTimer) return;
  timeoutSweepTimer = setInterval(() => {
    const now = Date.now();
    // 1v1
    for (const game of activeGames.values()) {
      if (!game.clock || game._ended) continue;
      const clock = game.clock;
      const remaining = clock[clock.running] - (now - clock.turnStartedAt);
      if (remaining <= 0) {
        clock[clock.running] = 0;
        timeoutFinishGame(io, game, clock.running);
      }
    }
    // 2v2
    for (const tg of activeTeamGames.values()) {
      if (!tg.clock || tg._ended) continue;
      const clock = tg.clock;
      const remaining = clock[clock.running] - (now - clock.turnStartedAt);
      if (remaining <= 0) {
        clock[clock.running] = 0;
        timeoutFinishTeamGame(io, tg, clock.running);
      }
    }
  }, 1000);
  if (typeof timeoutSweepTimer.unref === 'function') timeoutSweepTimer.unref();
}

// Redis client for multi-instance mode (null in single-instance mode).
let scaleR = null;

// Backend-agnostic single-user read for the in-memory path's display/elo reads.
// SQLite stays synchronous via the resolved value; Postgres awaits the facade.
// (The proven SQLite path is unchanged — sqlite.getUserById is wrapped in an
// already-resolved promise, so existing behavior is byte-for-byte.)
function readUser(uid) {
  return store.usingPostgres ? store.getUserById(uid) : getUserById(uid);
}

export function attachSocketHandlers(io, verifyToken, redisClient = null) {
  ioRef = io; // expose io to notifyUser() for friend-request pushes
  scaleR = redisClient || null;
  startTimeoutSweep(io);            // covers in-memory games (1v1 single-instance + 2v2)
  if (scaleR) { scale.startSweep(io, scaleR); scaleTeam.startSweep(io, scaleR); } // redis-backed 1v1 + 2v2 sweeps
  // Arena pairing loop (single-instance only, like ranked bot-backfill). Inert
  // when arenas are disabled or under Redis scaling; failure-isolated per pass.
  if (!arenaPairTimer && arenaEnabled() && !scaleR) {
    arenaPairTimer = setInterval(() => { Promise.resolve(runArenaPairing(io)).catch(() => {}); }, ARENA_PAIR_INTERVAL_MS);
    if (typeof arenaPairTimer.unref === 'function') arenaPairTimer.unref();
  }
  io.on('connection', (socket) => {
    socket.on('auth', async ({ token }) => {
      // Flood/brute-force protection: cap failed auth attempts per socket.
      if (socket.data.authFails === undefined) socket.data.authFails = 0;
      if (socket.data.authFails >= 5) {
        socket.emit('auth_err', { error: 'Too many attempts' });
        socket.disconnect(true);
        return;
      }
      const payload = token ? verifyToken(token) : null;
      if (!payload) {
        socket.data.authFails += 1;
        socket.emit('auth_err', { error: 'Invalid token' });
        if (socket.data.authFails >= 5) { socket.emit('auth_err', { error: 'Too many attempts' }); socket.disconnect(true); }
        return;
      }
      const user = await readUser(payload.uid);
      if (!user) {
        socket.data.authFails += 1;
        socket.emit('auth_err', { error: 'User missing' });
        if (socket.data.authFails >= 5) { socket.emit('auth_err', { error: 'Too many attempts' }); socket.disconnect(true); }
        return;
      }
      socket.data.authFails = 0;
      socket.data.userId = user.id;
      userSocket.set(user.id, socket.id);
      socketUser.set(socket.id, user.id);
      store.markActive(user.id); // fire-and-forget activity ping for admin stats
      socket.emit('auth_ok', { user: publicUser(user) });

      // Multi-instance mode: delegate 1v1 presence + resume to the shared store.
      if (scaleR) { try { await scale.onAuth(io, scaleR, socket, user.id); } catch (e) { console.error('[scale] onAuth', e && e.message); } return; }

      // Resume an in-progress 1v1 game on (re)auth so a reconnecting client can
      // rejoin the room and resync board + clocks.
      const resumeId = userActiveGame.get(user.id);
      if (resumeId) {
        const game = activeGames.get(resumeId);
        if (game && !game._ended && (game.white === user.id || game.black === user.id)) {
          socket.join(resumeId);
          const yourColor = game.white === user.id ? 'w' : 'b';
          const opponent = game.white === user.id ? game.black : game.white;
          // If this reconnect clears a pending disconnect, cancel the grace timer.
          if (game.disconnectedUid === user.id) {
            if (game.disconnectTimer) clearTimeout(game.disconnectTimer);
            delete game.disconnectTimer;
            delete game.disconnectedUid;
            const oppSock = userSocket.get(opponent);
            if (oppSock) io.sockets.sockets.get(oppSock)?.emit('opponent_reconnected', { gameId: resumeId });
          }
          let clockSnap = null;
          if (game.clock) {
            clockSnap = { w: game.clock.w, b: game.clock.b, running: game.clock.running, serverNow: Date.now() };
          }
          // Bot games have a synthetic opponent with no users row — resolve each
          // seat to either the real user or the labeled bot public object.
          const seatPublic = async (uid) =>
            (game.isBot && uid === game.botUid)
              ? botPublicUser(game.botUid, game.botElo)
              : publicUser(await readUser(uid));
          socket.emit('game_state', {
            gameId: resumeId,
            fen: game.chess.fen(),
            mode: game.mode,
            yourColor,
            white: await seatPublic(game.white),
            black: await seatPublic(game.black),
            clock: clockSnap,
            isBot: !!game.isBot,
          });
          // If it became the bot's turn while the human was gone, nudge its reply.
          if (game.isBot) maybeBotReply(io, game);
        }
      }
    });

    // Skill-based matchmaking
    socket.on('mm_join', async ({ mode, tc }) => {
      const uid = socket.data.userId; if (!uid) return;
      // Ranked seasonal switch: reject ranked 1v1 matchmaking when ranked is off.
      // Casual random matchmaking (mode='casual') is unaffected.
      if (normalizeMode(mode) === 'ranked' && !rankedEnabled()) {
        socket.emit('mm_err', { error: RANKED_DISABLED_MSG });
        return;
      }
      if (!consumeBucket(mmBuckets, uid, 3, 0.2)) {
        socket.emit('rate_limited', { event: 'mm_join', retryInMs: 5000 });
        return;
      }
      if (scaleR) { try { await scale.joinQueue(io, scaleR, uid, { mode, tc }); } catch (e) { console.error('[scale] joinQueue', e && e.message); } return; }
      const user = await readUser(uid);
      const nMode = normalizeMode(mode);
      matchmakingQueue.set(uid, { socketId: socket.id, elo: user.elo, joinedAt: Date.now(), mode: nMode, tc: normalizeTc(tc) });
      tryMatchmake(io);
      // RANKED bot-backfill: if still unmatched after the window, start a bot game
      // (single-instance only; engine must have loaded). Casual is never backfilled.
      if (nMode === 'ranked' && botEngineReady()) scheduleBotBackfill(io, uid);
    });
    socket.on('mm_leave', async () => {
      const uid = socket.data.userId; if (!uid) return;
      if (scaleR) { try { await scale.leaveQueue(scaleR, uid); } catch (e) {} return; }
      matchmakingQueue.delete(uid);
      cancelBotBackfill(uid);
    });

    // --- Arena tournaments: join/leave the live arena's pairing pool ---
    socket.on('arena_join', async ({ arenaId } = {}) => {
      const uid = socket.data.userId; if (!uid) return;
      if (!arenaEnabled()) { socket.emit('arena_err', { error: 'Arenas are not enabled.' }); return; }
      if (scaleR) { socket.emit('arena_err', { error: 'Arenas are unavailable right now.' }); return; } // single-instance only
      if (!consumeBucket(mmBuckets, uid, 3, 0.2)) { socket.emit('rate_limited', { event: 'arena_join', retryInMs: 5000 }); return; }
      if (isUserInAnyGame(uid)) { socket.emit('arena_err', { error: 'Finish your current game first.' }); return; }
      try {
        const live = await liveArena();
        if (!live || (arenaId && arenaId !== live.id)) { socket.emit('arena_err', { error: 'No arena is live right now.' }); return; }
        const ok = await joinArena(live.id, uid, Date.now()); // ensure a scores row exists
        if (!ok) { socket.emit('arena_err', { error: 'This arena is not open to join.' }); return; }
        const user = await readUser(uid);
        arenaMembership.set(uid, live.id);
        arenaPool.set(uid, { socketId: socket.id, elo: (user && user.elo) || 1200, arenaId: live.id, joinedAt: Date.now() });
        socket.emit('arena_joined', { arenaId: live.id });
        runArenaPairing(io); // try to pair immediately
      } catch (e) {
        console.error('[arena] join failed', e && e.message);
        socket.emit('arena_err', { error: 'Could not join the arena.' });
      }
    });
    socket.on('arena_leave', () => {
      const uid = socket.data.userId; if (!uid) return;
      arenaPool.delete(uid);
      arenaMembership.delete(uid);
      socket.emit('arena_left', {});
    });

    // --- 2v2 team matchmaking ---
    socket.on('team_mm_join', async ({ inviteId, tc }) => {
      const uid = socket.data.userId; if (!uid) return;
      // 2v2 (solo queue + friend duo) is always ranked — gate it entirely when
      // ranked is off.
      if (!rankedEnabled()) {
        socket.emit('team_mm_err', { error: RANKED_DISABLED_MSG });
        return;
      }
      if (!consumeBucket(teamMmBuckets, uid, 3, 0.2)) {
        socket.emit('rate_limited', { event: 'team_mm_join', retryInMs: 5000 });
        return;
      }
      if (scaleR) { try { await scaleTeam.joinTeamQueue(io, scaleR, uid, { inviteId, tc }); } catch (e) { console.error('[scale] team_mm_join', e && e.message); } return; }
      const entryTc = normalizeTc(tc);
      // If user is already queued (solo or as part of a duo), ignore.
      if (findTeamQueueEntryByUid(uid)) return;
      const user = await readUser(uid);
      if (!user) return;
      if (inviteId) {
        // Joining as part of a friend-duo. inviteId must reference an accepted duo
        // (host has called team_mm_join first with that inviteId, queueing the duo entry).
        const invite = duoInvites.get(inviteId);
        if (!invite || !invite.accepted) {
          socket.emit('team_mm_err', { error: 'invite not ready' });
          return;
        }
        if (invite.hostId === uid) {
          // Host joining: create duo entry, wait for guest.
          const entry = {
            id: newTeamEntryId(),
            type: 'duo',
            inviteId,
            tc: entryTc,
            members: [{ uid: invite.hostId, socketId: socket.id, elo: ratingFor2v2(user) }],
            joinedAt: Date.now(),
          };
          teamQueue.set(entry.id, entry);
          invite.entryId = entry.id;
          socket.emit('team_mm_queued', { type: 'duo', size: 1, role: 'host' });
        } else if (invite.guestId === uid && invite.entryId) {
          // Guest joining the existing duo entry.
          const entry = teamQueue.get(invite.entryId);
          if (!entry) {
            socket.emit('team_mm_err', { error: 'duo entry gone' });
            return;
          }
          entry.members.push({ uid, socketId: socket.id, elo: ratingFor2v2(user) });
          // Notify both that the duo is fully queued.
          for (const m of entry.members) {
            const s = io.sockets.sockets.get(m.socketId);
            if (s) s.emit('team_mm_queued', { type: 'duo', size: 2, role: m.uid === invite.hostId ? 'host' : 'guest' });
          }
          tryTeamMatchmake(io);
        } else {
          socket.emit('team_mm_err', { error: 'not part of this invite' });
        }
      } else {
        // Solo queue.
        const entry = {
          id: newTeamEntryId(),
          type: 'solo',
          tc: entryTc,
          members: [{ uid, socketId: socket.id, elo: ratingFor2v2(user) }],
          joinedAt: Date.now(),
        };
        teamQueue.set(entry.id, entry);
        socket.emit('team_mm_queued', { type: 'solo', size: 1 });
        tryTeamMatchmake(io);
      }
    });

    socket.on('team_mm_leave', async () => {
      const uid = socket.data.userId; if (!uid) return;
      if (scaleR) { try { await scaleTeam.leaveTeamQueue(io, scaleR, uid); } catch (e) {} return; }
      removeUidFromTeamQueue(io, uid);
    });

    // Friend-duo invite lifecycle.
    socket.on('duo_invite', async ({ friendId }) => {
      const uid = socket.data.userId; if (!uid) return;
      if (scaleR) { try { await scaleTeam.duoInvite(io, scaleR, uid, friendId); } catch (e) { console.error('[scale] duo_invite', e && e.message); } return; }
      if (typeof friendId !== 'string' || friendId === uid) return;
      const friend = await readUser(friendId);
      if (!friend) { socket.emit('duo_err', { error: 'friend not found' }); return; }
      const friendSocketId = userSocket.get(friendId);
      if (!friendSocketId) { socket.emit('duo_err', { error: 'friend offline' }); return; }
      const inviteId = newDuoInviteId();
      const invite = {
        id: inviteId,
        hostId: uid,
        hostSocketId: socket.id,
        guestId: friendId,
        accepted: false,
        entryId: null,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      };
      duoInvites.set(inviteId, invite);
      const me = await readUser(uid);
      io.sockets.sockets.get(friendSocketId)?.emit('duo_invite_received', {
        inviteId,
        from: publicUser(me),
      });
      socket.emit('duo_invite_sent', { inviteId, to: publicUser(friend) });
      // Auto-expire.
      setTimeout(() => {
        const inv = duoInvites.get(inviteId);
        if (inv && !inv.accepted) {
          duoInvites.delete(inviteId);
          io.sockets.sockets.get(inv.hostSocketId)?.emit('duo_invite_expired', { inviteId });
          const guestSock = userSocket.get(inv.guestId);
          if (guestSock) io.sockets.sockets.get(guestSock)?.emit('duo_invite_expired', { inviteId });
        }
      }, 60_000);
    });

    socket.on('duo_accept', async ({ inviteId }) => {
      const uid = socket.data.userId; if (!uid) return;
      if (scaleR) { try { await scaleTeam.duoAccept(io, scaleR, uid, inviteId); } catch (e) {} return; }
      const invite = duoInvites.get(inviteId);
      if (!invite || invite.guestId !== uid) return;
      invite.accepted = true;
      // Tell host they can queue; both will then send team_mm_join with inviteId.
      io.sockets.sockets.get(invite.hostSocketId)?.emit('duo_accepted', {
        inviteId,
        partner: publicUser(await readUser(uid)),
      });
      socket.emit('duo_ready', { inviteId, partner: publicUser(await readUser(invite.hostId)) });
    });

    socket.on('duo_decline', async ({ inviteId }) => {
      const uid = socket.data.userId; if (!uid) return;
      if (scaleR) { try { await scaleTeam.duoDecline(io, scaleR, uid, inviteId); } catch (e) {} return; }
      const invite = duoInvites.get(inviteId);
      if (!invite || invite.guestId !== uid) return;
      duoInvites.delete(inviteId);
      io.sockets.sockets.get(invite.hostSocketId)?.emit('duo_declined', { inviteId });
    });

    socket.on('duo_cancel', async ({ inviteId }) => {
      const uid = socket.data.userId; if (!uid) return;
      if (scaleR) { try { await scaleTeam.duoCancel(io, scaleR, uid, inviteId); } catch (e) {} return; }
      const invite = duoInvites.get(inviteId);
      if (!invite || invite.hostId !== uid) return;
      duoInvites.delete(inviteId);
      // Also pull any partial queue entry for this duo.
      if (invite.entryId && teamQueue.has(invite.entryId)) teamQueue.delete(invite.entryId);
      const guestSock = userSocket.get(invite.guestId);
      if (guestSock) io.sockets.sockets.get(guestSock)?.emit('duo_cancelled', { inviteId });
    });

    // --- 1v1 FRIENDLY challenge lifecycle (ALWAYS unrated/casual) ----------
    // Mirrors the duo invite design but starts a normal 1v1 game (via the same
    // startGameWithColors machinery as matchmaking, so the existing `match_found`
    // in-game flow just works). INTEGRITY: the game mode is forced to 'casual'
    // here on the server — no client value can make a challenge ranked. Ranked
    // 1v1 remains random-matchmaking-only.
    socket.on('challenge_invite', async ({ friendId, tc, game, size, rules } = {}) => {
      const uid = socket.data.userId; if (!uid) return;
      // ADDITIVE checkers extension: if `game === 'checkers'` the invite starts a
      // CHECKERS game (always casual/unrated) on accept; otherwise the existing
      // chess challenge path is taken UNCHANGED.
      const isCheckers = game === 'checkers';
      if (isCheckers && !CT_Checkers) { socket.emit('challenge_err', { error: 'checkers unavailable' }); return; }
      if (typeof friendId !== 'string' || friendId === uid) {
        socket.emit('challenge_err', { error: 'invalid opponent' }); return;
      }
      const friend = await readUser(friendId);
      if (!friend) { socket.emit('challenge_err', { error: 'user not found' }); return; }
      // Must be confirmed friends (not just any user).
      if (!(await areFriends(uid, friendId))) { socket.emit('challenge_err', { error: 'not friends' }); return; }
      // Never pair players who have blocked each other (store.areBlocked checks
      // both directions).
      if (await store.areBlocked(uid, friendId)) { socket.emit('challenge_err', { error: 'unavailable' }); return; }
      // Invitee must be online (single-instance reachability).
      const friendSocketId = userSocket.get(friendId);
      if (!friendSocketId) { socket.emit('challenge_err', { error: 'friend offline' }); return; }
      // Neither side may be mid-game (chess OR checkers).
      if (isUserInAnyGame(uid)) { socket.emit('challenge_err', { error: 'you are in a game' }); return; }
      if (isUserInAnyGame(friendId)) { socket.emit('challenge_err', { error: 'friend is in a game' }); return; }
      const inviteTc = normalizeTc(tc);
      // Checkers params (only meaningful when isCheckers). Snapped to safe values.
      const ckSize = isCheckers ? normalizeCheckersSize(size) : null;
      const ckRules = isCheckers ? normalizeCheckersRules(rules, ckSize) : null;
      const inviteId = newChallengeInviteId();
      const me = await readUser(uid);
      const invite = {
        id: inviteId,
        fromId: uid,
        fromSocketId: socket.id,
        toId: friendId,
        tc: inviteTc,
        game: isCheckers ? 'checkers' : 'chess',
        ckSize, ckRules,
        createdAt: Date.now(),
        expiresAt: Date.now() + CHALLENGE_INVITE_TTL_MS,
        expireTimer: null,
      };
      challengeInvites.set(inviteId, invite);
      io.sockets.sockets.get(friendSocketId)?.emit('challenge_received', {
        inviteId,
        fromId: uid,
        fromName: me.username,
        fromElo: me.elo,
        tc: inviteTc,
        // Additive fields; absent/'chess' for the existing chess flow.
        game: invite.game, size: ckSize, rules: ckRules,
      });
      socket.emit('challenge_sent', { inviteId, toId: friendId, toName: friend.username, tc: inviteTc });
      // Auto-expire a stale invite (mirrors the duo invite TTL).
      invite.expireTimer = setTimeout(() => {
        if (!challengeInvites.has(inviteId)) return;
        challengeInvites.delete(inviteId);
        const fromSock = userSocket.get(invite.fromId);
        if (fromSock) io.sockets.sockets.get(fromSock)?.emit('challenge_expired', { inviteId });
        const toSock = userSocket.get(invite.toId);
        if (toSock) io.sockets.sockets.get(toSock)?.emit('challenge_expired', { inviteId });
      }, CHALLENGE_INVITE_TTL_MS);
      if (typeof invite.expireTimer.unref === 'function') invite.expireTimer.unref();
    });

    socket.on('challenge_accept', async ({ inviteId }) => {
      const uid = socket.data.userId; if (!uid) return;
      const invite = challengeInvites.get(inviteId);
      if (!invite || invite.toId !== uid) return;
      // Re-validate at accept time: both still online and neither mid-game.
      const fromSocketId = userSocket.get(invite.fromId);
      if (!fromSocketId) { clearChallengeInvite(inviteId); socket.emit('challenge_err', { error: 'challenger offline' }); return; }
      if (isUserInAnyGame(invite.fromId) || isUserInAnyGame(invite.toId)) {
        clearChallengeInvite(inviteId);
        socket.emit('challenge_err', { error: 'someone is already in a game' });
        return;
      }
      clearChallengeInvite(inviteId);
      try {
        if (invite.game === 'checkers') {
          // Friend checkers: ALWAYS casual / UNRATED (mode forced here on the
          // server). Emits checkers_match_found to both instead of chess match_found.
          await startCheckersGameWithColors(io,
            { uid: invite.fromId, socketId: fromSocketId },
            { uid: invite.toId, socketId: socket.id },
            { size: invite.ckSize, rules: invite.ckRules, mode: 'casual' });
        } else {
          await startChallengeGame(io, invite.fromId, fromSocketId, invite.toId, socket.id, invite.tc);
        }
      } catch (e) {
        console.error('[challenge] start failed', e && e.message);
        socket.emit('challenge_err', { error: 'could not start game' });
      }
    });

    socket.on('challenge_decline', async ({ inviteId }) => {
      const uid = socket.data.userId; if (!uid) return;
      const invite = challengeInvites.get(inviteId);
      if (!invite || invite.toId !== uid) return;
      clearChallengeInvite(inviteId);
      const fromSock = userSocket.get(invite.fromId);
      if (fromSock) io.sockets.sockets.get(fromSock)?.emit('challenge_declined', { inviteId });
    });

    socket.on('challenge_cancel', async ({ inviteId }) => {
      const uid = socket.data.userId; if (!uid) return;
      const invite = challengeInvites.get(inviteId);
      if (!invite || invite.fromId !== uid) return;
      clearChallengeInvite(inviteId);
      const toSock = userSocket.get(invite.toId);
      if (toSock) io.sockets.sockets.get(toSock)?.emit('challenge_cancelled', { inviteId });
    });

    // Game moves -- now dispatches to either 1v1 or 2v2 session.
    socket.on('move', async ({ gameId, from, to, promotion }) => {
      const uid = socket.data.userId;
      if (!uid) return;
      // 2v2 first (more specific check; 2v2 stays in-memory / single-instance)
      const tg = activeTeamGames.get(gameId);
      if (tg) { applyTeamMove(io, socket, tg, uid, { from, to, promotion }); return; }
      // Multi-instance mode -> shared Redis store (team game or 1v1).
      if (scaleR) {
        try {
          if (await scaleTeam.isTeamGame(scaleR, gameId)) await scaleTeam.handleTeamMove(io, scaleR, socket, uid, gameId, { from, to, promotion });
          else await scale.handleMove(io, scaleR, socket, uid, { gameId, from, to, promotion });
        } catch (e) { console.error('[scale] move', e && e.message); }
        return;
      }
      const game = activeGames.get(gameId); if (!game) return;
      const playerColor = game.white === uid ? 'w' : game.black === uid ? 'b' : null;
      if (!playerColor) return;
      if (game.chess.turn() !== playerColor) return;
      const move = game.chess.move({ from, to, promotion: promotion || 'q' });
      if (!move) { socket.emit('illegal_move', { gameId, from, to }); return; }
      // Server-authoritative clock: charge the mover's elapsed time.
      let clockPayload = null;
      if (game.clock) {
        const clock = game.clock;
        const elapsed = Date.now() - clock.turnStartedAt;
        clock[playerColor] -= elapsed;
        if (clock[playerColor] <= 0) {
          // Mover flagged: timeout loss (or draw if winner can't mate).
          clock[playerColor] = 0;
          timeoutFinishGame(io, game, playerColor);
          return;
        }
        clock[playerColor] += clock.incrementMs;
        clock.running = playerColor === 'w' ? 'b' : 'w';
        clock.turnStartedAt = Date.now();
        clockPayload = clockSnapshotForMove(clock);
      }
      io.to(gameId).emit('move_made', { gameId, move, fen: game.chess.fen(), clock: clockPayload });
      if (game.chess.isGameOver()) { finishGame(io, game); return; }
      // RANKED bot-backfill: after the human's move, let the engine bot reply
      // server-side (same flow, turn + clock respected).
      if (game.isBot) maybeBotReply(io, game);
    });

    socket.on('resign', async ({ gameId }) => {
      const uid = socket.data.userId;
      if (!uid) return;
      const tg = activeTeamGames.get(gameId);
      if (tg) {
        const myTeam = teamOfUid(tg, uid);
        if (!myTeam) return;
        finishTeamGame(io, tg, { reason: 'resignation', winnerColor: myTeam === 'w' ? 'b' : 'w' });
        return;
      }
      if (scaleR) {
        try {
          if (await scaleTeam.isTeamGame(scaleR, gameId)) await scaleTeam.handleTeamResign(io, scaleR, uid, gameId);
          else await scale.handleResign(io, scaleR, uid, gameId);
        } catch (e) { console.error('[scale] resign', e && e.message); }
        return;
      }
      const game = activeGames.get(gameId); if (!game) return;
      const winner = game.white === uid ? game.black : game.white;
      finishGame(io, game, { reason: 'resignation', winnerId: winner });
    });

    // =====================================================================
    // CHECKERS socket handlers (additive; do NOT touch the chess handlers).
    // =====================================================================
    // Skill-based checkers matchmaking. Queue is bucketed by (size, rules, mode)
    // and pairs by the matching checkers Elo within an expanding tolerance,
    // mirroring chess mm_join.
    socket.on('checkers_mm_join', async ({ mode, size, rules } = {}) => {
      const uid = socket.data.userId; if (!uid) return;
      if (!CT_Checkers) { socket.emit('checkers_err', { error: 'checkers unavailable' }); return; }
      // Ranked seasonal switch: reject ranked checkers matchmaking when ranked is
      // off. Casual checkers matchmaking (mode='casual') is unaffected.
      if (normalizeCheckersMode(mode) === 'ranked' && !rankedEnabled()) {
        socket.emit('checkers_err', { error: RANKED_DISABLED_MSG });
        return;
      }
      if (!consumeBucket(checkersMmBuckets, uid, 3, 0.2)) {
        socket.emit('rate_limited', { event: 'checkers_mm_join', retryInMs: 5000 });
        return;
      }
      if (isUserInAnyGame(uid)) { socket.emit('checkers_err', { error: 'already in a game' }); return; }
      const nSize = normalizeCheckersSize(size);
      const nRules = normalizeCheckersRules(rules, nSize);
      const nMode = normalizeCheckersMode(mode);
      const user = await readUser(uid);
      if (!user) return;
      checkersQueue.set(uid, {
        socketId: socket.id, elo: checkersEloOf(user, nSize), joinedAt: Date.now(),
        mode: nMode, size: nSize, rules: nRules,
      });
      tryCheckersMatchmake(io);
    });

    socket.on('checkers_mm_leave', () => {
      const uid = socket.data.userId; if (!uid) return;
      checkersQueue.delete(uid);
    });

    // Apply a checkers move. Server-authoritative: validate with the engine,
    // reject illegal moves, broadcast the applied move + serialized position.
    socket.on('checkers_move', ({ gameId, move } = {}) => {
      const uid = socket.data.userId; if (!uid) return;
      const cg = activeCheckersGames.get(gameId); if (!cg) return;
      const playerColor = cg.white === uid ? 'w' : cg.black === uid ? 'b' : null;
      if (!playerColor) return;
      if (cg.game.isGameOver()) return;
      if (cg.game.turn() !== playerColor) { socket.emit('checkers_err', { gameId, error: 'not your turn' }); return; }
      // The engine accepts a move object {from,to,...} or a notation string.
      const applied = cg.game.move(move);
      if (!applied) { socket.emit('checkers_err', { gameId, error: 'illegal move' }); return; }
      io.to(gameId).emit('checkers_move_made', {
        gameId, move: applied, position: cg.game.serialize(), turn: cg.game.turn(),
      });
      if (cg.game.isGameOver()) {
        const winnerColor = cg.game.winner(); // 'w' | 'b' | null (draw)
        const winnerId = winnerColor === 'w' ? cg.white : winnerColor === 'b' ? cg.black : null;
        finishCheckersGame(io, cg, { reason: cg.game.gameOverReason() || 'game-over', winnerId, winnerColor });
      }
    });

    socket.on('checkers_resign', ({ gameId } = {}) => {
      const uid = socket.data.userId; if (!uid) return;
      const cg = activeCheckersGames.get(gameId); if (!cg) return;
      const playerColor = cg.white === uid ? 'w' : cg.black === uid ? 'b' : null;
      if (!playerColor) return;
      const winnerId = cg.white === uid ? cg.black : cg.white;
      const winnerColor = cg.white === uid ? 'b' : 'w';
      finishCheckersGame(io, cg, { reason: 'resignation', winnerId, winnerColor });
    });

    // --- CHECKERS FRIENDLY challenge lifecycle (ALWAYS unrated/casual) -------
    // Dedicated to the client's `checkers_challenge_*` events. Mirrors the chess
    // `challenge_*` validation + bookkeeping exactly (friends, not blocked, online,
    // not double-booked across chess+checkers) but starts a CHECKERS game on accept
    // via startCheckersGameWithColors (mode 'casual' => UNRATED; it emits the
    // existing `checkers_match_found` to both players). INTEGRITY: the mode is
    // forced to 'casual' here on the server — no client value can make a checkers
    // challenge ranked. Ranked checkers stays matchmaking-only (`checkers_mm_*`).
    socket.on('checkers_challenge_invite', async ({ friendId, size, rules, tc } = {}) => {
      const uid = socket.data.userId; if (!uid) return;
      if (!CT_Checkers) { socket.emit('checkers_err', { error: 'checkers unavailable' }); return; }
      if (typeof friendId !== 'string' || friendId === uid) {
        socket.emit('checkers_err', { error: 'invalid opponent' }); return;
      }
      const friend = await readUser(friendId);
      if (!friend) { socket.emit('checkers_err', { error: 'user not found' }); return; }
      // Must be confirmed friends (reuses the same friendship check the chess
      // challenge uses).
      if (!(await areFriends(uid, friendId))) { socket.emit('checkers_err', { error: 'not friends' }); return; }
      // Never pair players who have blocked each other (both directions).
      if (await store.areBlocked(uid, friendId)) { socket.emit('checkers_err', { error: 'unavailable' }); return; }
      // Invitee must be online (single-instance reachability).
      const friendSocketId = userSocket.get(friendId);
      if (!friendSocketId) { socket.emit('checkers_err', { error: 'friend offline' }); return; }
      // Neither side may already be mid-game (chess 1v1/2v2 OR checkers).
      if (isUserInAnyGame(uid)) { socket.emit('checkers_err', { error: 'you are in a game' }); return; }
      if (isUserInAnyGame(friendId)) { socket.emit('checkers_err', { error: 'friend is in a game' }); return; }
      // Normalise size/rules the same way the ranked checkers path does (size in
      // {8,10}; rules snap to the official ruleset for the size, or 'casual').
      const ckSize = normalizeCheckersSize(size);
      const ckRules = normalizeCheckersRules(rules, ckSize);
      const inviteTc = normalizeTc(tc);
      const inviteId = newChallengeInviteId();
      const me = await readUser(uid);
      const invite = {
        id: inviteId,
        fromId: uid,
        fromSocketId: socket.id,
        toId: friendId,
        size: ckSize,
        rules: ckRules,
        tc: inviteTc,
        createdAt: Date.now(),
        expiresAt: Date.now() + CHALLENGE_INVITE_TTL_MS,
        expireTimer: null,
      };
      checkersChallengeInvites.set(inviteId, invite);
      io.sockets.sockets.get(friendSocketId)?.emit('checkers_challenge_received', {
        inviteId,
        fromId: uid,
        fromName: me.username,
        fromElo: checkersEloOf(me, ckSize), // inviter's checkers Elo for the chosen size
        size: ckSize,
        rules: ckRules,
      });
      socket.emit('checkers_challenge_sent', { inviteId, toId: friendId, toName: friend.username, size: ckSize, rules: ckRules });
      // Auto-expire a stale invite (mirrors the chess challenge invite TTL).
      invite.expireTimer = setTimeout(() => {
        if (!checkersChallengeInvites.has(inviteId)) return;
        checkersChallengeInvites.delete(inviteId);
        const fromSock = userSocket.get(invite.fromId);
        if (fromSock) io.sockets.sockets.get(fromSock)?.emit('checkers_challenge_cancelled', { inviteId });
        const toSock = userSocket.get(invite.toId);
        if (toSock) io.sockets.sockets.get(toSock)?.emit('checkers_challenge_cancelled', { inviteId });
      }, CHALLENGE_INVITE_TTL_MS);
      if (typeof invite.expireTimer.unref === 'function') invite.expireTimer.unref();
    });

    socket.on('checkers_challenge_accept', async ({ inviteId } = {}) => {
      const uid = socket.data.userId; if (!uid) return;
      const invite = checkersChallengeInvites.get(inviteId);
      if (!invite || invite.toId !== uid) return;
      // Re-validate at accept time: both still online and neither mid-game.
      const fromSocketId = userSocket.get(invite.fromId);
      if (!fromSocketId) { clearCheckersChallengeInvite(inviteId); socket.emit('checkers_err', { error: 'challenger offline' }); return; }
      if (isUserInAnyGame(invite.fromId) || isUserInAnyGame(invite.toId)) {
        clearCheckersChallengeInvite(inviteId);
        socket.emit('checkers_err', { error: 'someone is already in a game' });
        return;
      }
      clearCheckersChallengeInvite(inviteId); // consume the invite
      try {
        // Friend checkers: ALWAYS casual / UNRATED. Random colors. Emits the
        // existing `checkers_match_found` to both players.
        await startCheckersGameWithColors(io,
          { uid: invite.fromId, socketId: fromSocketId },
          { uid: invite.toId, socketId: socket.id },
          { size: invite.size, rules: invite.rules, mode: 'casual' });
      } catch (e) {
        console.error('[checkers-challenge] start failed', e && e.message);
        socket.emit('checkers_err', { error: 'could not start game' });
      }
    });

    socket.on('checkers_challenge_decline', ({ inviteId } = {}) => {
      const uid = socket.data.userId; if (!uid) return;
      const invite = checkersChallengeInvites.get(inviteId);
      if (!invite || invite.toId !== uid) return;
      clearCheckersChallengeInvite(inviteId);
      const fromSock = userSocket.get(invite.fromId);
      if (fromSock) io.sockets.sockets.get(fromSock)?.emit('checkers_challenge_declined', { inviteId });
    });

    socket.on('checkers_challenge_cancel', ({ inviteId } = {}) => {
      const uid = socket.data.userId; if (!uid) return;
      const invite = checkersChallengeInvites.get(inviteId);
      if (!invite || invite.fromId !== uid) return;
      clearCheckersChallengeInvite(inviteId);
      const toSock = userSocket.get(invite.toId);
      if (toSock) io.sockets.sockets.get(toSock)?.emit('checkers_challenge_cancelled', { inviteId });
    });

    // --- Rematch (1v1 only) ---
    socket.on('rematch_offer', async ({ gameId }) => {
      const uid = socket.data.userId; if (!uid) return;
      if (scaleR) { try { await scale.handleRematchOffer(io, scaleR, uid, gameId); } catch (e) { console.error('[scale] rematch_offer', e && e.message); } return; }
      const rg = recentGames.get(gameId);
      if (!rg) return;
      if (rg.whiteUid !== uid && rg.blackUid !== uid) return; // not a player
      const opponentUid = rg.whiteUid === uid ? rg.blackUid : rg.whiteUid;
      let offer = rematchOffers.get(gameId);
      if (!offer) {
        offer = { offers: new Set(), expireTimer: null };
        rematchOffers.set(gameId, offer);
      }
      // If the opponent already has a standing offer -> start the rematch now.
      if (offer.offers.has(opponentUid)) {
        Promise.resolve(startRematch(io, gameId)).catch((e) => console.error('[rematch] failed', e && e.message));
        return;
      }
      offer.offers.add(uid);
      // (Re)arm the auto-expire window.
      if (offer.expireTimer) clearTimeout(offer.expireTimer);
      offer.expireTimer = setTimeout(() => {
        rematchOffers.delete(gameId);
        const rg2 = recentGames.get(gameId);
        if (rg2) {
          for (const u of [rg2.whiteUid, rg2.blackUid]) {
            const s = userSocket.get(u);
            if (s) io.sockets.sockets.get(s)?.emit('rematch_expired', { gameId });
          }
        }
      }, REMATCH_OFFER_TTL_MS);
      if (typeof offer.expireTimer.unref === 'function') offer.expireTimer.unref();
      // Notify the opponent of the standing offer.
      const oppSock = userSocket.get(opponentUid);
      if (oppSock) io.sockets.sockets.get(oppSock)?.emit('rematch_offered', { gameId, from: publicUser(await readUser(uid)) });
    });

    socket.on('rematch_accept', async ({ gameId }) => {
      const uid = socket.data.userId; if (!uid) return;
      if (scaleR) { try { await scale.handleRematchAccept(io, scaleR, uid, gameId); } catch (e) { console.error('[scale] rematch_accept', e && e.message); } return; }
      const rg = recentGames.get(gameId);
      if (!rg) return;
      if (rg.whiteUid !== uid && rg.blackUid !== uid) return;
      const opponentUid = rg.whiteUid === uid ? rg.blackUid : rg.whiteUid;
      const offer = rematchOffers.get(gameId);
      // Accept only makes sense if the opponent has a standing offer.
      if (!offer || !offer.offers.has(opponentUid)) {
        // Treat a bare accept like an offer so the flow still completes.
        let o = rematchOffers.get(gameId);
        if (!o) { o = { offers: new Set(), expireTimer: null }; rematchOffers.set(gameId, o); }
        o.offers.add(uid);
        return;
      }
      Promise.resolve(startRematch(io, gameId)).catch((e) => console.error('[rematch] failed', e && e.message));
    });

    socket.on('rematch_decline', async ({ gameId }) => {
      const uid = socket.data.userId; if (!uid) return;
      if (scaleR) { try { await scale.handleRematchDecline(io, scaleR, uid, gameId); } catch (e) { console.error('[scale] rematch_decline', e && e.message); } return; }
      const rg = recentGames.get(gameId);
      if (!rg) return;
      if (rg.whiteUid !== uid && rg.blackUid !== uid) return;
      const offererUid = rg.whiteUid === uid ? rg.blackUid : rg.whiteUid;
      clearRematchOffer(gameId);
      const offSock = userSocket.get(offererUid);
      if (offSock) io.sockets.sockets.get(offSock)?.emit('rematch_declined', { gameId });
    });

    socket.on('chat', ({ gameId, text }) => {
      const uid = socket.data.userId; if (!uid) return;
      if (!consumeBucket(chatBuckets, uid, 5, 1)) {
        socket.emit('rate_limited', { event: 'chat', retryInMs: 1000 });
        return;
      }
      const game = activeGames.get(gameId); if (!game) return;
      if (typeof text !== 'string' || text.length > 200) return;
      const cleanText = text.replace(/[\u0000-\u001F\u007F<>]/g, '');
      io.to(gameId).emit('chat', {
        from: uid,
        text: cleanText,
        at: Date.now()
      });
    });

    socket.on('disconnect', async () => {
      const uid = socketUser.get(socket.id);
      if (uid) {
        matchmakingQueue.delete(uid);
        cancelBotBackfill(uid); // stop any pending ranked bot-backfill for this user
        arenaPool.delete(uid);       // drop from the arena pairing pool
        arenaMembership.delete(uid); // and forget arena membership (no re-pool)
        checkersQueue.delete(uid); // additive: drop from checkers MM queue too
        userSocket.delete(uid);
        socketUser.delete(socket.id);
        removeUidFromTeamQueue(io, uid);
        // Plug slow leaks: drop this user's token-bucket entries.
        mmBuckets.delete(uid);
        chatBuckets.delete(uid);
        teamMmBuckets.delete(uid);
        checkersMmBuckets.delete(uid);
        // Checkers: forfeit any active checkers game (opponent wins). Single-
        // instance, immediate forfeit (no reconnect grace for checkers yet).
        const ckId = userActiveCheckersGame.get(uid);
        if (ckId) {
          const cg = activeCheckersGames.get(ckId);
          if (cg && !cg._ended) {
            const winnerId = cg.white === uid ? cg.black : cg.white;
            const winnerColor = cg.white === uid ? 'b' : 'w';
            finishCheckersGame(io, cg, { reason: 'disconnect', winnerId, winnerColor });
          }
        }
        // Cancel any pending duo invites this user hosts or is invited to.
        for (const [iid, inv] of duoInvites) {
          if (inv.hostId === uid || inv.guestId === uid) {
            duoInvites.delete(iid);
            const other = inv.hostId === uid ? inv.guestId : inv.hostId;
            const otherSock = userSocket.get(other);
            if (otherSock) io.sockets.sockets.get(otherSock)?.emit('duo_cancelled', { inviteId: iid });
          }
        }
        // Cancel any pending 1v1 challenge invites this user sent or received.
        for (const [iid, inv] of challengeInvites) {
          if (inv.fromId === uid || inv.toId === uid) {
            clearChallengeInvite(iid);
            const other = inv.fromId === uid ? inv.toId : inv.fromId;
            const otherSock = userSocket.get(other);
            if (otherSock) io.sockets.sockets.get(otherSock)?.emit('challenge_cancelled', { inviteId: iid });
          }
        }
        // Cancel any pending CHECKERS challenge invites this user sent or received.
        for (const [iid, inv] of checkersChallengeInvites) {
          if (inv.fromId === uid || inv.toId === uid) {
            clearCheckersChallengeInvite(iid);
            const other = inv.fromId === uid ? inv.toId : inv.fromId;
            const otherSock = userSocket.get(other);
            if (otherSock) io.sockets.sockets.get(otherSock)?.emit('checkers_challenge_cancelled', { inviteId: iid });
          }
        }
        // Clear any pending rematch offers involving this user; notify the other side.
        for (const [gid, offer] of rematchOffers) {
          const rg = recentGames.get(gid);
          if (!rg) { clearRematchOffer(gid); continue; }
          if (rg.whiteUid !== uid && rg.blackUid !== uid) continue;
          const otherUid = rg.whiteUid === uid ? rg.blackUid : rg.whiteUid;
          const hadOwnOffer = offer.offers.has(uid);
          clearRematchOffer(gid);
          const otherSock = userSocket.get(otherUid);
          if (otherSock) {
            // If THIS user was the offerer, the other side sees a decline; else expire.
            io.sockets.sockets.get(otherSock)?.emit(hadOwnOffer ? 'rematch_declined' : 'rematch_expired', { gameId: gid });
          }
        }
        // 1v1 disconnect (multi-instance mode -> shared store; immediate forfeit
        // for now, grace/reconnect across instances lands in the next increment).
        if (scaleR) {
          try { await scale.onDisconnect(io, scaleR, uid); await scaleTeam.onTeamDisconnect(io, scaleR, uid); } catch (e) { console.error('[scale] disconnect', e && e.message); }
        } else {
          // Single-instance: 30s grace window instead of an immediate forfeit.
          // The clock KEEPS running; the timeout sweep may still flag the player.
          const oneVOneId = userActiveGame.get(uid);
          if (oneVOneId) {
            const game = activeGames.get(oneVOneId);
            if (game && !game._ended) {
            const opponent = game.white === uid ? game.black : game.white;
            game.disconnectedUid = uid;
            if (game.disconnectTimer) clearTimeout(game.disconnectTimer);
            game.disconnectTimer = setTimeout(() => {
              // Only forfeit if the game is still live and the uid is still marked
              // disconnected (i.e. they never reconnected). The _ended guard makes
              // this safe against a racing timeout/checkmate finish.
              if (!game._ended && game.disconnectedUid === uid) {
                finishGame(io, game, { reason: 'disconnect', winnerId: opponent });
              }
            }, DISCONNECT_GRACE_MS);
            if (typeof game.disconnectTimer.unref === 'function') game.disconnectTimer.unref();
            const oppSock = userSocket.get(opponent);
            if (oppSock) io.sockets.sockets.get(oppSock)?.emit('opponent_disconnected', { gameId: oneVOneId, graceMs: DISCONNECT_GRACE_MS });
            }
          }
        }
        // Abort an active team game the user is in (other side wins by forfeit).
        const gid = userActiveTeamGame.get(uid);
        if (gid) {
          const tg = activeTeamGames.get(gid);
          if (tg) {
            const myTeam = teamOfUid(tg, uid);
            if (myTeam) finishTeamGame(io, tg, { reason: 'disconnect', winnerColor: myTeam === 'w' ? 'b' : 'w' });
          }
        }
      }
    });
  });
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, elo: u.elo, wins: u.wins, losses: u.losses,
    isPremium: !!u.is_premium,
    avatarStock: u.avatar_stock || 'av_knight',
    avatarDataUrl: u.avatar_data_url || '',
    // Checkers ratings (additive; chess `elo` above is unchanged).
    eloCheckers8: u.elo_checkers_8 ?? 1200,
    eloCheckers10: u.elo_checkers_10 ?? 1200,
  };
}

function tryMatchmake(io) {
  // SQLite: keep the proven synchronous matchmaking sweep byte-for-byte (the
  // areBlocked check runs inside .find()). Postgres needs awaited areBlocked, so
  // it uses the async variant below — branch, don't force one path.
  if (store.usingPostgres) {
    tryMatchmakePg(io).catch((e) => console.error('[tryMatchmake] pg failed', e && e.message));
    return;
  }
  const players = Array.from(matchmakingQueue.entries())
    .map(([uid, info]) => ({ uid, ...info }))
    .sort((a, b) => a.joinedAt - b.joinedAt);
  for (const a of players) {
    if (!matchmakingQueue.has(a.uid)) continue;
    const tolerance = Math.min(500, 50 + Math.floor((Date.now() - a.joinedAt) / 1000) * 25);
    const match = players.find((b) =>
      b.uid !== a.uid && matchmakingQueue.has(b.uid) &&
      Math.abs(a.elo - b.elo) <= tolerance &&
      a.mode === b.mode &&
      a.tc === b.tc &&
      !areBlocked(a.uid, b.uid) // never pair players who have blocked each other
    );
    if (match) {
      matchmakingQueue.delete(a.uid);
      matchmakingQueue.delete(match.uid);
      cancelBotBackfill(a.uid);
      cancelBotBackfill(match.uid);
      startGame(io, a, match);
    }
  }
}

// Postgres matchmaking: same FIFO/tolerance logic, but the block check is awaited
// (hoisted out of the .find() predicate, which can't be async).
async function tryMatchmakePg(io) {
  const players = Array.from(matchmakingQueue.entries())
    .map(([uid, info]) => ({ uid, ...info }))
    .sort((a, b) => a.joinedAt - b.joinedAt);
  for (const a of players) {
    if (!matchmakingQueue.has(a.uid)) continue;
    const tolerance = Math.min(500, 50 + Math.floor((Date.now() - a.joinedAt) / 1000) * 25);
    let match = null;
    for (const b of players) {
      if (b.uid === a.uid || !matchmakingQueue.has(b.uid)) continue;
      if (Math.abs(a.elo - b.elo) > tolerance || a.mode !== b.mode || a.tc !== b.tc) continue;
      if (await store.areBlocked(a.uid, b.uid)) continue; // never pair blocked players
      match = b; break;
    }
    if (match) {
      matchmakingQueue.delete(a.uid);
      matchmakingQueue.delete(match.uid);
      cancelBotBackfill(a.uid);
      cancelBotBackfill(match.uid);
      startGame(io, a, match);
    }
  }
}

function startGame(io, a, b) {
  const [white, black] = Math.random() < 0.5 ? [a, b] : [b, a];
  // Fire-and-forget: startGameWithColors is async only to await PG reads; any
  // failure is logged rather than surfaced to the (sync) matchmaking caller.
  Promise.resolve(startGameWithColors(io, white, black)).catch((e) =>
    console.error('[startGame] failed', e && e.message));
}

// Color-forced game start: `white`/`black` are {uid, socketId, elo, mode, tc}.
// Used by the rematch path (to swap colors deterministically) and by startGame
// (after it has randomized which entry is white).
async function startGameWithColors(io, white, black, opts = {}) {
  const a = white; // keep `a` for tc/mode reads below (matches old startGame)
  const gameId = newGameId();
  const chess = new Chess();
  const tc = normalizeTc(a.tc);
  const parsed = parseTc(tc);
  const clock = makeClock(parsed);
  // Read both players. Branch on backend: sync SQLite (unchanged) vs awaited
  // facade reads on Postgres so eloBefore is read from the scalable store.
  let whiteUser, blackUser;
  if (store.usingPostgres) {
    whiteUser = await store.getUserById(white.uid);
    blackUser = await store.getUserById(black.uid);
  } else {
    whiteUser = getUserById(white.uid);
    blackUser = getUserById(black.uid);
  }
  const game = {
    id: gameId,
    white: white.uid,
    black: black.uid,
    chess,
    // opts.mode bypasses normalizeMode for server-created games whose mode the
    // client can't supply (e.g. 'arena'); normal matchmaking passes no opts and
    // keeps the security property that an unknown client mode folds to 'ranked'.
    mode: opts.mode || normalizeMode(a.mode),
    started: Date.now(),
    tc,
    clock,
    whiteEloBefore: whiteUser.elo,
    blackEloBefore: blackUser.elo,
  };
  if (opts.arenaId) game.arenaId = opts.arenaId; // arena games carry their event id
  activeGames.set(gameId, game);
  userActiveGame.set(white.uid, gameId);
  userActiveGame.set(black.uid, gameId);
  const wSock = io.sockets.sockets.get(white.socketId);
  const bSock = io.sockets.sockets.get(black.socketId);
  if (wSock) wSock.join(gameId);
  if (bSock) bSock.join(gameId);
  io.to(gameId).emit('match_found', {
    gameId,
    white: publicUser(whiteUser),
    black: publicUser(blackUser),
    mode: game.mode,
    tc,
    clock: clockSnapshotForStart(clock, parsed),
  });
}

// Start an online FRIENDLY 1v1 from a challenge invite. ALWAYS unrated: mode is
// forced to 'casual' here (NOT from any client value), so finishGame's ELO path
// (ranked-only) never touches ratings for these games — preserving ranked
// integrity. Colors are randomized; both players get the SAME `match_found`
// payload shape matchmaking sends, so the normal in-game flow just works.
async function startChallengeGame(io, fromId, fromSocketId, toId, toSocketId, tc) {
  const a = { uid: fromId, socketId: fromSocketId, elo: 0, mode: 'casual', tc };
  const b = { uid: toId, socketId: toSocketId, elo: 0, mode: 'casual', tc };
  const [white, black] = Math.random() < 0.5 ? [a, b] : [b, a];
  await startGameWithColors(io, white, black);
}

// ===========================================================================
// RANKED BOT-BACKFILL (server-authoritative engine opponent)
// ===========================================================================
// A bot game reuses the normal `activeGames` move loop. One seat is a synthetic
// bot (uid starts with 'bot_'), marked on the game object as `isBot` with `botUid`
// and `botColor`. After each HUMAN move, the server asks bot.js for the bot's
// reply and applies it through the SAME chess engine (turn + clock respected),
// then broadcasts move_made. ELO + persistence go through finishGame, which is
// bot-aware: only the human's rating/stats move (vs the bot's elo, which equals
// the human's rating at match time), and the games row records the bot side.

// Build a publicUser-shaped object for the labeled bot so the existing client
// opponent display renders "Computer 🤖 (ELO N)" with NO app.js change. isBot lets
// any bot-aware UI show a clearer badge.
function botPublicUser(botUid, elo) {
  return {
    id: botUid,
    username: BOT_DISPLAY_NAME,
    elo,
    wins: 0,
    losses: 0,
    isBot: true,
    isPremium: false,
    avatarStock: 'av_bot',
    avatarDataUrl: '',
    eloCheckers8: 1200,
    eloCheckers10: 1200,
  };
}

function cancelBotBackfill(uid) {
  const t = botBackfillTimers.get(uid);
  if (t) { clearTimeout(t); botBackfillTimers.delete(uid); }
}

// Arm a one-shot timer; on fire, if the user is STILL queued ranked (no human
// match), start a bot game at the user's current rating.
function scheduleBotBackfill(io, uid) {
  cancelBotBackfill(uid);
  const timer = setTimeout(() => {
    botBackfillTimers.delete(uid);
    Promise.resolve(maybeStartBotGame(io, uid)).catch((e) =>
      console.error('[bot-backfill] start failed', e && e.message));
  }, BOT_BACKFILL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  botBackfillTimers.set(uid, timer);
}

// Start a ranked bot game for `uid` IF they are still queued ranked and idle.
async function maybeStartBotGame(io, uid) {
  if (scaleR) return;                    // single-instance only
  if (!botEngineReady()) return;
  const q = matchmakingQueue.get(uid);
  if (!q || q.mode !== 'ranked') return; // matched/left already, or not ranked
  if (isUserInAnyGame(uid)) return;
  const sock = io.sockets.sockets.get(q.socketId);
  if (!sock) { matchmakingQueue.delete(uid); return; }
  // Consume the queue entry now so a racing tryMatchmake can't also pair them.
  matchmakingQueue.delete(uid);
  await startBotGame(io, { uid, socketId: q.socketId, tc: q.tc });
}

// Create a ranked 1v1 game where one seat is the engine bot. Colors random; the
// bot plays at the human's CURRENT rating (fair => ELO-neutral in expectation).
async function startBotGame(io, human, opts = {}) {
  const user = await readUser(human.uid);
  if (!user) return;
  const botMode = opts.mode || 'ranked'; // 'arena' for arena bot games
  const humanElo = Number.isFinite(user.elo) ? user.elo : 1200;
  const botUid = newBotUid();
  const gameId = newGameId();
  const chess = new Chess();
  const tc = normalizeTc(human.tc);
  const parsed = parseTc(tc);
  const clock = makeClock(parsed);
  const humanIsWhite = Math.random() < 0.5;
  const whiteUid = humanIsWhite ? human.uid : botUid;
  const blackUid = humanIsWhite ? botUid : human.uid;
  const botColor = humanIsWhite ? 'b' : 'w';
  const humanPublic = publicUser(user);
  const botPublic = botPublicUser(botUid, humanElo);
  const game = {
    id: gameId,
    white: whiteUid,
    black: blackUid,
    chess,
    mode: botMode,
    started: Date.now(),
    tc,
    clock,
    // Bot bookkeeping: which seat is the bot, its rating, and the human uid.
    isBot: true,
    botUid,
    botColor,
    botElo: humanElo,
    humanUid: human.uid,
    // eloBefore snapshot — only the human side is persisted/applied, but record
    // both so the games row is well-formed.
    whiteEloBefore: humanIsWhite ? humanElo : humanElo,
    blackEloBefore: humanIsWhite ? humanElo : humanElo,
  };
  if (opts.arenaId) game.arenaId = opts.arenaId; // arena bot games carry the event id
  activeGames.set(gameId, game);
  userActiveGame.set(human.uid, gameId);
  const sock = io.sockets.sockets.get(human.socketId);
  if (sock) sock.join(gameId);
  // Only the human is in the room; emit the labeled bot as the opponent.
  io.to(gameId).emit('match_found', {
    gameId,
    white: humanIsWhite ? humanPublic : botPublic,
    black: humanIsWhite ? botPublic : humanPublic,
    mode: botMode,
    tc,
    clock: clockSnapshotForStart(clock, parsed),
    // Top-level bot hint (additive; ignored by the existing display which reads
    // white/black). isBot also rides on the bot's white/black object above.
    isBot: true,
    botColor,
  });
  // If the bot is White, it moves first — kick off its opening reply.
  if (botColor === 'w') maybeBotReply(io, game);
}

// If it's the bot's turn in a bot game, compute + apply + broadcast its move.
// Server-authoritative: the move goes through the SAME chess engine, charges the
// bot's clock, and ends the game via finishGame on game-over. Never throws.
async function maybeBotReply(io, game) {
  try {
    if (!game || !game.isBot || game._ended) return;
    if (game.chess.turn() !== game.botColor) return;
    if (game.chess.isGameOver()) { finishGame(io, game); return; }
    const fen = game.chess.fen();
    const reply = await botMove(fen, game.botElo);
    // Re-check the game is still live + still the bot's turn (a human resign /
    // timeout / disconnect could have ended it while we computed).
    if (!game || game._ended || !activeGames.has(game.id)) return;
    if (game.chess.turn() !== game.botColor) return;
    let move = null;
    if (reply) move = game.chess.move({ from: reply.from, to: reply.to, promotion: reply.promotion || 'q' });
    // Engine returned null or an illegal move — fall back to any legal move so the
    // game never stalls on the bot's turn.
    if (!move) {
      const legal = game.chess.moves({ verbose: true });
      if (legal.length) move = game.chess.move(legal[0]);
    }
    if (!move) { finishGame(io, game); return; } // no legal move => game over
    // Charge the bot's clock exactly like a human mover.
    let clockPayload = null;
    if (game.clock) {
      const clock = game.clock;
      const elapsed = Date.now() - clock.turnStartedAt;
      clock[game.botColor] -= elapsed;
      if (clock[game.botColor] <= 0) {
        clock[game.botColor] = 0;
        timeoutFinishGame(io, game, game.botColor);
        return;
      }
      clock[game.botColor] += clock.incrementMs;
      clock.running = game.botColor === 'w' ? 'b' : 'w';
      clock.turnStartedAt = Date.now();
      clockPayload = clockSnapshotForMove(clock);
    }
    io.to(game.id).emit('move_made', { gameId: game.id, move, fen: game.chess.fen(), clock: clockPayload });
    if (game.chess.isGameOver()) finishGame(io, game);
  } catch (e) {
    console.error('[bot-reply] failed', e && e.message);
  }
}

// ===========================================================================
// ARENA pairing (realtime) — Layer 2 of ARENA_DESIGN.md
// ===========================================================================
// Continuously pair the arena waiting pool into mode:'arena' games, bot-backfill
// anyone who waits too long, and re-pool players when their arena game ends.
// Single-instance only (gated on !scaleR, like ranked bot-backfill). Every entry
// point is failure-isolated — an arena error can never disturb ranked/casual.
const ARENA_PAIR_INTERVAL_MS = Number(process.env.ARENA_PAIR_INTERVAL_MS) || 2000;

// Re-add a player to the pool after their arena game ends, IF the arena is still
// live, they're still connected, and they haven't left. Called from the finish
// hooks. Failure-isolated.
async function requeueArena(io, uid) {
  try {
    const arenaId = arenaMembership.get(uid);
    if (!arenaId) return;
    const socketId = userSocket.get(uid);
    const sock = socketId && io.sockets.sockets.get(socketId);
    if (!sock) { arenaMembership.delete(uid); return; }
    if (isUserInAnyGame(uid)) return; // still finishing another game; that hook will re-pool
    const live = await liveArena().catch(() => null);
    if (!live || live.id !== arenaId) { arenaMembership.delete(uid); return; } // arena ended
    // readUser is sync on SQLite / async on Postgres — normalize before awaiting.
    const user = await Promise.resolve(readUser(uid)).catch(() => null);
    arenaPool.set(uid, { socketId, elo: (user && user.elo) || 1200, arenaId, joinedAt: Date.now() });
  } catch (e) { console.error('[arena] requeue failed', e && e.message); }
}

// One pairing pass over the arena pool. Pairs closest-elo waiters, bot-backfills
// anyone past the wait threshold. Never throws.
async function runArenaPairing(io) {
  try {
    if (!arenaEnabled() || scaleR || arenaPool.size === 0) return;
    const live = await liveArena().catch(() => null);
    if (!live) { arenaPool.clear(); return; } // no live arena: nobody to pair
    const waiting = [];
    for (const [uid, e] of [...arenaPool]) {
      if (e.arenaId !== live.id) { arenaPool.delete(uid); continue; }   // stale (prior arena)
      if (isUserInAnyGame(uid)) continue;                               // already playing
      const socketId = userSocket.get(uid) || e.socketId;
      const sock = io.sockets.sockets.get(socketId);
      if (!sock) { arenaPool.delete(uid); arenaMembership.delete(uid); continue; } // disconnected
      waiting.push({ uid, socketId, elo: e.elo, joinedAt: e.joinedAt });
    }
    if (waiting.length === 0) return;
    waiting.sort((x, y) => x.joinedAt - y.joinedAt);
    const used = new Set();
    for (let i = 0; i < waiting.length; i++) {
      if (used.has(waiting[i].uid)) continue;
      let best = -1, bestD = Infinity;
      for (let j = i + 1; j < waiting.length; j++) {
        if (used.has(waiting[j].uid)) continue;
        const d = Math.abs(waiting[i].elo - waiting[j].elo);
        if (d < bestD) { bestD = d; best = j; }
      }
      if (best === -1) continue;
      const A = waiting[i], B = waiting[best];
      used.add(A.uid); used.add(B.uid);
      arenaPool.delete(A.uid); arenaPool.delete(B.uid);
      startArenaPair(io, A, B, live);
    }
    // Bot-backfill leftover singles who've waited long enough.
    if (botEngineReady()) {
      const now = Date.now();
      for (const w of waiting) {
        if (used.has(w.uid)) continue;
        if (now - w.joinedAt < ARENA_BOT_WAIT_MS) continue;
        used.add(w.uid);
        arenaPool.delete(w.uid);
        startArenaBotGame(io, w, live);
      }
    }
  } catch (e) { console.error('[arena] pairing pass failed', e && e.message); }
}

// Start a human-vs-human arena game (mode:'arena', stamped with the arena id).
function startArenaPair(io, A, B, live) {
  try {
    const a = { uid: A.uid, socketId: A.socketId, elo: A.elo, mode: 'arena', tc: live.tc };
    const b = { uid: B.uid, socketId: B.socketId, elo: B.elo, mode: 'arena', tc: live.tc };
    const [white, black] = Math.random() < 0.5 ? [a, b] : [b, a];
    Promise.resolve(startGameWithColors(io, white, black, { mode: 'arena', arenaId: live.id }))
      .catch((e) => { console.error('[arena] pair start failed', e && e.message); requeueArena(io, A.uid); requeueArena(io, B.uid); });
  } catch (e) { console.error('[arena] startArenaPair failed', e && e.message); }
}

// Start an arena game vs the engine bot (reuses startBotGame with arena opts).
function startArenaBotGame(io, w, live) {
  try {
    Promise.resolve(startBotGame(io, { uid: w.uid, socketId: w.socketId, tc: live.tc }, { mode: 'arena', arenaId: live.id }))
      .catch((e) => { console.error('[arena] bot game failed', e && e.message); requeueArena(io, w.uid); });
  } catch (e) { console.error('[arena] startArenaBotGame failed', e && e.message); }
}

// ===========================================================================
// CHECKERS lifecycle helpers (additive; parallel to the chess functions above)
// ===========================================================================

// FIFO matchmaking over the checkers queue, bucketed by (size,rules,mode) and
// paired by the matching checkers Elo within an expanding tolerance — mirrors
// chess tryMatchmake. Block checks honour store.areBlocked on both backends.
function tryCheckersMatchmake(io) {
  if (store.usingPostgres) {
    tryCheckersMatchmakePg(io).catch((e) => console.error('[tryCheckersMatchmake] pg failed', e && e.message));
    return;
  }
  const players = Array.from(checkersQueue.entries())
    .map(([uid, info]) => ({ uid, ...info }))
    .sort((a, b) => a.joinedAt - b.joinedAt);
  for (const a of players) {
    if (!checkersQueue.has(a.uid)) continue;
    const tolerance = Math.min(500, 50 + Math.floor((Date.now() - a.joinedAt) / 1000) * 25);
    const match = players.find((b) =>
      b.uid !== a.uid && checkersQueue.has(b.uid) &&
      Math.abs(a.elo - b.elo) <= tolerance &&
      a.mode === b.mode && a.size === b.size && a.rules === b.rules &&
      !areBlocked(a.uid, b.uid));
    if (match) {
      checkersQueue.delete(a.uid);
      checkersQueue.delete(match.uid);
      startCheckersGame(io, a, match);
    }
  }
}

async function tryCheckersMatchmakePg(io) {
  const players = Array.from(checkersQueue.entries())
    .map(([uid, info]) => ({ uid, ...info }))
    .sort((a, b) => a.joinedAt - b.joinedAt);
  for (const a of players) {
    if (!checkersQueue.has(a.uid)) continue;
    const tolerance = Math.min(500, 50 + Math.floor((Date.now() - a.joinedAt) / 1000) * 25);
    let match = null;
    for (const b of players) {
      if (b.uid === a.uid || !checkersQueue.has(b.uid)) continue;
      if (Math.abs(a.elo - b.elo) > tolerance || a.mode !== b.mode || a.size !== b.size || a.rules !== b.rules) continue;
      if (await store.areBlocked(a.uid, b.uid)) continue;
      match = b; break;
    }
    if (match) {
      checkersQueue.delete(a.uid);
      checkersQueue.delete(match.uid);
      startCheckersGame(io, a, match);
    }
  }
}

// Randomise colors then delegate to the color-forced start.
function startCheckersGame(io, a, b) {
  const [white, black] = Math.random() < 0.5 ? [a, b] : [b, a];
  Promise.resolve(startCheckersGameWithColors(io, white, black,
    { size: a.size, rules: a.rules, mode: a.mode })).catch((e) =>
    console.error('[startCheckersGame] failed', e && e.message));
}

// Color-forced checkers start. `white`/`black` are { uid, socketId }. opts holds
// { size, rules, mode }. mode 'casual' => UNRATED (no Elo change at finish).
async function startCheckersGameWithColors(io, white, black, opts) {
  const size = normalizeCheckersSize(opts.size);
  const rules = normalizeCheckersRules(opts.rules, size);
  const mode = normalizeCheckersMode(opts.mode);
  const gameId = newCheckersGameId();
  const game = CT_Checkers.create({ size, rules });
  // Read both players (sync SQLite / awaited Postgres) for opponent payload + the
  // before-Elo snapshot used by the ranked finish path.
  let whiteUser, blackUser;
  if (store.usingPostgres) {
    whiteUser = await store.getUserById(white.uid);
    blackUser = await store.getUserById(black.uid);
  } else {
    whiteUser = getUserById(white.uid);
    blackUser = getUserById(black.uid);
  }
  if (!whiteUser || !blackUser) return;
  const cg = {
    id: gameId,
    white: white.uid,
    black: black.uid,
    game,
    mode,
    rated: mode === 'ranked',
    size,
    rules,
    started: Date.now(),
    whiteEloBefore: checkersEloOf(whiteUser, size),
    blackEloBefore: checkersEloOf(blackUser, size),
  };
  activeCheckersGames.set(gameId, cg);
  userActiveCheckersGame.set(white.uid, gameId);
  userActiveCheckersGame.set(black.uid, gameId);
  const wSock = io.sockets.sockets.get(white.socketId);
  const bSock = io.sockets.sockets.get(black.socketId);
  if (wSock) wSock.join(gameId);
  if (bSock) bSock.join(gameId);
  const position = game.serialize();
  // Per-socket emit so each player learns their OWN color + the opponent's info.
  if (wSock) wSock.emit('checkers_match_found', {
    gameId, color: 'w', size, rules, mode, position,
    opponent: {
      username: blackUser.username, elo: checkersEloOf(blackUser, size),
      avatarStock: blackUser.avatar_stock || 'av_knight', avatarDataUrl: blackUser.avatar_data_url || '',
    },
  });
  if (bSock) bSock.emit('checkers_match_found', {
    gameId, color: 'b', size, rules, mode, position,
    opponent: {
      username: whiteUser.username, elo: checkersEloOf(whiteUser, size),
      avatarStock: whiteUser.avatar_stock || 'av_knight', avatarDataUrl: whiteUser.avatar_data_url || '',
    },
  });
}

// Finish a checkers game: update ONLY the correct checkers Elo column (ranked
// only), record a games row tagged game_type='checkers', and broadcast
// checkers_game_over. ISOLATION: this NEVER reads or writes the chess `elo`
// column; casual games apply zero Elo change. Mirrors chess finishGame's
// SQLite-direct / Postgres store.runTransaction dual path for atomicity.
async function finishCheckersGame(io, cg, override = {}) {
  if (cg._ended) return;
  cg._ended = true;
  const winnerId = override.winnerId || null;
  const winnerColor = override.winnerColor || null; // 'w' | 'b' | null (draw)
  const reason = override.reason || 'game-over';
  const isDraw = !winnerId;
  const eloCol = checkersEloColumn(cg.size); // 'elo_checkers_8' | 'elo_checkers_10'
  const gamesCol = checkersGamesColumn(cg.size); // 'checkers8_games' | 'checkers10_games'

  let whiteUser, blackUser;
  if (store.usingPostgres) {
    try {
      whiteUser = await store.getUserById(cg.white);
      blackUser = await store.getUserById(cg.black);
    } catch (e) { console.error('[finishCheckersGame] pg read failed', e && e.message); }
  } else {
    whiteUser = getUserById(cg.white);
    blackUser = getUserById(cg.black);
  }

  let wd = 0, bd = 0;
  if (cg.rated && whiteUser && blackUser) {
    const whiteScore = isDraw ? 0.5 : (winnerId === cg.white ? 1 : 0);
    wd = eloDelta(checkersEloOf(whiteUser, cg.size), checkersEloOf(blackUser, cg.size), whiteScore);
    bd = eloDelta(checkersEloOf(blackUser, cg.size), checkersEloOf(whiteUser, cg.size), 1 - whiteScore);
  }

  // The result string mirrors the chess games table ('checkmate'/'draw'/etc.);
  // here it carries the checkers reason. variant = board size as a string.
  const insertSql = `INSERT INTO games (id, white_id, black_id, mode, result, winner_id, pgn,
                                        white_elo_before, black_elo_before, white_elo_delta, black_elo_delta,
                                        created_at, ended_at, game_type, variant)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const insertParams = [
    cg.id, cg.white, cg.black, cg.mode, reason, winnerId, cg.game.serialize(),
    cg.whiteEloBefore, cg.blackEloBefore, wd, bd,
    cg.started, Date.now(), 'checkers', String(cg.size)];

  if (store.usingPostgres) {
    try {
      await store.runTransaction(async (tx) => {
        if (cg.rated) {
          // Update ONLY the size-specific checkers Elo column. The column name is
          // chosen from a fixed two-value allowlist (checkersEloColumn), never
          // from client input, so the interpolation is injection-safe.
          await tx.run(`UPDATE users SET ${eloCol} = ${eloCol} + ? WHERE id = ?`, [wd, cg.white]);
          await tx.run(`UPDATE users SET ${eloCol} = ${eloCol} + ? WHERE id = ?`, [bd, cg.black]);
          // Track ranked participation per board size so the checkers leaderboards
          // can filter on real games played. Same fixed-allowlist column safety.
          await tx.run(`UPDATE users SET ${gamesCol} = ${gamesCol} + 1 WHERE id = ?`, [cg.white]);
          await tx.run(`UPDATE users SET ${gamesCol} = ${gamesCol} + 1 WHERE id = ?`, [cg.black]);
        }
        await tx.run(insertSql, insertParams);
      });
    } catch (e) { console.error('[finishCheckersGame] pg persist failed', e && e.message); }
  } else {
    try {
      db.transaction(() => {
        if (cg.rated) {
          const up = db.prepare(`UPDATE users SET ${eloCol} = ${eloCol} + ? WHERE id = ?`);
          up.run(wd, cg.white);
          up.run(bd, cg.black);
          // Track ranked participation per board size so the checkers leaderboards
          // can filter on real games played. Same fixed-allowlist column safety.
          const upGames = db.prepare(`UPDATE users SET ${gamesCol} = ${gamesCol} + 1 WHERE id = ?`);
          upGames.run(cg.white);
          upGames.run(cg.black);
        }
        db.prepare(insertSql).run(...insertParams);
      })();
    } catch (e) { console.error('[finishCheckersGame] persist failed', e && e.message); }
  }

  io.to(cg.id).emit('checkers_game_over', {
    gameId: cg.id,
    winner: winnerColor,        // 'w' | 'b' | null (draw)
    winnerId,                   // uid | null
    reason,
    whiteDelta: wd,
    blackDelta: bd,
    position: cg.game.serialize(),
  });

  userActiveCheckersGame.delete(cg.white);
  userActiveCheckersGame.delete(cg.black);
  activeCheckersGames.delete(cg.id);
}

// Finish a RANKED bot-backfill game. ELO + trophies move for the HUMAN exactly
// like a human ranked game — vs the bot's rating, which equals the human's rating
// at match time (so it's ELO-neutral in expectation and non-farmable). Only the
// human's users row is touched; no `games` row is written for the synthetic bot
// (its uid has no users row, and the games table FK-references users(id)). The
// `game_over` payload still carries the full result + the human's delta so the
// client shows it normally. Bot games are NOT rematch-eligible.
async function finishBotGame(io, game, override = {}) {
  if (game._ended) return;
  game._ended = true;
  if (game.disconnectTimer) { clearTimeout(game.disconnectTimer); game.disconnectTimer = null; }
  const chess = game.chess;
  let winnerId = override.winnerId || null;
  let reason = override.reason || (chess.isCheckmate() ? 'checkmate' : (chess.isDraw() ? 'draw' : 'unknown'));
  if (!winnerId && chess.isCheckmate()) {
    winnerId = chess.turn() === 'w' ? game.black : game.white;
  }
  const isDraw = !winnerId;
  const humanUid = game.humanUid;
  const humanColor = game.botColor === 'w' ? 'b' : 'w';
  const humanWon = !isDraw && winnerId === humanUid;
  const botWon = !isDraw && !humanWon; // winnerId is the bot seat
  // Human's ELO change vs the bot's rating (= human's rating at match time).
  // ARENA bot games never move global ELO (the leaderboard is points, not ELO),
  // so the delta is 0 and the persist below is skipped.
  const isArena = game.mode === 'arena';
  const humanScore = isDraw ? 0.5 : (humanWon ? 1 : 0);
  const humanDelta = isArena ? 0 : eloDelta(game.botElo, game.botElo, humanScore);
  // Stat counters for the human only.
  const winInc = humanWon ? 1 : 0;
  const lossInc = botWon ? 1 : 0;
  const drawInc = isDraw ? 1 : 0;
  if (!isArena) try {
    if (store.usingPostgres) {
      const up = `UPDATE users SET elo = elo + ?,
          wins = wins + ?, losses = losses + ?, draws = draws + ?,
          current_streak = CASE WHEN ? = 1 THEN current_streak + 1 ELSE 0 END,
          best_streak = GREATEST(best_streak, CASE WHEN ? = 1 THEN current_streak + 1 ELSE 0 END)
        WHERE id = ?`;
      await store.run(up, [humanDelta, winInc, lossInc, drawInc, winInc, winInc, humanUid]);
    } else {
      const up = db.prepare(`UPDATE users SET elo = elo + ?,
          wins = wins + ?, losses = losses + ?, draws = draws + ?,
          current_streak = CASE WHEN ? THEN current_streak + 1 ELSE 0 END,
          best_streak = MAX(best_streak, CASE WHEN ? THEN current_streak + 1 ELSE 0 END)
        WHERE id = ?`);
      up.run(humanDelta, winInc, lossInc, drawInc, winInc, winInc, humanUid);
    }
  } catch (e) { console.error('[finishBotGame] persist failed', e && e.message); }
  // Emit the standard game_over. whiteDelta/blackDelta map to the seats; the bot
  // seat's delta is reported as the inverse so a generic display stays sensible.
  const whiteDelta = humanColor === 'w' ? humanDelta : -humanDelta;
  const blackDelta = humanColor === 'b' ? humanDelta : -humanDelta;
  io.to(game.id).emit('game_over', {
    gameId: game.id,
    winnerId,
    reason,
    whiteDelta,
    blackDelta,
    pgn: chess.pgn(),
    isBot: true,
  });
  userActiveGame.delete(humanUid);
  activeGames.delete(game.id);

  // VICTIM WALL: a ranked WIN extends the human's streak. Record the bot as the
  // victim (so the human's "Most Feared" wall fills even from backfill bot wins).
  // The loser is the bot => no notification. Failure-isolated; never throws.
  if (!isArena && humanWon) {
    try {
      await recordVictimAndNotify(io, {
        winnerId: humanUid,
        loserId: game.botUid,
        loserName: BOT_DISPLAY_NAME,
        loserIsBot: true,
      });
    } catch (e) { console.error('[victim] botgame hook failed', e && e.message); }
  }

  // SEASON LADDER: credit the HUMAN's current-season row (W/L/D + points + peak
  // elo). The bot seat is never credited (its uid has no users row). Surgical +
  // failure-isolated: a season-stat write must NEVER affect the ELO write above.
  if (!isArena) try {
    await recordSeasonResult({
      userId: humanUid,
      result: isDraw ? 'draw' : (humanWon ? 'win' : 'loss'),
      elo: game.botElo + humanDelta, // the human's NEW elo after this game
    });
  } catch (e) { console.error('[season] botgame hook failed', e && e.message); }

  // ARENA: score the human into the arena leaderboard (bots are never scored —
  // recordArenaResult only touches JOINED participants) and re-pool them for
  // their next pairing. Failure-isolated: never affects the result above.
  if (isArena && game.arenaId) {
    try {
      await recordArenaResult({
        arenaId: game.arenaId,
        userId: humanUid,
        result: isDraw ? 'draw' : (humanWon ? 'win' : 'loss'),
        elo: game.botElo,
      });
    } catch (e) { console.error('[arena] botgame hook failed', e && e.message); }
    requeueArena(io, humanUid);
  }
}

// ===========================================================================
// VICTIM WALL / revenge loop (the signature differentiator)
// ===========================================================================
// Called from the RANKED finish paths AFTER the winner's stats/streak have been
// written, whenever there is a decisive result (a win, not a draw). It records a
// `streak_victims` row (winner + the defeated player + the winner's NEW streak
// length) so the public "Most Feared" wall and the loser's "get revenge?" prompt
// never depend on the client. If the loser is a HUMAN it best-effort notifies
// them — an in-app socket `defeated` event AND a Web Push (a no-op when push is
// unconfigured). Bot losers are skipped for notifications (no user id).
//
// CRITICAL: this is fully failure-isolated. It is `await`ed only for ordering,
// but every line runs inside one try/catch that swallows ALL errors — a DB,
// notify, or push failure can NEVER propagate back into finishGame/finishBotGame
// and so can never affect the real game result/ELO write. Callers also wrap the
// call defensively.
// `deps` lets tests inject mock notify/push (defaulting to the real ones) so the
// "(mock) notify fires" + "a notify failure can't break finishGame" paths are
// unit-testable. Production callers pass no deps and get the real functions.
async function recordVictimAndNotify(io, { winnerId, loserId, loserName, loserIsBot }, deps) {
  const notify = (deps && deps.notify) || notifyUser;
  const push = (deps && deps.push) || sendPushToUser;
  try {
    if (!winnerId || !loserId) return;
    // Winner's live username + NEW streak length (already incremented by the
    // finish UPDATE that ran before this). Read via the backend-agnostic facade.
    let winnerName = '';
    let streakLen = 1;
    try {
      const w = await store.get(
        'SELECT username, current_streak FROM users WHERE id = ?', [winnerId]);
      if (w) {
        winnerName = w.username || '';
        streakLen = Number(w.current_streak) || 1;
      }
    } catch (e) { /* fall back to defaults; recording still proceeds */ }

    // Record the victim row (server-side source of truth for the wall).
    try {
      await store.recordStreakVictim({
        winnerId,
        victimId: loserId,
        victimName: loserName || '',
        streakLen,
        createdAt: Date.now(),
      });
    } catch (e) { console.error('[victim] record failed', e && e.message); }

    // Notify the LOSER only when they are a real human (skip the engine bot).
    if (loserIsBot || isBotUid(loserId)) return;

    const rank = streakLen; // their position on the winner's current streak
    // In-app socket banner (only reaches them if they have a live socket).
    try {
      notify(loserId, 'defeated', { by: winnerName, streakLen, rank });
    } catch (e) { console.error('[victim] notifyUser failed', e && e.message); }

    // Best-effort Web Push (no-op when push unconfigured; never throws).
    try {
      await push(loserId, {
        title: 'You were defeated',
        body: `You're #${rank} on ${winnerName || 'a rival'}'s win streak — get revenge?`,
        url: '/',
        tag: 'ct-defeated',
      });
    } catch (e) { console.error('[victim] push failed', e && e.message); }
  } catch (e) {
    // Absolute backstop: nothing here may ever reach the game-finish path.
    console.error('[victim] recordVictimAndNotify failed', e && e.message);
  }
}

// Test-only export of the victim-wall hook so test/victim.mjs can verify it
// records a row + fires (mock) notify, and that a notify/push failure is isolated
// (never throws). Not used by production code (the finish paths call the internal
// function directly above).
export function __test_recordVictimAndNotify(io, args, deps) {
  return recordVictimAndNotify(io, args, deps);
}

// ===========================================================================
// SEASON STATS HOOK (surgical + failure-isolated, mirrors recordVictimAndNotify)
// ===========================================================================
// Called from the RANKED finish paths AFTER the ELO/streak write, to increment
// the player's CURRENT-season row (W/L/D + points, peak_elo). This tracks season
// performance SEPARATELY from the live ELO ladder — it NEVER touches the `users`
// elo/result write.
//
// CRITICAL: fully failure-isolated. Every line runs inside one try/catch that
// swallows ALL errors, so a season-stat DB failure can NEVER propagate back into
// finishGame/finishBotGame and so can never affect the real result/ELO write.
// `deps` lets tests inject a mock `record` (defaulting to the real store call) so
// both the happy path and "a throwing season write doesn't break finishGame" are
// unit-testable. Production callers pass no deps.
async function recordSeasonResult({ userId, result, elo }, deps) {
  const record = (deps && deps.record) || store.recordSeasonResult;
  try {
    if (!userId || isBotUid(userId)) return; // never write season rows for the bot seat
    if (!['win', 'loss', 'draw'].includes(result)) return;
    const { seasonId } = seasonInfo();
    await record({ seasonId, userId, result, elo, now: Date.now() });
  } catch (e) {
    // Absolute backstop: nothing here may ever reach the game-finish path.
    console.error('[season] recordSeasonResult failed', e && e.message);
  }
}

// Test-only export so test/season.mjs can verify the hook increments the row,
// and that a throwing season write is isolated (never throws). Not used by
// production code (the finish paths call the internal function directly).
export function __test_recordSeasonResult(args, deps) {
  return recordSeasonResult(args, deps);
}

// Arena test hooks: drive a pairing pass + inspect/seed the in-memory pool so
// the realtime pairing + bot-backfill can be exercised without real sockets.
export function __test_runArenaPairing(io) { return runArenaPairing(io); }
export function __test_arenaPoolSize() { return arenaPool.size; }
export function __test_seedArenaPool(uid, entry) { arenaMembership.set(uid, entry.arenaId); arenaPool.set(uid, entry); }

async function finishGame(io, game, override = {}) {
  if (game._ended) return;
  // RANKED bot games take a dedicated finish path (one DB user, no FK-violating
  // games row for the synthetic bot). Diverted before the human-vs-human logic.
  if (game.isBot) { await finishBotGame(io, game, override); return; }
  game._ended = true;
  // Don't leak a pending disconnect grace timer if the game ends another way.
  if (game.disconnectTimer) { clearTimeout(game.disconnectTimer); game.disconnectTimer = null; }
  const chess = game.chess;
  let winnerId = override.winnerId || null;
  let reason = override.reason || (chess.isCheckmate() ? 'checkmate' : (chess.isDraw() ? 'draw' : 'unknown'));
  if (!winnerId && chess.isCheckmate()) {
    winnerId = chess.turn() === 'w' ? game.black : game.white;
  }
  const isDraw = !winnerId;
  // Read the two players for the ELO computation. Branch on backend: the proven
  // sync SQLite path stays untouched; on Postgres we await the facade reads.
  let whiteUser, blackUser;
  if (store.usingPostgres) {
    try {
      whiteUser = await store.getUserById(game.white);
      blackUser = await store.getUserById(game.black);
    } catch (e) { console.error('[finishGame] pg read failed', e && e.message); }
  } else {
    whiteUser = getUserById(game.white);
    blackUser = getUserById(game.black);
  }
  let wd = 0, bd = 0;
  if (game.mode === 'ranked' && whiteUser && blackUser) {
    const whiteScore = isDraw ? 0.5 : (winnerId === game.white ? 1 : 0);
    wd = eloDelta(whiteUser.elo, blackUser.elo, whiteScore);
    bd = eloDelta(blackUser.elo, whiteUser.elo, 1 - whiteScore);
  }
  // Apply ELO updates + persist game record atomically so a crash can't leave
  // half-applied results. Backend-branched: SQLite keeps the synchronous
  // better-sqlite3 transaction (cannot span await); Postgres uses the async
  // store.runTransaction (BEGIN/COMMIT on one pooled client).
  if (store.usingPostgres) {
    try {
      await store.runTransaction(async (tx) => {
        if (game.mode === 'ranked') {
          // Postgres CASE WHEN needs a boolean predicate (SQLite accepts a 0/1
          // integer); the win flag is passed as 1/0, so compare `= 1`. GREATEST
          // replaces SQLite's 2-arg MAX (Postgres MAX is aggregate-only).
          const up = `UPDATE users SET elo = elo + ?,
              wins = wins + ?, losses = losses + ?, draws = draws + ?,
              current_streak = CASE WHEN ? = 1 THEN current_streak + 1 ELSE 0 END,
              best_streak = GREATEST(best_streak, CASE WHEN ? = 1 THEN current_streak + 1 ELSE 0 END)
            WHERE id = ?`;
          await tx.run(up, [wd,
            isDraw ? 0 : (winnerId === game.white ? 1 : 0),
            isDraw ? 0 : (winnerId === game.white ? 0 : 1),
            isDraw ? 1 : 0,
            isDraw ? 0 : (winnerId === game.white ? 1 : 0),
            isDraw ? 0 : (winnerId === game.white ? 1 : 0),
            game.white]);
          await tx.run(up, [bd,
            isDraw ? 0 : (winnerId === game.black ? 1 : 0),
            isDraw ? 0 : (winnerId === game.black ? 0 : 1),
            isDraw ? 1 : 0,
            isDraw ? 0 : (winnerId === game.black ? 1 : 0),
            isDraw ? 0 : (winnerId === game.black ? 1 : 0),
            game.black]);
        }
        await tx.run(`INSERT INTO games (id, white_id, black_id, mode, result, winner_id, pgn,
                                         white_elo_before, black_elo_before, white_elo_delta, black_elo_delta,
                                         created_at, ended_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [game.id, game.white, game.black, game.mode, reason, winnerId, chess.pgn(),
           game.whiteEloBefore, game.blackEloBefore, wd, bd,
           game.started, Date.now()]);
      });
    } catch (e) { console.error('[finishGame] pg persist failed', e && e.message); }
  } else {
    db.transaction(() => {
      if (game.mode === 'ranked') {
        const up = db.prepare(`UPDATE users SET elo = elo + ?,
            wins = wins + ?, losses = losses + ?, draws = draws + ?,
            current_streak = CASE WHEN ? THEN current_streak + 1 ELSE 0 END,
            best_streak = MAX(best_streak, CASE WHEN ? THEN current_streak + 1 ELSE 0 END)
          WHERE id = ?`);
        up.run(wd,
          isDraw ? 0 : (winnerId === game.white ? 1 : 0),
          isDraw ? 0 : (winnerId === game.white ? 0 : 1),
          isDraw ? 1 : 0,
          isDraw ? 0 : (winnerId === game.white ? 1 : 0),
          isDraw ? 0 : (winnerId === game.white ? 1 : 0),
          game.white);
        up.run(bd,
          isDraw ? 0 : (winnerId === game.black ? 1 : 0),
          isDraw ? 0 : (winnerId === game.black ? 0 : 1),
          isDraw ? 1 : 0,
          isDraw ? 0 : (winnerId === game.black ? 1 : 0),
          isDraw ? 0 : (winnerId === game.black ? 1 : 0),
          game.black);
      }
      db.prepare(`INSERT INTO games (id, white_id, black_id, mode, result, winner_id, pgn,
                                     white_elo_before, black_elo_before, white_elo_delta, black_elo_delta,
                                     created_at, ended_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(game.id, game.white, game.black, game.mode, reason, winnerId, chess.pgn(),
             game.whiteEloBefore, game.blackEloBefore, wd, bd,
             game.started, Date.now());
    })();
  }
  io.to(game.id).emit('game_over', {
    gameId: game.id,
    winnerId,
    reason,
    whiteDelta: wd,
    blackDelta: bd,
    pgn: chess.pgn(),
  });
  userActiveGame.delete(game.white);
  userActiveGame.delete(game.black);
  activeGames.delete(game.id);

  // VICTIM WALL: on a DECISIVE ranked human-vs-human result, the winner's streak
  // just incremented — record the loser as a victim and notify them ("get
  // revenge?"). Skipped for draws and for casual games (no streak movement).
  // Failure-isolated so it can never disturb the result/ELO write above.
  if (game.mode === 'ranked' && !isDraw && winnerId) {
    const loserId = winnerId === game.white ? game.black : game.white;
    const loserUser = loserId === game.white ? whiteUser : blackUser;
    try {
      await recordVictimAndNotify(io, {
        winnerId,
        loserId,
        loserName: (loserUser && loserUser.username) || '',
        loserIsBot: false,
      });
    } catch (e) { console.error('[victim] game hook failed', e && e.message); }
  }

  // SEASON LADDER: on a RANKED human-vs-human result, increment BOTH players'
  // current-season rows (W/L/D + points + peak elo). Tracked SEPARATELY from the
  // ELO write above; surgical + failure-isolated (a season-stat write must NEVER
  // affect the result/ELO write). Casual games don't move the season ladder.
  if (game.mode === 'ranked') {
    const whiteResult = isDraw ? 'draw' : (winnerId === game.white ? 'win' : 'loss');
    const blackResult = isDraw ? 'draw' : (winnerId === game.black ? 'win' : 'loss');
    try {
      await recordSeasonResult({
        userId: game.white, result: whiteResult,
        elo: (whiteUser ? whiteUser.elo : 0) + wd, // NEW elo after this game
      });
      await recordSeasonResult({
        userId: game.black, result: blackResult,
        elo: (blackUser ? blackUser.elo : 0) + bd,
      });
    } catch (e) { console.error('[season] game hook failed', e && e.message); }
  }

  // ARENA: score BOTH players into the arena leaderboard + re-pool them. Arena
  // games are mode!=='ranked', so the ELO/games-row path above never moved their
  // rating — the arena currency is points, not ELO. Surgical + failure-isolated.
  if (game.mode === 'arena' && game.arenaId) {
    const whiteResult = isDraw ? 'draw' : (winnerId === game.white ? 'win' : 'loss');
    const blackResult = isDraw ? 'draw' : (winnerId === game.black ? 'win' : 'loss');
    try {
      await recordArenaResult({ arenaId: game.arenaId, userId: game.white, result: whiteResult, elo: whiteUser ? whiteUser.elo : 0 });
      await recordArenaResult({ arenaId: game.arenaId, userId: game.black, result: blackResult, elo: blackUser ? blackUser.elo : 0 });
    } catch (e) { console.error('[arena] game hook failed', e && e.message); }
    requeueArena(io, game.white);
    requeueArena(io, game.black);
  }

  // Stash a short-lived snapshot so a rematch can be set up after the game
  // object is gone. Auto-deleted after the TTL.
  const existingRecent = recentGames.get(game.id);
  if (existingRecent?.expireTimer) clearTimeout(existingRecent.expireTimer);
  const recent = { whiteUid: game.white, blackUid: game.black, mode: game.mode, tc: game.tc, expireTimer: null };
  recent.expireTimer = setTimeout(() => {
    recentGames.delete(game.id);
    clearRematchOffer(game.id);
  }, RECENT_GAME_TTL_MS);
  if (typeof recent.expireTimer.unref === 'function') recent.expireTimer.unref();
  recentGames.set(game.id, recent);
}

// Clear a standing rematch offer (and its expire timer) for a gameId.
function clearRematchOffer(gameId) {
  const offer = rematchOffers.get(gameId);
  if (!offer) return;
  if (offer.expireTimer) clearTimeout(offer.expireTimer);
  rematchOffers.delete(gameId);
}

// Start a rematch for a recent 1v1 game: same players, same mode/tc, colors
// swapped. Reuses the normal startGame path so both clients get match_found.
async function startRematch(io, gameId) {
  const rg = recentGames.get(gameId);
  if (!rg) return;
  // Consume the offer + recent snapshot up front so we can't double-fire.
  clearRematchOffer(gameId);
  if (rg.expireTimer) clearTimeout(rg.expireTimer);
  recentGames.delete(gameId);

  // Colors swapped: previous Black becomes White.
  const newWhiteUid = rg.blackUid;
  const newBlackUid = rg.whiteUid;
  const wSock = userSocket.get(newWhiteUid);
  const bSock = userSocket.get(newBlackUid);
  if (!wSock || !bSock) return; // a player went offline; abort silently
  // Branch on backend for the existence/elo reads (sync SQLite vs awaited PG).
  let wUser, bUser;
  if (store.usingPostgres) {
    wUser = await store.getUserById(newWhiteUid);
    bUser = await store.getUserById(newBlackUid);
  } else {
    wUser = getUserById(newWhiteUid);
    bUser = getUserById(newBlackUid);
  }
  if (!wUser || !bUser) return;
  // startGame randomizes colors internally, so pre-bias by passing the desired
  // White first and Black second is not enough. Force the order by giving
  // startGame two entries and overriding its randomization via fixed seats:
  // we pass them so a is White-intended; startGame still flips 50/50, so we
  // call a color-forced variant.
  await startGameWithColors(io,
    { uid: newWhiteUid, socketId: wSock, elo: wUser.elo, mode: rg.mode, tc: rg.tc },
    { uid: newBlackUid, socketId: bSock, elo: bUser.elo, mode: rg.mode, tc: rg.tc });
}

// ===========================================================================
// 2v2 TEAM PLAY
// ===========================================================================
// Wire model:
//   - teamQueue holds entries. An entry is either a solo (1 member) or a duo
//     (2 members from an accepted friend invite). Entries are matched FIFO.
//   - Pairing tries to gather enough entries totalling exactly 4 members. Duos
//     are never split across teams.
//   - Team White's seats alternate move chooser: seat 0 plays white's 1st move,
//     seat 1 plays white's 2nd, etc. Same for Black. The server validates that
//     each incoming move comes from the player whose seat is currently up.
//   - team_match_found is emitted per-socket so each client receives their own
//     yourSide/yourSeat/partnerId without leaking other players' socket IDs.

function ratingFor2v2(user) {
  // Falls back to 1200 for newly migrated rows before the first 2v2 game.
  const v = user && user.elo_2v2;
  return Number.isFinite(v) ? v : 1200;
}

function findTeamQueueEntryByUid(uid) {
  for (const e of teamQueue.values()) {
    if (e.members.some(m => m.uid === uid)) return e;
  }
  return null;
}

function removeUidFromTeamQueue(io, uid) {
  const entry = findTeamQueueEntryByUid(uid);
  if (!entry) return;
  // If solo, just delete. If duo, dissolve and inform the partner.
  teamQueue.delete(entry.id);
  if (entry.type === 'duo') {
    for (const m of entry.members) {
      if (m.uid === uid) continue;
      const s = io.sockets.sockets.get(m.socketId);
      if (s) s.emit('team_mm_left', { reason: 'partner_left' });
    }
  }
}

function teamOfUid(tg, uid) {
  if (tg.whiteByUid[uid] !== undefined) return 'w';
  if (tg.blackByUid[uid] !== undefined) return 'b';
  return null;
}

function tryTeamMatchmake(io) {
  // FIFO walk: greedily pick entries that fit; if total reaches exactly 4, pair.
  // Only entries sharing the SAME tc may be grouped together.
  const ready = [...teamQueue.values()]
    .filter(e => e.type !== 'duo' || e.members.length === 2)  // skip duos waiting for guest
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const byTc = new Map();
  for (const e of ready) {
    const key = normalizeTc(e.tc);
    if (!byTc.has(key)) byTc.set(key, []);
    byTc.get(key).push(e);
  }
  let picked = [];
  let matchedTc = 'unlimited';
  for (const [key, entries] of byTc) {
    const group = [];
    let t = 0;
    for (const e of entries) {
      if (t + e.members.length <= 4) {
        group.push(e);
        t += e.members.length;
        if (t === 4) break;
      }
    }
    if (t === 4) { picked = group; matchedTc = key; break; }
  }
  const total = picked.reduce((s, e) => s + e.members.length, 0);
  if (total !== 4) return;
  // Remove from queue, and clear any accepted duo invites now that the game
  // starts (otherwise a consumed invite leaks forever).
  for (const e of picked) {
    teamQueue.delete(e.id);
    if (e.type === 'duo' && e.inviteId) duoInvites.delete(e.inviteId);
  }

  // Form teams: respect duos. Snake-draft 4 solos so team avg ELOs balance.
  const duos = picked.filter(e => e.type === 'duo');
  const solos = picked.filter(e => e.type === 'solo').flatMap(e => e.members);
  let teamA, teamB; // each an array of 2 member-objects
  if (duos.length === 2) {
    teamA = duos[0].members.slice(); teamB = duos[1].members.slice();
  } else if (duos.length === 1) {
    teamA = duos[0].members.slice();
    teamB = solos.slice(0, 2);
  } else {
    const sorted = solos.slice().sort((a, b) => b.elo - a.elo);
    teamA = [sorted[0], sorted[3]]; // highest + lowest
    teamB = [sorted[1], sorted[2]];
  }
  // Random which team is white and randomise seats within each team.
  const aIsWhite = Math.random() < 0.5;
  const whiteMembers = aIsWhite ? teamA : teamB;
  const blackMembers = aIsWhite ? teamB : teamA;
  if (Math.random() < 0.5) whiteMembers.reverse();
  if (Math.random() < 0.5) blackMembers.reverse();

  Promise.resolve(startTeamGame(io, whiteMembers, blackMembers, matchedTc)).catch((e) =>
    console.error('[startTeamGame] failed', e && e.message));
}

async function startTeamGame(io, whiteMembers, blackMembers, tc = 'unlimited') {
  const gameId = newGameId();
  const chess = new Chess();
  const normTc = normalizeTc(tc);
  const parsed = parseTc(normTc);
  const clock = makeClock(parsed);
  const whiteByUid = {};
  const blackByUid = {};
  whiteMembers.forEach((m, i) => { whiteByUid[m.uid] = i; });
  blackMembers.forEach((m, i) => { blackByUid[m.uid] = i; });
  // Branch on backend: sync .map(getUserById) on SQLite (unchanged); awaited
  // facade reads on Postgres so the avg-ELO-before snapshot uses the scalable store.
  let whiteUsers, blackUsers;
  if (store.usingPostgres) {
    whiteUsers = await Promise.all(whiteMembers.map(m => store.getUserById(m.uid)));
    blackUsers = await Promise.all(blackMembers.map(m => store.getUserById(m.uid)));
  } else {
    whiteUsers = whiteMembers.map(m => getUserById(m.uid));
    blackUsers = blackMembers.map(m => getUserById(m.uid));
  }
  const tg = {
    id: gameId,
    chess,
    mode: 'team-ranked',
    started: Date.now(),
    tc: normTc,
    clock,
    whiteMembers, blackMembers,
    whiteByUid, blackByUid,
    turnCount: { w: 0, b: 0 }, // number of moves each team has played
    whiteAvgEloBefore: Math.round((whiteUsers[0].elo_2v2 + whiteUsers[1].elo_2v2) / 2),
    blackAvgEloBefore: Math.round((blackUsers[0].elo_2v2 + blackUsers[1].elo_2v2) / 2),
    eloBefore: {
      [whiteMembers[0].uid]: whiteUsers[0].elo_2v2,
      [whiteMembers[1].uid]: whiteUsers[1].elo_2v2,
      [blackMembers[0].uid]: blackUsers[0].elo_2v2,
      [blackMembers[1].uid]: blackUsers[1].elo_2v2,
    },
  };
  activeTeamGames.set(gameId, tg);
  for (const m of [...whiteMembers, ...blackMembers]) {
    userActiveTeamGame.set(m.uid, gameId);
    const s = io.sockets.sockets.get(m.socketId);
    if (s) s.join(gameId);
  }

  // Per-socket match_found so each client gets their own seat/side/partner info.
  const sideUsers = { w: whiteUsers, b: blackUsers };
  const sideMembers = { w: whiteMembers, b: blackMembers };
  for (const side of ['w', 'b']) {
    for (let seat = 0; seat < 2; seat++) {
      const me = sideMembers[side][seat];
      const partner = sideMembers[side][1 - seat];
      const s = io.sockets.sockets.get(me.socketId);
      if (!s) continue;
      s.emit('team_match_found', {
        gameId,
        mode: 'team-ranked',
        yourSide: side,
        yourSeat: seat,
        partner: publicUser(sideUsers[side][1 - seat]),
        partnerId: partner.uid,
        white: { p1: publicUser(whiteUsers[0]), p2: publicUser(whiteUsers[1]) },
        black: { p1: publicUser(blackUsers[0]), p2: publicUser(blackUsers[1]) },
        whiteAvgElo: tg.whiteAvgEloBefore,
        blackAvgElo: tg.blackAvgEloBefore,
        tc: normTc,
        clock: clockSnapshotForStart(clock, parsed),
      });
    }
  }
}

function applyTeamMove(io, socket, tg, uid, { from, to, promotion }) {
  const myTeam = teamOfUid(tg, uid);
  if (!myTeam) return;
  const turn = tg.chess.turn();
  if (turn !== myTeam) { socket.emit('illegal_move', { gameId: tg.id, reason: 'not your team turn' }); return; }
  const mySeat = (myTeam === 'w' ? tg.whiteByUid : tg.blackByUid)[uid];
  const expectedSeat = tg.turnCount[myTeam] % 2;
  if (mySeat !== expectedSeat) { socket.emit('illegal_move', { gameId: tg.id, reason: 'not your seat' }); return; }
  const move = tg.chess.move({ from, to, promotion: promotion || 'q' });
  if (!move) { socket.emit('illegal_move', { gameId: tg.id, from, to, reason: 'illegal' }); return; }
  tg.turnCount[myTeam] += 1;
  // Server-authoritative per-team clock: charge the moving team's elapsed time.
  let clockPayload = null;
  if (tg.clock) {
    const clock = tg.clock;
    const elapsed = Date.now() - clock.turnStartedAt;
    clock[myTeam] -= elapsed;
    if (clock[myTeam] <= 0) {
      // Moving team flagged: timeout loss (or draw if winner can't mate).
      clock[myTeam] = 0;
      timeoutFinishTeamGame(io, tg, myTeam);
      return;
    }
    clock[myTeam] += clock.incrementMs;
    clock.running = myTeam === 'w' ? 'b' : 'w';
    clock.turnStartedAt = Date.now();
    clockPayload = clockSnapshotForMove(clock);
  }
  io.to(tg.id).emit('move_made', {
    gameId: tg.id,
    move,
    fen: tg.chess.fen(),
    turnCount: { w: tg.turnCount.w, b: tg.turnCount.b },
    nextSeat: tg.turnCount[tg.chess.turn()] % 2,
    clock: clockPayload,
  });
  if (tg.chess.isGameOver()) finishTeamGame(io, tg);
}

async function finishTeamGame(io, tg, override = {}) {
  if (tg._ended) return;
  tg._ended = true;
  const chess = tg.chess;
  let winnerColor = override.winnerColor || null;
  let reason = override.reason || (chess.isCheckmate() ? 'checkmate'
    : (chess.isDraw() ? 'draw' : (chess.isStalemate() ? 'stalemate' : 'unknown')));
  if (!winnerColor && chess.isCheckmate()) {
    winnerColor = chess.turn() === 'w' ? 'b' : 'w';
  }
  const isDraw = !winnerColor;
  // Team-average ELO update, K=24. Same delta applied to both members of a team.
  const K = 24;
  const wAvg = tg.whiteAvgEloBefore, bAvg = tg.blackAvgEloBefore;
  const expectedW = 1 / (1 + Math.pow(10, (bAvg - wAvg) / 400));
  const whiteScore = isDraw ? 0.5 : (winnerColor === 'w' ? 1 : 0);
  const wDelta = Math.round(K * (whiteScore - expectedW));
  const bDelta = -wDelta; // zero-sum since same K and average rule

  const whiteUids = [tg.whiteMembers[0].uid, tg.whiteMembers[1].uid];
  const blackUids = [tg.blackMembers[0].uid, tg.blackMembers[1].uid];
  const wWin = isDraw ? 0 : (winnerColor === 'w' ? 1 : 0);
  const wLoss = isDraw ? 0 : (winnerColor === 'w' ? 0 : 1);
  const wDraw = isDraw ? 1 : 0;

  // Apply the four elo_2v2 updates + persist game record atomically. Backend-
  // branched like finishGame: SQLite uses the synchronous better-sqlite3
  // transaction; Postgres uses the async store.runTransaction.
  const teamInsertSql = `INSERT INTO team_games (id, white_p1_id, white_p2_id, black_p1_id, black_p2_id,
                                        mode, result, winner_color, pgn,
                                        white_avg_elo_before, black_avg_elo_before,
                                        white_elo_delta, black_elo_delta,
                                        created_at, ended_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const teamInsertParams = [
    tg.id, whiteUids[0], whiteUids[1], blackUids[0], blackUids[1],
    tg.mode, reason, winnerColor || null, chess.pgn(),
    wAvg, bAvg, wDelta, bDelta,
    tg.started, Date.now()];
  if (store.usingPostgres) {
    try {
      await store.runTransaction(async (tx) => {
        const update2v2 = `UPDATE users SET elo_2v2 = elo_2v2 + ?,
            wins_2v2 = wins_2v2 + ?, losses_2v2 = losses_2v2 + ?, draws_2v2 = draws_2v2 + ?
          WHERE id = ?`;
        for (const u of whiteUids) await tx.run(update2v2, [wDelta, wWin, wLoss, wDraw, u]);
        for (const u of blackUids) await tx.run(update2v2, [bDelta, 1 - wWin - wDraw, 1 - wLoss - wDraw, wDraw, u]);
        await tx.run(teamInsertSql, teamInsertParams);
      });
    } catch (e) {
      console.error('[team-game] pg persist failed', e && e.message);
    }
  } else {
    try {
      db.transaction(() => {
        const update2v2 = db.prepare(`UPDATE users SET elo_2v2 = elo_2v2 + ?,
            wins_2v2 = wins_2v2 + ?, losses_2v2 = losses_2v2 + ?, draws_2v2 = draws_2v2 + ?
          WHERE id = ?`);
        for (const u of whiteUids) update2v2.run(wDelta, wWin, wLoss, wDraw, u);
        for (const u of blackUids) update2v2.run(bDelta, 1 - wWin - wDraw, 1 - wLoss - wDraw, wDraw, u);
        db.prepare(teamInsertSql).run(...teamInsertParams);
      })();
    } catch (e) {
      console.error('[team-game] persist failed', e);
    }
  }

  // Per-side delta map so each client can show its own ELO change.
  const perPlayerDelta = {};
  for (const u of whiteUids) perPlayerDelta[u] = wDelta;
  for (const u of blackUids) perPlayerDelta[u] = bDelta;

  io.to(tg.id).emit('game_over', {
    gameId: tg.id,
    winnerColor,
    reason,
    whiteDelta: wDelta,
    blackDelta: bDelta,
    perPlayerDelta,
    pgn: chess.pgn(),
    team: true,
  });

  // Clean up routing tables.
  for (const u of [...whiteUids, ...blackUids]) userActiveTeamGame.delete(u);
  activeTeamGames.delete(tg.id);
}
