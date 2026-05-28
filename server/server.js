// ChessTrophies main HTTP + WebSocket server.
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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

// --- CORS configuration ----------------------------------------------------
// Tighten the wide-open '*' default. In production set CORS_ORIGIN to the
// exact origin(s) of the deployed client (comma-separated for multiple).
// Example: CORS_ORIGIN="https://chesstrophies.com,https://www.chesstrophies.com"
const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
const corsOptions = allowedOrigins[0] === '*'
  ? { origin: '*' }
  : { origin: allowedOrigins, credentials: true };

const io = new IO(httpServer, { cors: corsOptions });

// --- Security middleware ---------------------------------------------------
// helmet sets a sensible default of security headers (HSTS, X-Frame-Options,
// X-Content-Type-Options, Referrer-Policy, etc.). We disable contentSecurityPolicy
// because the static client is served from the same origin and ships its own
// CSP via <meta http-equiv>. Re-enable here if/when the server stops serving
// the static client.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '256kb' }));

// --- Rate limiting on auth endpoints ---------------------------------------
// Prevents online brute-force on /api/auth/login and signup-spam. Tuned for
// human-realistic interaction; bumps from a single legit user are fine.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,                  // 20 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});
// Lighter limiter on general API endpoints (still useful against scrapers).
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 min
  max: 120,                 // 120 reqs/min/IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// Health (intentionally unrate-limited so uptime monitors don't get blocked)
app.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// Auth
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  try {
    const token = await signup(req.body || {});
    res.json({ token });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
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
  // Type/format validation — never trust req.body shape.
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username.' });
  }
  const friend = db.prepare('SELECT id, username FROM users WHERE LOWER(username) = LOWER(?)').get(username);
  if (!friend) return res.status(404).json({ error: 'No user with that username' });
  if (friend.id === req.userId) return res.status(400).json({ error: 'Cannot friend yourself' });
  try {
    const ins = db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)');
    ins.run(req.userId, friend.id, Date.now());
    ins.run(friend.id, req.userId, Date.now());
    res.json({ ok: true, friend });
  } catch (e) { res.status(500).json({ error: 'Could not add friend.' }); }
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
// Set SERVE_CLIENT=false to disable when client is on a separate origin.
if (process.env.SERVE_CLIENT !== 'false') {
  const staticDir = path.join(__dirname, '..', 'public');
  app.use(express.static(staticDir));
}

// WebSocket
attachSocketHandlers(io, verifyToken);

// --- Generic error handler -------------------------------------------------
// Catches any uncaught throw in routes. Prevents stack traces leaking to
// clients. Log internally; return a generic 500 to the caller.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error on', req.method, req.url, err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`ChessTrophies server listening on :${PORT}`);
  console.log(`  CORS_ORIGIN: ${allowedOrigins.join(', ')}`);
  console.log(`  SERVE_CLIENT: ${process.env.SERVE_CLIENT !== 'false'}`);
});
