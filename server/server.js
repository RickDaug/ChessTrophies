// ChessTrophies main HTTP + WebSocket server.
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import http from 'http';
import { Server as IO } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import { signup, login, requireAuth, verifyToken, requestPasswordReset, resetPassword, changePassword } from './auth.js';
import { assignGuestName, releaseGuestName, activeGuestCount } from './guest-names.js';
import { db, getUserById, topByMetric, getProgress, setProgress, searchUsersByUsername } from './db.js';
import { sendResetEmail } from './email.js';
import { attachSocketHandlers } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = http.createServer(app);

// Origins that must always be allowed to call the API, even if CORS_ORIGIN wasn't
// configured for them. Without these the WebView/browser blocks every cross-origin
// login + socket request:
//   - the hosted web site (Vercel) is a different origin from this backend (Railway);
//   - the native Capacitor app's WebView runs on a localhost scheme (https://localhost
//     on Android, capacitor://localhost on iOS) and is fully CORS-gated too.
const DEFAULT_WEB_ORIGINS = [
  'https://www.playchesstrophies.com',
  'https://playchesstrophies.com',
  'https://chesstrophies-production.up.railway.app',
  // Native app (Capacitor) WebView origins:
  'https://localhost',
  'capacitor://localhost',
  'http://localhost',
];

function parseCorsOrigins(value) {
  if (!value || value.trim() === '*') return '*';
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

let corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);
// Unless CORS is wide open ('*'), always union-in the production web origins so
// the hosted client works regardless of how CORS_ORIGIN is set in the env.
if (corsOrigins !== '*') {
  corsOrigins = Array.from(new Set([...corsOrigins, ...DEFAULT_WEB_ORIGINS]));
}
const io = new IO(httpServer, { cors: { origin: corsOrigins === '*' ? '*' : corsOrigins } });

// Horizontal scaling (multi-instance), gated on REDIS_URL. With it UNSET the
// server runs exactly as before: single instance, in-memory state. With it SET,
// Socket.IO broadcasts fan out across instances via the Redis adapter (pub/sub)
// and game/matchmaking state is shared in Redis (see game.js). This lets the
// backend run as multiple replicas. NOTE: across replicas, Socket.IO needs the
// websocket transport (or LB session affinity) so a connection stays on one
// instance; the client prefers websocket already.
let redisClient = null;
if (process.env.REDIS_URL) {
  const pub = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  const sub = pub.duplicate();
  for (const c of [pub, sub]) c.on('error', (e) => console.error('[redis]', e && e.message));
  io.adapter(createAdapter(pub, sub));
  redisClient = pub;
  console.log('[scale] multi-instance mode: Redis adapter + shared state enabled');
} else {
  console.log('[scale] single-instance mode (REDIS_URL not set)');
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many auth attempts. Please try again later.' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please slow down.' } });

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: corsOrigins }));
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
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = requireStringField(body, 'email', { min: 3, max: 254 });
    const password = requireStringField(body, 'password', { min: 1, max: 128 });
    const token = await login({ email, password });
    res.json({ token });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// Request a password-reset token. Always responds 200 so callers cannot use
