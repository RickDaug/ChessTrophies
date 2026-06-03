// In-memory game state + matchmaking + Socket.IO handlers.
import { Chess } from 'chess.js';
import crypto from 'crypto';
import { db, getUserById } from './db.js';

const activeGames = new Map();     // gameId -> { white, black, chess, mode, started }
const userActiveGame = new Map();  // uid -> gameId (1v1, mirrors userActiveTeamGame)
const matchmakingQueue = new Map(); // userId -> { socketId, elo, joinedAt, mode }
const userSocket = new Map();      // userId -> socketId
const socketUser = new Map();      // socketId -> userId
const chatBuckets = new Map();     // userId -> { tokens, lastRefill }
const mmBuckets = new Map();       // userId -> { tokens, lastRefill }

// --- 2v2 (team) state ---
const teamQueue = new Map();       // entryId -> { id, type:'solo'|'duo', members:[{uid,socketId,elo}], joinedAt }
const duoInvites = new Map();      // inviteId -> { hostId, hostSocketId, guestId, createdAt, expiresAt }
const activeTeamGames = new Map(); // gameId -> team game object (see startTeamGame)
const userActiveTeamGame = new Map(); // uid -> gameId (so we can find which game on resign/move)
const teamMmBuckets = new Map();   // uid -> token bucket

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

export function attachSocketHandlers(io, verifyToken) {
  io.on('connection', (socket) => {
    socket.on('auth', ({ token }) => {
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
    });

    // Skill-based matchmaking
    socket.on('mm_join', ({ mode }) => {
      const uid = socket.data.userId; if (!uid) return;
      if (!consumeBucket(mmBuckets, uid, 3, 0.2)) {
        socket.emit('rate_limited', { event: 'mm_join', retryInMs: 5000 });
        return;
      }
      const user = getUserById(uid);
      matchmakingQueue.set(uid, { socketId: socket.id, elo: user.elo, joinedAt: Date.now(), mode: typeof mode === 'string' ? mode : 'ranked' });
      tryMatchmake(io);
    });
    socket.on('mm_leave', () => {
      const uid = socket.data.userId;
      if (uid) matchmakingQueue.delete(uid);
    });

    // --- 2v2 team matchmaking ---
    socket.on('team_mm_join', ({ inviteId }) => {
      const uid = socket.data.userId; if (!uid) return;
      if (!consumeBucket(teamMmBuckets, uid, 3, 0.2)) {
        socket.emit('rate_limited', { event: 'team_mm_join', retryInMs: 5000 });
        return;
      }
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
    socket.on('move', ({ gameId, from, to, promotion }) => {
      const uid = socket.data.userId;
      if (!uid) return;
      // 2v2 first (more specific check)
      const tg = activeTeamGames.get(gameId);
      if (tg) { applyTeamMove(io, socket, tg, uid, { from, to, promotion }); return; }
      const game = activeGames.get(gameId); if (!game) return;
      const playerColor = game.white === uid ? 'w' : game.black === uid ? 'b' : null;
      if (!playerColor) return;
      if (game.chess.turn() !== playerColor) return;
      const move = game.chess.move({ from, to, promotion: promotion || 'q' });
      if (!move) { socket.emit('illegal_move', { gameId, from, to }); return; }
      io.to(gameId).emit('move_made', { gameId, move, fen: game.chess.fen() });
      if (game.chess.isGameOver()) finishGame(io, game);
    });

    socket.on('resign', ({ gameId }) => {
      const uid = socket.data.userId;
      if (!uid) return;
      const tg = activeTeamGames.get(gameId);
      if (tg) {
        const myTeam = teamOfUid(tg, uid);
        if (!myTeam) return;
        finishTeamGame(io, tg, { reason: 'resignation', winnerColor: myTeam === 'w' ? 'b' : 'w' });
        return;
      }
      const game = activeGames.get(gameId); if (!game) return;
      const winner = game.white === uid ? game.black : game.white;
      finishGame(io, game, { reason: 'resignation', winnerId: winner });
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

    socket.on('disconnect', () => {
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
        // Forfeit an active 1v1 game the user is in (opponent wins). Resolves the
        // game (records ELO) and frees the activeGames/userActiveGame entries.
        const oneVOneId = userActiveGame.get(uid);
        if (oneVOneId) {
          const game = activeGames.get(oneVOneId);
          if (game && !game._ended) {
            const winner = game.white === uid ? game.black : game.white;
            finishGame(io, game, { reason: 'disconnect', winnerId: winner });
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
      a.mode === b.mode
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
  const gameId = newGameId();
  const chess = new Chess();
  const game = {
    id: gameId,
    white: white.uid,
    black: black.uid,
    chess,
    mode: a.mode,
    started: Date.now(),
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
  });
}

function finishGame(io, game, override = {}) {
  if (game._ended) return;
  game._ended = true;
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
  const entries = [...teamQueue.values()]
    .filter(e => e.type !== 'duo' || e.members.length === 2)  // skip duos waiting for guest
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const picked = [];
  let total = 0;
  for (const e of entries) {
    if (total + e.members.length <= 4) {
      picked.push(e);
      total += e.members.length;
      if (total === 4) break;
    }
  }
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

  startTeamGame(io, whiteMembers, blackMembers);
}

function startTeamGame(io, whiteMembers, blackMembers) {
  const gameId = newGameId();
  const chess = new Chess();
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
  io.to(tg.id).emit('move_made', {
    gameId: tg.id,
    move,
    fen: tg.chess.fen(),
    turnCount: { w: tg.turnCount.w, b: tg.turnCount.b },
    nextSeat: tg.turnCount[tg.chess.turn()] % 2,
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
