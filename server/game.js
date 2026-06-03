// In-memory game state + matchmaking + Socket.IO handlers.
// When REDIS_URL is set (multi-instance mode) the 1v1 lifecycle is delegated to
// scale-store.js (shared Redis state); the in-memory path below is used as-is for
// single-instance mode and for 2v2 (which stays single-instance for now).
import { Chess } from 'chess.js';
import crypto from 'crypto';
import { db, getUserById } from './db.js';
import * as scale from './scale-store.js';

const activeGames = new Map();     // gameId -> { white, black, chess, mode, started }
const userActiveGame = new Map();  // uid -> gameId (1v1, mirrors userActiveTeamGame)
const matchmakingQueue = new Map(); // userId -> { socketId, elo, joinedAt, mode }
const userSocket = new Map();      // userId -> socketId
const socketUser = new Map();      // socketId -> userId
const chatBuckets = new Map();     // userId -> { tokens, lastRefill }
const mmBuckets = new Map();       // userId -> { tokens, lastRefill }

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

// --- Time controls (server-authoritative clocks) ---
// Allowlisted keys; anything else is treated as 'unlimited' (no clock).
const TC_ALLOWLIST = new Set(['1+0', '3+2', '5+0', '10+0', '15+10', 'unlimited']);

// Normalise an incoming tc value to an allowlisted key (defaults to 'unlimited').
function normalizeTc(tc) {
  return (typeof tc === 'string' && TC_ALLOWLIST.has(tc)) ? tc : 'unlimited';
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

export function attachSocketHandlers(io, verifyToken, redisClient = null) {
  scaleR = redisClient || null;
  startTimeoutSweep(io);            // covers in-memory games (1v1 single-instance + 2v2)
  if (scaleR) scale.startSweep(io, scaleR); // covers redis-backed 1v1 across instances
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
      const user = getUserById(payload.uid);
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
          socket.emit('game_state', {
            gameId: resumeId,
            fen: game.chess.fen(),
            mode: game.mode,
            yourColor,
            white: publicUser(getUserById(game.white)),
            black: publicUser(getUserById(game.black)),
            clock: clockSnap,
          });
        }
      }
    });

    // Skill-based matchmaking
    socket.on('mm_join', async ({ mode, tc }) => {
      const uid = socket.data.userId; if (!uid) return;
      if (!consumeBucket(mmBuckets, uid, 3, 0.2)) {
        socket.emit('rate_limited', { event: 'mm_join', retryInMs: 5000 });
        return;
      }
      if (scaleR) { try { await scale.joinQueue(io, scaleR, uid, { mode, tc }); } catch (e) { console.error('[scale] joinQueue', e && e.message); } return; }
      const user = getUserById(uid);
      matchmakingQueue.set(uid, { socketId: socket.id, elo: user.elo, joinedAt: Date.now(), mode: typeof mode === 'string' ? mode : 'ranked', tc: normalizeTc(tc) });
      tryMatchmake(io);
    });
    socket.on('mm_leave', async () => {
      const uid = socket.data.userId; if (!uid) return;
      if (scaleR) { try { await scale.leaveQueue(scaleR, uid); } catch (e) {} return; }
      matchmakingQueue.delete(uid);
    });

    // --- 2v2 team matchmaking ---
    socket.on('team_mm_join', ({ inviteId, tc }) => {
      const uid = socket.data.userId; if (!uid) return;
      if (!consumeBucket(teamMmBuckets, uid, 3, 0.2)) {
        socket.emit('rate_limited', { event: 'team_mm_join', retryInMs: 5000 });
        return;
      }
      const entryTc = normalizeTc(tc);
      // If user is already queued (solo or as part of a duo), ignore.
      if (findTeamQueueEntryByUid(uid)) return;
      const user = getUserById(uid);
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

    socket.on('team_mm_leave', () => {
      const uid = socket.data.userId; if (!uid) return;
      removeUidFromTeamQueue(io, uid);
    });

    // Friend-duo invite lifecycle.
    socket.on('duo_invite', ({ friendId }) => {
      const uid = socket.data.userId; if (!uid) return;
      if (typeof friendId !== 'string' || friendId === uid) return;
      const friend = getUserById(friendId);
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
      const me = getUserById(uid);
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

    socket.on('duo_accept', ({ inviteId }) => {
      const uid = socket.data.userId; if (!uid) return;
      const invite = duoInvites.get(inviteId);
      if (!invite || invite.guestId !== uid) return;
      invite.accepted = true;
      // Tell host they can queue; both will then send team_mm_join with inviteId.
      io.sockets.sockets.get(invite.hostSocketId)?.emit('duo_accepted', {
        inviteId,
        partner: publicUser(getUserById(uid)),
      });
      socket.emit('duo_ready', { inviteId, partner: publicUser(getUserById(invite.hostId)) });
    });

    socket.on('duo_decline', ({ inviteId }) => {
      const uid = socket.data.userId; if (!uid) return;
      const invite = duoInvites.get(inviteId);
      if (!invite || invite.guestId !== uid) return;
      duoInvites.delete(inviteId);
      io.sockets.sockets.get(invite.hostSocketId)?.emit('duo_declined', { inviteId });
    });

    socket.on('duo_cancel', ({ inviteId }) => {
      const uid = socket.data.userId; if (!uid) return;
      const invite = duoInvites.get(inviteId);
      if (!invite || invite.hostId !== uid) return;
      duoInvites.delete(inviteId);
      // Also pull any partial queue entry for this duo.
      if (invite.entryId && teamQueue.has(invite.entryId)) teamQueue.delete(invite.entryId);
      const guestSock = userSocket.get(invite.guestId);
      if (guestSock) io.sockets.sockets.get(guestSock)?.emit('duo_cancelled', { inviteId });
    });

    // Game moves -- now dispatches to either 1v1 or 2v2 session.
    socket.on('move', async ({ gameId, from, to, promotion }) => {
      const uid = socket.data.userId;
      if (!uid) return;
      // 2v2 first (more specific check; 2v2 stays in-memory / single-instance)
      const tg = activeTeamGames.get(gameId);
      if (tg) { applyTeamMove(io, socket, tg, uid, { from, to, promotion }); return; }
      // 1v1 in multi-instance mode -> shared Redis store.
      if (scaleR) { try { await scale.handleMove(io, scaleR, socket, uid, { gameId, from, to, promotion }); } catch (e) { console.error('[scale] move', e && e.message); } return; }
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
      if (game.chess.isGameOver()) finishGame(io, game);
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
      if (scaleR) { try { await scale.handleResign(io, scaleR, uid, gameId); } catch (e) { console.error('[scale] resign', e && e.message); } return; }
      const game = activeGames.get(gameId); if (!game) return;
      const winner = game.white === uid ? game.black : game.white;
      finishGame(io, game, { reason: 'resignation', winnerId: winner });
    });

    // --- Rematch (1v1 only) ---
    socket.on('rematch_offer', ({ gameId }) => {
      const uid = socket.data.userId; if (!uid) return;
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
        startRematch(io, gameId);
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
      if (oppSock) io.sockets.sockets.get(oppSock)?.emit('rematch_offered', { gameId, from: publicUser(getUserById(uid)) });
    });

    socket.on('rematch_accept', ({ gameId }) => {
      const uid = socket.data.userId; if (!uid) return;
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
      startRematch(io, gameId);
    });

    socket.on('rematch_decline', ({ gameId }) => {
      const uid = socket.data.userId; if (!uid) return;
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
        userSocket.delete(uid);
        socketUser.delete(socket.id);
        removeUidFromTeamQueue(io, uid);
        // Plug slow leaks: drop this user's token-bucket entries.
        mmBuckets.delete(uid);
        chatBuckets.delete(uid);
        teamMmBuckets.delete(uid);
        // Cancel any pending duo invites this user hosts or is invited to.
        for (const [iid, inv] of duoInvites) {
          if (inv.hostId === uid || inv.guestId === uid) {
            duoInvites.delete(iid);
            const other = inv.hostId === uid ? inv.guestId : inv.hostId;
            const otherSock = userSocket.get(other);
            if (otherSock) io.sockets.sockets.get(otherSock)?.emit('duo_cancelled', { inviteId: iid });
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
          try { await scale.onDisconnect(io, scaleR, uid); } catch (e) { console.error('[scale] disconnect', e && e.message); }
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
  return { id: u.id, username: u.username, elo: u.elo, wins: u.wins, losses: u.losses, isPremium: !!u.is_premium };
}

function tryMatchmake(io) {
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
      a.tc === b.tc
    );
    if (match) {
      matchmakingQueue.delete(a.uid);
      matchmakingQueue.delete(match.uid);
      startGame(io, a, match);
    }
  }
}

function startGame(io, a, b) {
  const [white, black] = Math.random() < 0.5 ? [a, b] : [b, a];
  startGameWithColors(io, white, black);
}

// Color-forced game start: `white`/`black` are {uid, socketId, elo, mode, tc}.
// Used by the rematch path (to swap colors deterministically) and by startGame
// (after it has randomized which entry is white).
function startGameWithColors(io, white, black) {
  const a = white; // keep `a` for tc/mode reads below (matches old startGame)
  const gameId = newGameId();
  const chess = new Chess();
  const tc = normalizeTc(a.tc);
  const parsed = parseTc(tc);
  const clock = makeClock(parsed);
  const game = {
    id: gameId,
    white: white.uid,
    black: black.uid,
    chess,
    mode: a.mode,
    started: Date.now(),
    tc,
    clock,
    whiteEloBefore: getUserById(white.uid).elo,
    blackEloBefore: getUserById(black.uid).elo,
  };
  activeGames.set(gameId, game);
  userActiveGame.set(white.uid, gameId);
  userActiveGame.set(black.uid, gameId);
  const wSock = io.sockets.sockets.get(white.socketId);
  const bSock = io.sockets.sockets.get(black.socketId);
  if (wSock) wSock.join(gameId);
  if (bSock) bSock.join(gameId);
  const whiteUser = getUserById(white.uid);
  const blackUser = getUserById(black.uid);
  io.to(gameId).emit('match_found', {
    gameId,
    white: publicUser(whiteUser),
    black: publicUser(blackUser),
    mode: game.mode,
    tc,
    clock: clockSnapshotForStart(clock, parsed),
  });
}

function finishGame(io, game, override = {}) {
  if (game._ended) return;
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
  const whiteUser = getUserById(game.white);
  const blackUser = getUserById(game.black);
  let wd = 0, bd = 0;
  if (game.mode === 'ranked') {
    const whiteScore = isDraw ? 0.5 : (winnerId === game.white ? 1 : 0);
    wd = eloDelta(whiteUser.elo, blackUser.elo, whiteScore);
    bd = eloDelta(blackUser.elo, whiteUser.elo, 1 - whiteScore);
  }
  // Apply ELO updates + persist game record atomically so a crash can't leave
  // half-applied results.
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
function startRematch(io, gameId) {
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
  const wUser = getUserById(newWhiteUid);
  const bUser = getUserById(newBlackUid);
  if (!wUser || !bUser) return;
  // startGame randomizes colors internally, so pre-bias by passing the desired
  // White first and Black second is not enough. Force the order by giving
  // startGame two entries and overriding its randomization via fixed seats:
  // we pass them so a is White-intended; startGame still flips 50/50, so we
  // call a color-forced variant.
  startGameWithColors(io,
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

  startTeamGame(io, whiteMembers, blackMembers, matchedTc);
}

function startTeamGame(io, whiteMembers, blackMembers, tc = 'unlimited') {
  const gameId = newGameId();
  const chess = new Chess();
  const normTc = normalizeTc(tc);
  const parsed = parseTc(normTc);
  const clock = makeClock(parsed);
  const whiteByUid = {};
  const blackByUid = {};
  whiteMembers.forEach((m, i) => { whiteByUid[m.uid] = i; });
  blackMembers.forEach((m, i) => { blackByUid[m.uid] = i; });
  const whiteUsers = whiteMembers.map(m => getUserById(m.uid));
  const blackUsers = blackMembers.map(m => getUserById(m.uid));
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

function finishTeamGame(io, tg, override = {}) {
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

  // Apply the four elo_2v2 updates + persist game record atomically.
  try {
    db.transaction(() => {
      const update2v2 = db.prepare(`UPDATE users SET elo_2v2 = elo_2v2 + ?,
          wins_2v2 = wins_2v2 + ?, losses_2v2 = losses_2v2 + ?, draws_2v2 = draws_2v2 + ?
        WHERE id = ?`);
      for (const u of whiteUids) update2v2.run(wDelta, wWin, wLoss, wDraw, u);
      for (const u of blackUids) update2v2.run(bDelta, 1 - wWin - wDraw, 1 - wLoss - wDraw, wDraw, u);
      db.prepare(`INSERT INTO team_games (id, white_p1_id, white_p2_id, black_p1_id, black_p2_id,
                                          mode, result, winner_color, pgn,
                                          white_avg_elo_before, black_avg_elo_before,
                                          white_elo_delta, black_elo_delta,
                                          created_at, ended_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        tg.id, whiteUids[0], whiteUids[1], blackUids[0], blackUids[1],
        tg.mode, reason, winnerColor || null, chess.pgn(),
        wAvg, bAvg, wDelta, bDelta,
        tg.started, Date.now());
    })();
  } catch (e) {
    console.error('[team-game] persist failed', e);
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
