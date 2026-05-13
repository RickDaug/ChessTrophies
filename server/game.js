// In-memory game state + matchmaking + Socket.IO handlers.
import { Chess } from 'chess.js';
import crypto from 'crypto';
import { db, getUserById } from './db.js';

const activeGames = new Map();     // gameId -> { white, black, chess, mode, started }
const matchmakingQueue = new Map(); // userId -> { socketId, elo, joinedAt, mode }
const userSocket = new Map();      // userId -> socketId
const socketUser = new Map();      // socketId -> userId

function newGameId() { return 'g_' + crypto.randomBytes(6).toString('hex'); }

function eloDelta(a, b, score) {
  const K = 32;
  const exp = 1 / (1 + Math.pow(10, (b - a) / 400));
  return Math.round(K * (score - exp));
}

export function attachSocketHandlers(io, verifyToken) {
  io.on('connection', (socket) => {
    socket.on('auth', ({ token }) => {
      const payload = token ? verifyToken(token) : null;
      if (!payload) { socket.emit('auth_err', { error: 'Invalid token' }); return; }
      const user = getUserById(payload.uid);
      if (!user) { socket.emit('auth_err', { error: 'User missing' }); return; }
      socket.data.userId = user.id;
      userSocket.set(user.id, socket.id);
      socketUser.set(socket.id, user.id);
      socket.emit('auth_ok', { user: publicUser(user) });
    });

    // Skill-based matchmaking
    socket.on('mm_join', ({ mode }) => {
      const uid = socket.data.userId; if (!uid) return;
      const user = getUserById(uid);
      matchmakingQueue.set(uid, { socketId: socket.id, elo: user.elo, joinedAt: Date.now(), mode: mode || 'ranked' });
      tryMatchmake(io);
    });
    socket.on('mm_leave', () => {
      const uid = socket.data.userId;
      if (uid) matchmakingQueue.delete(uid);
    });

    // Game moves
    socket.on('move', ({ gameId, from, to, promotion }) => {
      const game = activeGames.get(gameId); if (!game) return;
      const uid = socket.data.userId;
      const playerColor = game.white === uid ? 'w' : game.black === uid ? 'b' : null;
      if (!playerColor) return;
      if (game.chess.turn() !== playerColor) return;
      const move = game.chess.move({ from, to, promotion: promotion || 'q' });
      if (!move) { socket.emit('illegal_move', { gameId, from, to }); return; }
      io.to(gameId).emit('move_made', { gameId, move, fen: game.chess.fen() });
      if (game.chess.isGameOver()) finishGame(io, game);
    });

    socket.on('resign', ({ gameId }) => {
      const game = activeGames.get(gameId); if (!game) return;
      const uid = socket.data.userId;
      const winner = game.white === uid ? game.black : game.white;
      finishGame(io, game, { reason: 'resignation', winnerId: winner });
    });

    socket.on('chat', ({ gameId, text }) => {
      const game = activeGames.get(gameId); if (!game) return;
      if (typeof text !== 'string' || text.length > 200) return;
      io.to(gameId).emit('chat', {
        from: socket.data.userId,
        text: text.replace(/[<>]/g, ''),
        at: Date.now()
      });
    });

    socket.on('disconnect', () => {
      const uid = socketUser.get(socket.id);
      if (uid) {
        matchmakingQueue.delete(uid);
        userSocket.delete(uid);
        socketUser.delete(socket.id);
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
  // Persist game record
  db.prepare(`INSERT INTO games (id, white_id, black_id, mode, result, winner_id, pgn,
                                 white_elo_before, black_elo_before, white_elo_delta, black_elo_delta,
                                 created_at, ended_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(game.id, game.white, game.black, game.mode, reason, winnerId, chess.pgn(),
         game.whiteEloBefore, game.blackEloBefore, wd, bd,
         game.started, Date.now());
  io.to(game.id).emit('game_over', {
    gameId: game.id,
    winnerId,
    reason,
    whiteDelta: wd,
    blackDelta: bd,
    pgn: chess.pgn(),
  });
  activeGames.delete(game.id);
}
