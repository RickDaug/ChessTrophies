// ChessTrophies main HTTP + WebSocket server.
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as IO } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import { signup, login, requireAuth, verifyToken } from './auth.js';
import { db, getUserById, topByMetric } from './db.js';
import { attachSocketHandlers } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = http.createServer(app);
const io = new IO(httpServer, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '256kb' }));

// Health
app.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// Auth
app.post('/api/auth/signup', async (req, res) => {
  try {
    const token = await signup(req.body || {});
    res.json({ token });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const token = await login(req.body || {});
    res.json({ token });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Profile
app.get('/api/me', requireAuth, (req, res) => {
  const u = req.user;
  res.json({
    id: u.id, username: u.username, email: u.email, region: u.region,
    elo: u.elo, wins: u.wins, losses: u.losses, draws: u.draws,
    currentStreak: u.current_streak, bestStreak: u.best_streak,
    invitesAccepted: u.invites_accepted, isPremium: !!u.is_premium,
  });
});

// Rankings (Top N by metric)
app.get('/api/rankings', (req, res) => {
  const metric = req.query.metric || 'elo';
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 5000);
  res.json({ metric, players: topByMetric(metric, limit) });
});

// Friends
app.get('/api/friends', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.elo, u.wins, u.losses, u.region, u.is_premium
    FROM friendships f JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ? ORDER BY u.username COLLATE NOCASE
  `).all(req.userId);
  res.json({ friends: rows });
});
app.post('/api/friends/add', requireAuth, (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  const friend = db.prepare('SELECT id, username FROM users WHERE LOWER(username) = LOWER(?)').get(username);
  if (!friend) return res.status(404).json({ error: 'No user with that username' });
  if (friend.id === req.userId) return res.status(400).json({ error: 'Cannot friend yourself' });
  try {
    const ins = db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)');
    ins.run(req.userId, friend.id, Date.now());
    ins.run(friend.id, req.userId, Date.now());
    res.json({ ok: true, friend });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Recent game history
app.get('/api/games/recent', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, white_id, black_id, mode, result, winner_id, pgn,
           white_elo_delta, black_elo_delta, created_at, ended_at
    FROM games
    WHERE white_id = ? OR black_id = ?
    ORDER BY ended_at DESC LIMIT 50
  `).all(req.userId, req.userId);
  res.json({ games: rows });
});

// Serve static client (optional — useful for one-command deploy)
const staticDir = path.join(__dirname, '..', 'public');
app.use(express.static(staticDir));

// WebSocket
attachSocketHandlers(io, verifyToken);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`ChessTrophies server listening on :${PORT}`);
});
