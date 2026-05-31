// ChessTrophies main HTTP + WebSocket server.
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
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

function parseCorsOrigins(value) {
  if (!value || value.trim() === '*') return '*';
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);
const io = new IO(httpServer, { cors: { origin: corsOrigins === '*' ? '*' : corsOrigins } });

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many auth attempts. Please try again later.' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please slow down.' } });

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return apiLimiter(req, res, next);
  next();
});

// Health
app.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

function requireStringField(body, name, { min = 1, max = 255 } = {}) {
  const value = body[name];
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new Error(`${name} must be ${min} to ${max} characters.`);
  return trimmed;
}

// Auth
app.post('/api/auth/signup', authLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = requireStringField(body, 'email', { min: 3, max: 254 });
    const username = requireStringField(body, 'username', { min: 3, max: 20 });
    const password = requireStringField(body, 'password', { min: 6, max: 128 });
    const region = typeof body.region === 'string' ? body.region.trim().slice(0, 64) : '';
    const invitedBy = typeof body.invitedBy === 'string' && body.invitedBy.trim() ? body.invitedBy.trim().slice(0, 64) : null;
    const token = await signup({ email, username, password, region, invitedBy });
    res.json({ token });
  } catch (e) { next(e); }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = requireStringField(body, 'email', { min: 3, max: 254 });
    const password = requireStringField(body, 'password', { min: 1, max: 128 });
    const token = await login({ email, password });
    res.json({ token });
  } catch (e) { next(e); }
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
app.post('/api/friends/add', requireAuth, (req, res, next) => {
  try {
    const username = requireStringField(req.body || {}, 'username', { min: 1, max: 40 });
    const friend = db.prepare('SELECT id, username FROM users WHERE LOWER(username) = LOWER(?)').get(username);
    if (!friend) return res.status(404).json({ error: 'No user with that username' });
    if (friend.id === req.userId) return res.status(400).json({ error: 'Cannot friend yourself' });
    const ins = db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)');
    ins.run(req.userId, friend.id, Date.now());
    ins.run(friend.id, req.userId, Date.now());
    res.json({ ok: true, friend });
  } catch (e) { next(e); }
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
const staticDir = path.join(__dirname, 'public');
app.use(express.static(staticDir));
app.get('/', (req, res) => res.sendFile(path.join(staticDir, 'index.html')));

app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

// WebSocket
attachSocketHandlers(io, verifyToken);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`ChessTrophies server listening on :${PORT}`);
});