// this endpoint to discover which emails have accounts (anti-enumeration).
app.post('/api/auth/forgot', authLimiter, async (req, res, next) => {
  try {
    const email = requireStringField(req.body || {}, 'email', { min: 3, max: 254 });
    const { token } = requestPasswordReset(email);
    if (token) {
      console.log('[password-reset] requested for', email);
      // Email the reset link via Resend when RESEND_API_KEY is configured.
      // sendResetEmail is best-effort and never throws. When email is NOT
      // configured (no API key) the devToken below can act as the fallback so
      // the reset flow can still be exercised end-to-end -- but ONLY when
      // EXPOSE_RESET_TOKEN=1 is explicitly set. We never key this off NODE_ENV
      // so a misconfigured production deploy can never leak a usable token.
      await sendResetEmail(email, token);
      const exposeToken = process.env.EXPOSE_RESET_TOKEN === '1';
      if (exposeToken) return res.json({ ok: true, devToken: token });
    }
    res.json({ ok: true });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// Consume a reset token and set a new password.
app.post('/api/auth/reset', authLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const token = requireStringField(body, 'token', { min: 1, max: 256 });
    const newPassword = requireStringField(body, 'newPassword', { min: 6, max: 128 });
    await resetPassword(token, newPassword);
    res.json({ ok: true });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// Change the password of the currently authenticated user.
app.post('/api/auth/change-password', authLimiter, requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const currentPassword = requireStringField(body, 'currentPassword', { min: 1, max: 128 });
    const newPassword = requireStringField(body, 'newPassword', { min: 6, max: 128 });
    await changePassword(req.userId, currentPassword, newPassword);
    res.json({ ok: true });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
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

// Username search for friend autocomplete. Returns up to `limit` (default 8,
// max 20) non-friend users whose username starts with `q` (case-insensitive),
// excluding the requester. Empty/blank `q` returns an empty list.
app.get('/api/users/search', requireAuth, (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 1) return res.json({ users: [] });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 20);
    const users = searchUsersByUsername(q, req.userId, limit);
    res.json({ users });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
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
  } catch (e) { if (!e.status) e.status = 400; next(e); }
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

// Learning-progress sync (survives across devices / web vs Android).
// Stored per-user in users.flags JSON under a `progress` key.
const MAX_LESSONS = 1000;
const MAX_LESSON_ID_LEN = 128;
const MAX_PUZZLE_KEYS = 5000;

app.get('/api/progress', requireAuth, (req, res, next) => {
  try {
    res.json(getProgress(req.user));
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

app.post('/api/progress', requireAuth, (req, res, next) => {
  try {
    const body = req.body || {};
    const existing = getProgress(req.user);

    // Merge lessonsCompleted: union + dedup. Accept short string ids only.
    const merged = new Set(existing.lessonsCompleted);
    if (body.lessonsCompleted !== undefined) {
      if (!Array.isArray(body.lessonsCompleted)) throw new Error('lessonsCompleted must be an array.');
      for (const id of body.lessonsCompleted) {
        if (typeof id !== 'string') throw new Error('lessonsCompleted ids must be strings.');
        const trimmed = id.trim();
        if (trimmed && trimmed.length <= MAX_LESSON_ID_LEN) merged.add(trimmed);
      }
    }
    if (merged.size > MAX_LESSONS) throw new Error(`Too many completed lessons (max ${MAX_LESSONS}).`);

    // Merge puzzle progress robustly so syncing from another device never erases
    // solves: deep-union the solved map (byId), take the max of numeric counters,
    // and let other scalar fields (e.g. dailyDate) take the incoming value.
    const puzzles = { ...existing.puzzles };
    if (body.puzzles !== undefined) {
      if (body.puzzles === null || typeof body.puzzles !== 'object' || Array.isArray(body.puzzles)) {
        throw new Error('puzzles must be an object.');
      }
      const inc = body.puzzles;
      const byId = { ...(existing.puzzles && existing.puzzles.byId) };
      if (inc.byId && typeof inc.byId === 'object' && !Array.isArray(inc.byId)) Object.assign(byId, inc.byId);
      const maxNum = (a, b) => Math.max(Number(a) || 0, Number(b) || 0);
      for (const k of Object.keys(inc)) {
        if (k === 'byId') continue;
        puzzles[k] = (k === 'solved' || k === 'best' || k === 'streak') ? maxNum(puzzles[k], inc[k]) : inc[k];
      }
      puzzles.byId = byId;
    }
    if (puzzles.byId && Object.keys(puzzles.byId).length > MAX_PUZZLE_KEYS) {
      throw new Error(`Too many puzzle entries (max ${MAX_PUZZLE_KEYS}).`);
    }

    const result = setProgress(req.userId, { lessonsCompleted: [...merged], puzzles });
    res.json(result);
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// Guest sessions: assign a goofy display name unique among active guests.
// Nothing is persisted -- the name lives only while the session is active.
app.post('/api/guest', (req, res) => {
  const name = assignGuestName();
  res.json({ username: name, isGuest: true, activeGuests: activeGuestCount() });
});

// Release a guest name back into the pool when the guest leaves.
app.post('/api/guest/release', (req, res) => {
  const name = req.body && req.body.username;
  releaseGuestName(name);
  res.json({ ok: true });
});

// Serve static client (optional — useful for one-command deploy)
const staticDir = path.join(__dirname, 'public');
app.use(express.static(staticDir));
app.get('/', (req, res) => res.sendFile(path.join(staticDir, 'index.html')));

app.use((err, req, res, next) => {
  console.error('[server]', err);
  const status = err.status || 500;
  // Surface friendly validation/auth messages for client errors (4xx);
  // hide unexpected server errors behind a generic message.
  const message = (status >= 400 && status < 500 && err.message) ? err.message : 'Internal server error';
  res.status(status).json({ error: message });
});

// WebSocket
attachSocketHandlers(io, verifyToken, redisClient);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`ChessTrophies server listening on :${PORT}`);
});
