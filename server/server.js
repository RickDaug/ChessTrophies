// ChessTrophies main HTTP + WebSocket server.
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import http from 'http';
import crypto from 'crypto';
import { Server as IO } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'node:fs';
import 'dotenv/config';

// Whether the Litestream binary made it into the image (build is best-effort).
// Surfaced on /health so a deploy can confirm backups infra is actually present.
const HAS_LITESTREAM = (() => { try { return existsSync('/usr/local/bin/litestream'); } catch (e) { return false; } })();

// Error tracking (Sentry) — env-gated like billing/push: lazy-imported so the
// server boots fine WITHOUT the dep, and inert unless SENTRY_DSN is set.
let Sentry = null;
async function initSentry() {
  if (!process.env.SENTRY_DSN) { console.log('[sentry] SENTRY_DSN not set — error tracking DISABLED'); return; }
  try {
    const mod = await import('@sentry/node');
    mod.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'production', tracesSampleRate: 0 });
    Sentry = mod;
    console.log('[sentry] error tracking ENABLED');
  } catch (e) { console.error('[sentry] init failed (continuing without it):', e && e.message); Sentry = null; }
}
function captureException(err) { try { if (Sentry) Sentry.captureException(err); } catch (e) {} }
await initSentry();

import { signup, login, requireAuth, verifyToken, requestPasswordReset, resetPassword, changePassword, deleteAccount, verifyEmailCode, resendEmailVerification } from './auth.js';
import { assignGuestName, releaseGuestName, activeGuestCount } from './guest-names.js';
// `db` is still imported directly only to close the SQLite handle on shutdown
// (no-op when running on Postgres); `getProgress` is a pure flags-JSON parser
// (identical on both backends). All other persistence goes through `store.*`.
import { db, getProgress } from './db.js';
import * as store from './store.js';
import { sendResetEmail, sendVerifyEmail, isEmailConfigured } from './email.js';
import { mountBilling, mountBillingWebhook, logBillingStatus, stripeRevenueStats } from './billing.js';
import { mountStore, logStoreStatus } from './entitlements.js';
import { mountPush, logPushStatus, sendPushToUser } from './push.js';
import { mountPuzzles } from './puzzles.js';
import { mountArena, startArenaScheduler, logArenaStatus, liveArena, arenaEnabled, recentChampions } from './arena.js';
import { startReengagementScheduler, logReengageStatus } from './reengage.js';
import { mountAnalytics, analyticsStats, logAnalyticsStatus } from './analytics.js';
import { mountClientErrors } from './client-errors.js';
import { geoFromReq } from './geo.js';
import { retentionCurves } from './cohorts.js';
import { mountChallenges } from './challenges.js';
import { mountLeagues } from './leagues.js';
import { attachSocketHandlers, notifyUser, getOnlineUserCount, seasonInfo, previousSeasonId } from './game.js';
import { botEngineReady, botEngineDiag } from './bot.js';
import { redisStoreOption } from './redis-rate-limit-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Constant-time admin-key check. Fail-closed when ADMIN_KEY is unset, and use
// crypto.timingSafeEqual (mirroring auth.js's email-code compare) so a wrong key
// can't be recovered byte-by-byte via response timing. timingSafeEqual throws on
// unequal-length buffers, so we gate on length first.
function adminKeyOk(provided) {
  const expected = process.env.ADMIN_KEY;
  if (!expected) return false; // fail closed: no key configured → forbidden
  const a = Buffer.from(String(provided), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const app = express();
const httpServer = http.createServer(app);

// Origins that must always be allowed to call the API, even if CORS_ORIGIN wasn't
// configured for them. Without these the WebView/browser blocks every cross-origin
// login + socket request:
//   - the hosted web site (Vercel) is a different origin from this backend (Railway);
//   - the native Capacitor app's WebView runs on a localhost scheme (https://localhost
//     on Android, capacitor://localhost on iOS) and is fully CORS-gated too.
// ── BACKEND ORIGIN: SOURCE-OF-TRUTH (CORS side) ─────────────────────────────
// The backend's own origin (the railway.app entry below) AND the web origins it
// trusts are duplicated across the stack and MUST stay in sync, or login/sockets
// silently break on a host change:
//   1. config.js BACKEND_URL — the client's API/socket target (one literal).
//   2. index.html CSP `connect-src` — allows https:// + wss:// of the backend.
//   3. THIS list — CORS allowlist (web origins allowed to call this backend) +
//      the backend's own origin.
// Migrating the backend host means updating ALL THREE. See config.js for the
// canonical note.
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
// Loud warning if CORS is wide open (or unset, which defaults to '*') while
// running in production — a wildcard origin lets any site call the API.
if (corsOrigins === '*' && process.env.NODE_ENV === 'production') {
  console.warn('[cors] WARNING: CORS_ORIGIN is unset or "*" in production — this allows requests from ANY origin. Set CORS_ORIGIN to your real domain(s).');
}
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

// Ranked play on/off — a seasonal switch via env. Ranked is now ON by default
// (RANKED play is live, with server-authoritative engine bot-backfill so a queuing
// player always gets a fair, clearly-labeled opponent even with no humans online).
// The env override still disables it: set RANKED_ENABLED=0 (or 'false') to turn
// ranked OFF. Read on each call so a test/deploy can flip it. This single flag
// gates the public /api/config response AND the server-side enforcement in the
// socket handlers (game.js reads it via the same parse), so the UI can't bypass it.
function rankedEnabled() {
  const v = String(process.env.RANKED_ENABLED ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return true; // default ON
}

// Escape hatch for load testing ONLY: when LOAD_TEST_NO_RATELIMIT=1 the auth/api
// limiters become no-ops so a harness can sign up many synthetic users from one
// IP. Off by default — never set this in production.
const RL_DISABLED = process.env.LOAD_TEST_NO_RATELIMIT === '1';
if (RL_DISABLED) console.warn('[ratelimit] DISABLED via LOAD_TEST_NO_RATELIMIT — do NOT use in production');
// SHARED rate-limit store: with REDIS_URL set the server runs as N replicas, so
// the default per-process MemoryStore would make every limit per-replica (a
// 20/15min auth cap becomes N×20 across replicas — a brute-force ceiling that
// scales WITH the fleet). Back the limiters with the EXISTING redis client when
// available so the limit is global; otherwise fall back to MemoryStore (single
// instance, unchanged behaviour). The store fails OPEN on a Redis hiccup, so a
// transient Redis problem degrades rate limiting but never 500s a request.
if (redisClient) console.log('[ratelimit] using shared Redis store (limits are global across replicas)');
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, skip: () => RL_DISABLED, message: { error: 'Too many auth attempts. Please try again later.' }, ...redisStoreOption(redisClient, 'rl:auth:') });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, skip: () => RL_DISABLED, message: { error: 'Too many requests. Please slow down.' }, ...redisStoreOption(redisClient, 'rl:api:') });
// Chat auto-translation proxies to an upstream (LibreTranslate); cap it tighter
// than the general API so a flood of chat can't hammer the upstream / our egress.
const translateLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, skip: () => RL_DISABLED, message: { error: 'Too many translation requests. Please slow down.' }, ...redisStoreOption(redisClient, 'rl:translate:') });

app.disable('x-powered-by');
// Behind Railway's (single) reverse proxy: trust the first hop so req.ip and the
// X-Forwarded-For header resolve to the real client. Without this, express-rate-limit
// throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR and can't key limits by client IP.
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: corsOrigins }));
// Stripe webhook MUST be registered BEFORE express.json() — signature
// verification requires the RAW request body (express.raw inside the route).
// CORS/helmet above still apply; the global JSON parser below does not touch it.
mountBillingWebhook(app);
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return apiLimiter(req, res, next);
  next();
});

// Health
// `durable` is the honest single-bit answer to "can this DB survive a redeploy?":
// true iff Postgres is the backend OR a Litestream replica is configured AND the
// binary is present. SQLite-on-ephemeral-storage with no replica = false.
app.get('/health', (req, res) => res.json({ ok: true, time: Date.now(), build: 'distribution-2026-06-09', litestream: HAS_LITESTREAM, backupsConfigured: !!process.env.LITESTREAM_REPLICA_URL, durable: store.usingPostgres || (HAS_LITESTREAM && !!process.env.LITESTREAM_REPLICA_URL), dbBackend: store.usingPostgres ? 'postgres' : 'sqlite', sentry: !!Sentry, pushConfigured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT), botReady: botEngineReady(), multiInstance: !!process.env.REDIS_URL, ...(req.query.diag ? { botDiag: botEngineDiag() } : {}) }));

// Public runtime config (NO auth). The client reads this to decide whether to
// show ranked matchmaking UI. Server enforcement is separate (socket handlers),
// so this is purely a hint — disabling ranked is enforced server-side regardless.
app.get('/api/config', (req, res) => res.json({ rankedEnabled: rankedEnabled() }));

// Stripe subscription billing JSON routes (config/checkout/portal). Registered
// after express.json() so req.body is parsed; the raw-body webhook is mounted
// above, before the JSON parser. Inert (503) until Stripe env vars are set.
mountBilling(app);

// Cosmetic STORE (themed piece-sets as a PREMIUM perk). Public catalog only —
// the sets are accessible while a user's premium subscription is active; the
// client gates equip on is_premium (from /api/me). No per-set purchase route.
mountStore(app);

// Interactive chess puzzles (daily challenge + trainer). Public daily/next
// routes + an auth-gated /solved that records progress via the store facade.
// Falls back to the bundled verified seed corpus when the puzzles table is empty.
mountPuzzles(app);

// Web Push re-engagement (subscribe/unsubscribe/test + config). Env-gated like
// billing/email: inert (503) until VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT are set.
mountPush(app);

// Arena tournaments — live time-boxed events with continuous pairing + a live
// leaderboard. Kill-switchable via ARENA_ENABLED (default on). Routes only here;
// the realtime pool/pairing + the finish-scoring hook live in game.js.
mountArena(app);

// Privacy-light product analytics — PUBLIC event ingest (guests fire events) at
// POST /api/events, rate-limited per visitor+IP. Powers the admin funnel/daily
// traffic block in /api/admin/stats. Backend-agnostic via the store facade.
mountAnalytics(app);

// Client-side error sink — PUBLIC (first-session crashes happen pre-auth + for
// guests), rate-limited per IP. Lands reports in the logs and forwards to Sentry
// (when configured) so a JS exception that white-screens a new visitor is no
// longer invisible. See server/client-errors.js.
mountClientErrors(app, {
  report: (info) => captureException(new Error(
    '[client] ' + info.message + (info.source ? ' @ ' + info.source + ':' + (info.line ?? '?') : '')
  )),
});

// Shareable "beat the Computer" challenge links — the growth loop. PUBLIC
// create/fetch/result (guests included), rate-limited. See server/challenges.js.
mountChallenges(app);

// Friend Leagues — private clubs with a join code + a members-only leaderboard.
// All routes require a real account (requireAuth). See server/leagues.js.
mountLeagues(app);

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
    // Derive coarse signup geo (country + region/state) from the IP — stored on
    // the user so the dashboard can show where registered players are from. The
    // raw IP is never stored.
    const geo = geoFromReq(req);
    const { token, verification } = await signup({ email, username, password, region, invitedBy, geo });
    // Email the 6-digit code (best-effort; no-op when RESEND isn't configured).
    let emailVerificationSent = false;
    if (verification) emailVerificationSent = await sendVerifyEmail(verification.email, verification.code);
    const out = { token, emailVerificationSent };
    // Same dev-fallback contract as password reset: only ever expose the code
    // when EXPOSE_VERIFY_TOKEN=1 is explicitly set (never keyed off NODE_ENV).
    if (process.env.EXPOSE_VERIFY_TOKEN === '1' && verification) out.devVerifyCode = verification.code;
    res.json(out);
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// Verify the signed-in user's email with the 6-digit code we emailed. Scoped to
// the authenticated user (a 6-digit code isn't globally unique) and throttled.
app.post('/api/auth/verify', authLimiter, requireAuth, async (req, res, next) => {
  try {
    const code = requireStringField(req.body || {}, 'code', { min: 4, max: 12 });
    await verifyEmailCode(req.userId, code);
    res.json({ ok: true });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// Re-send the verification code for the signed-in user (no-op if already verified).
app.post('/api/auth/resend-verification', authLimiter, requireAuth, async (req, res, next) => {
  try {
    const r = await resendEmailVerification(req.userId);
    if (r.alreadyVerified) return res.json({ ok: true, alreadyVerified: true });
    let sent = false;
    if (r.code) sent = await sendVerifyEmail(r.email, r.code);
    const out = { ok: true, sent };
    if (process.env.EXPOSE_VERIFY_TOKEN === '1' && r.code) out.devVerifyCode = r.code;
    res.json(out);
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    // Accept `{ identifier, password }` where identifier may be a username OR an
    // email. Stay backward-compatible with the legacy `{ email, password }` body
    // by treating `email` as the identifier when `identifier` is absent. We no
    // longer require the '@' email regex here (a username won't match it).
    const rawId = typeof body.identifier === 'string' ? body.identifier : body.email;
    const identifier = requireStringField({ identifier: rawId }, 'identifier', { min: 3, max: 254 });
    const password = requireStringField(body, 'password', { min: 1, max: 128 });
    const token = await login({ identifier, password });
    res.json({ token });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// Request a password-reset token. Always responds 200 so callers cannot use
// this endpoint to discover which emails have accounts (anti-enumeration).
app.post('/api/auth/forgot', authLimiter, async (req, res, next) => {
  try {
    const email = requireStringField(req.body || {}, 'email', { min: 3, max: 254 });
    const { token } = await requestPasswordReset(email);
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
    const r = await changePassword(req.userId, currentPassword, newPassword);
    // Return a fresh token (changePassword bumped token_version, revoking the old
    // one) so the client can keep THIS session signed in.
    res.json({ ok: true, token: (r && r.token) || undefined });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// Permanently delete the authenticated user's account. Requires the current
// password as confirmation; erases PII, revokes all sessions, and drops the
// social graph (the anonymized row is retained so game/leaderboard FKs stay valid).
app.post('/api/me/delete', authLimiter, requireAuth, async (req, res, next) => {
  try {
    const password = requireStringField(req.body || {}, 'password', { min: 1, max: 128 });
    await deleteAccount(req.userId, password);
    res.json({ ok: true });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// Profile. Note: themed cosmetic piece-sets are a PREMIUM perk now, so access is
// purely `isPremium` — there is no per-set ownership to return here.
app.get('/api/me', requireAuth, async (req, res, next) => {
  try {
    const u = req.user;
    res.json({
      id: u.id, username: u.username, email: u.email, region: u.region,
      elo: u.elo, wins: u.wins, losses: u.losses, draws: u.draws,
      currentStreak: u.current_streak, bestStreak: u.best_streak,
      invitesAccepted: u.invites_accepted, isPremium: !!u.is_premium,
      avatarStock: u.avatar_stock || 'av_knight', avatarDataUrl: u.avatar_data_url || '',
      emailVerified: !!u.email_verified,
      // Checkers ratings (additive; separate from the chess `elo` above).
      eloCheckers8: u.elo_checkers_8 ?? 1200, eloCheckers10: u.elo_checkers_10 ?? 1200,
      // Arena tournament titles won (durable counter, crowned at the bell).
      arenaWins: u.arena_wins || 0,
    });
  } catch (e) { next(e); }
});

// Public profile — a SAFE subset of any user (no email/token/customer ids), for
// the in-app profile viewer reached from rankings/friends. Public on purpose: it
// exposes only what the leaderboard already does (name/region/rating/record) plus
// the user's earned trophies + pinned showcase. Rate-limited by the global limiter.
app.get('/api/users/:id/profile', async (req, res, next) => {
  try {
    const id = String(req.params.id || '');
    if (!id) { res.status(400).json({ error: 'Missing user id.' }); return; }
    const u = await store.getUserById(id);
    if (!u) { res.status(404).json({ error: 'User not found.' }); return; }
    let achievements = [], streakTrophies = [];
    try { const a = JSON.parse(u.achievements || '[]'); if (Array.isArray(a)) achievements = a; } catch (e) {}
    try { const s = JSON.parse(u.streak_trophies || '[]'); if (Array.isArray(s)) streakTrophies = s; } catch (e) {}
    const progress = store.getProgress(u); // { lessonsCompleted, puzzles, showcase }
    res.json({
      id: u.id, username: u.username, region: u.region || '',
      elo: u.elo, wins: u.wins, losses: u.losses, draws: u.draws,
      bestStreak: u.best_streak, isPremium: !!u.is_premium,
      avatarStock: u.avatar_stock || 'av_knight', avatarDataUrl: u.avatar_data_url || '',
      arenaWins: u.arena_wins || 0,
      trophyPoints: u.trophy_points || 0,
      trophyCount: achievements.length + streakTrophies.length,
      streakTrophyCount: streakTrophies.length,
      // Earned achievement ids (+ counts) so the client renders the showcase/case.
      achievements: achievements.map(a => ({ id: a.id, count: (a.count != null ? a.count : 1) })).filter(a => a.id),
      showcase: Array.isArray(progress.showcase) ? progress.showcase.slice(0, 5) : [],
      memberSince: u.created_at || 0,
    });
  } catch (e) { next(e); }
});

// Persist the player's chosen avatar so opponents can see it in-game. Both fields
// are optional; data URLs are size-capped to avoid bloating the row.
app.post('/api/profile/avatar', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const stock = typeof body.avatarStock === 'string' ? body.avatarStock.slice(0, 32) : null;
    let dataUrl = typeof body.avatarDataUrl === 'string' ? body.avatarDataUrl : null;
    if (dataUrl && dataUrl.length > 200000) return res.status(413).json({ error: 'Avatar image too large.' });
    // This value is echoed to opponents in-game, so only accept genuine base64
    // image data URLs (no SVG/HTML/javascript: payloads). Empty string is allowed
    // (clears the custom avatar); non-empty must match the strict prefix + charset.
    if (dataUrl) {
      if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)) {
        return res.status(400).json({ error: 'Invalid avatar image format.' });
      }
    }
    if (stock !== null) await store.run('UPDATE users SET avatar_stock = ? WHERE id = ?', [stock, req.userId]);
    if (dataUrl !== null) await store.run('UPDATE users SET avatar_data_url = ? WHERE id = ?', [dataUrl, req.userId]);
    res.json({ ok: true });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// Rankings (Top N by metric)
app.get('/api/rankings', async (req, res, next) => {
  try {
    const metric = req.query.metric || 'elo';
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 5000);
    res.json({ metric, players: await store.topByMetric(metric, limit) });
  } catch (e) { if (!e.status) e.status = 500; next(e); }
});

// --- Victim Wall / revenge loop --------------------------------------------
// PUBLIC "Most Feared" board: the top ACTIVE win streaks (users.current_streak),
// each with the winner's username + their most recent victim names. Server-side
// recorded (see game.js recordVictimAndNotify) so it never depends on a client.
// Mirrors the /api/rankings query style (parameterized, backend-agnostic facade).
app.get('/api/feared', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    // Top active streakers. current_streak > 0 = a live, unbroken win streak.
    const leaders = await store.all(
      `SELECT id, username, current_streak, best_streak, elo, is_premium
       FROM users
       WHERE current_streak > 0
       ORDER BY current_streak DESC, best_streak DESC, elo DESC
       LIMIT ?`,
      [limit]
    );
    // Attach each leader's recent victim names (most recent first, capped).
    const players = [];
    for (const u of leaders) {
      let victims = [];
      try {
        const rows = await store.all(
          `SELECT victim_name, streak_len, created_at
           FROM streak_victims
           WHERE winner_id = ?
           ORDER BY created_at DESC
           LIMIT 5`,
          [u.id]
        );
        victims = rows.map(r => ({
          name: r.victim_name || 'a challenger',
          streakLen: Number(r.streak_len) || 0,
        }));
      } catch (e) { /* a leader with no victim rows just shows an empty list */ }
      players.push({
        id: u.id,
        username: u.username,
        currentStreak: Number(u.current_streak) || 0,
        bestStreak: Number(u.best_streak) || 0,
        elo: Number(u.elo) || 0,
        isPremium: !!u.is_premium,
        recentVictims: victims,
      });
    }
    res.json({ players });
  } catch (e) { if (!e.status) e.status = 500; next(e); }
});

// AUTH: the caller's own victim list — who beat THEM during a streak (so they
// can see "get revenge?" targets). Most recent first.
app.get('/api/me/victims', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const rows = await store.all(
      `SELECT v.winner_id, u.username AS winner_name, u.current_streak,
              v.streak_len, v.created_at
       FROM streak_victims v
       LEFT JOIN users u ON u.id = v.winner_id
       WHERE v.victim_id = ?
       ORDER BY v.created_at DESC
       LIMIT ?`,
      [req.userId, limit]
    );
    const victims = rows.map(r => ({
      winnerId: r.winner_id,
      winnerName: r.winner_name || 'a rival',
      winnerCurrentStreak: Number(r.current_streak) || 0,
      streakLen: Number(r.streak_len) || 0,
      at: Number(r.created_at) || 0,
    }));
    res.json({ victims });
  } catch (e) { if (!e.status) e.status = 500; next(e); }
});

// --- SEASONS (monthly competitive ladder) ----------------------------------
// PUBLIC season snapshot: the current season id/name, when it ends (so the
// client can render a "season ends in N days" countdown from `endsAt` without
// its own clock quirks), the top-N leaderboard (by points then peak_elo), and —
// for end-of-season recognition v1 — last season's champion if there is one.
// Season performance is tracked SEPARATELY from the live ELO ladder (see
// game.js recordSeasonResult). Mirrors the /api/rankings + /api/feared style.
app.get('/api/season', async (req, res, next) => {
  try {
    const info = seasonInfo();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const rows = await store.seasonLeaderboard(info.seasonId, limit);
    const leaderboard = rows.map((r, i) => ({
      rank: i + 1,
      userId: r.user_id,
      username: r.username,
      points: Number(r.points) || 0,
      wins: Number(r.wins) || 0,
      losses: Number(r.losses) || 0,
      draws: Number(r.draws) || 0,
      peakElo: Number(r.peak_elo) || 0,
      elo: Number(r.elo) || 0,
      premium: !!r.is_premium,
    }));
    // End-of-season recognition v1: surface the PRIOR season's champion if any.
    // (Full reward distribution can be a later cron — this just shows the name.)
    let lastSeasonChampion = null;
    try {
      const champ = await store.seasonChampion(previousSeasonId());
      if (champ) {
        lastSeasonChampion = {
          username: champ.username,
          points: Number(champ.points) || 0,
          premium: !!champ.is_premium,
        };
      }
    } catch (e) { /* no prior champion -> omit */ }
    res.json({
      seasonId: info.seasonId,
      name: info.name,
      endsAt: info.endsAt,
      startsAt: info.startsAt,
      daysRemaining: info.daysRemaining,
      leaderboard,
      lastSeasonChampion,
    });
  } catch (e) { if (!e.status) e.status = 500; next(e); }
});

// AUTH: the caller's own current-season standing (points + W-L-D + rank).
// Returns nulls (rank null, zeroed counters) when they haven't played a ranked
// game this season yet.
app.get('/api/season/me', requireAuth, async (req, res, next) => {
  try {
    const info = seasonInfo();
    const me = await store.seasonStatsForUser(info.seasonId, req.userId);
    res.json({
      seasonId: info.seasonId,
      name: info.name,
      endsAt: info.endsAt,
      daysRemaining: info.daysRemaining,
      points: me ? Number(me.points) || 0 : 0,
      wins: me ? Number(me.wins) || 0 : 0,
      losses: me ? Number(me.losses) || 0 : 0,
      draws: me ? Number(me.draws) || 0 : 0,
      peakElo: me ? Number(me.peak_elo) || 0 : 0,
      rank: me ? me.rank : null,
    });
  } catch (e) { if (!e.status) e.status = 500; next(e); }
});

// Username search for friend autocomplete. Returns up to `limit` (default 8,
// max 20) non-friend users whose username starts with `q` (case-insensitive),
// excluding the requester. Empty/blank `q` returns an empty list.
app.get('/api/users/search', requireAuth, async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 1) return res.json({ users: [] });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 20);
    const users = await store.searchUsersByUsername(q, req.userId, limit);
    res.json({ users });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// Friends
app.get('/api/friends', requireAuth, async (req, res, next) => {
  try {
    const rows = await store.all(`
      SELECT u.id, u.username, u.elo, u.wins, u.losses, u.region, u.is_premium
      FROM friendships f JOIN users u ON u.id = f.friend_id
      WHERE f.user_id = ? ORDER BY u.username COLLATE NOCASE
    `, [req.userId]);
    res.json({ friends: rows });
  } catch (e) { if (!e.status) e.status = 500; next(e); }
});
// Helper: make two users friends (both directions) and clear any pending requests
// between them. Used by accept and by the auto-accept-on-mutual-request path.
async function makeFriends(aId, bId) {
  const now = Date.now();
  const ins = 'INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)';
  await store.run(ins, [aId, bId, now]);
  await store.run(ins, [bId, aId, now]);
  await store.run(
    'DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)',
    [aId, bId, bId, aId]);
}

// Send a friend REQUEST (not an instant add). The recipient must accept it.
// If they had already requested you, this accepts that instead (mutual intent).
app.post('/api/friends/add', requireAuth, async (req, res, next) => {
  try {
    const username = requireStringField(req.body || {}, 'username', { min: 1, max: 40 });
    const friend = await store.get('SELECT id, username FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (!friend) return res.status(404).json({ error: 'No user with that username' });
    if (friend.id === req.userId) return res.status(400).json({ error: 'Cannot friend yourself' });
    if (await store.areBlocked(req.userId, friend.id)) return res.status(403).json({ error: 'Unable to add this user.' });
    // Already friends?
    const already = await store.get('SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?', [req.userId, friend.id]);
    if (already) return res.json({ ok: true, alreadyFriends: true, friend });
    // They already requested ME -> accept it now (becomes mutual).
    const reverse = await store.get('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?', [friend.id, req.userId]);
    if (reverse) {
      await makeFriends(req.userId, friend.id);
      notifyUser(friend.id, 'friend_accepted', { by: req.userId });
      return res.json({ ok: true, accepted: true, friend });
    }
    // Otherwise record a pending request and notify the recipient if online.
    await store.run('INSERT OR IGNORE INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)',
      [req.userId, friend.id, Date.now()]);
    notifyUser(friend.id, 'friend_request', {
      from: { id: req.userId, username: req.user.username, elo: req.user.elo },
    });
    res.json({ ok: true, requested: true, friend });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// Incoming pending friend requests (people who asked to befriend me).
app.get('/api/friends/requests', requireAuth, async (req, res, next) => {
  try {
    const rows = await store.all(`
      SELECT u.id, u.username, u.elo, fr.created_at
      FROM friend_requests fr JOIN users u ON u.id = fr.from_id
      WHERE fr.to_id = ? ORDER BY fr.created_at DESC
    `, [req.userId]);
    res.json({ requests: rows });
  } catch (e) { if (!e.status) e.status = 500; next(e); }
});

// Accept a pending request from `fromId`.
app.post('/api/friends/accept', requireAuth, async (req, res, next) => {
  try {
    const fromId = requireStringField(req.body || {}, 'fromId', { min: 1, max: 64 });
    const pending = await store.get('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?', [fromId, req.userId]);
    if (!pending) return res.status(404).json({ error: 'No such request.' });
    await makeFriends(req.userId, fromId);
    notifyUser(fromId, 'friend_accepted', { by: req.userId, username: req.user.username });
    const friend = await store.get('SELECT id, username, elo, wins, losses, region, is_premium FROM users WHERE id = ?', [fromId]);
    res.json({ ok: true, friend });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// Decline / dismiss a pending request from `fromId`.
app.post('/api/friends/decline', requireAuth, async (req, res, next) => {
  try {
    const fromId = requireStringField(req.body || {}, 'fromId', { min: 1, max: 64 });
    await store.run('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?', [fromId, req.userId]);
    res.json({ ok: true });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// Block a user: removes any friendship + pending requests both ways, and records
// the block. Blocked pairs are never matched and can't friend-request each other.
app.post('/api/friends/block', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    let target = null;
    if (typeof body.userId === 'string' && body.userId) target = await store.getUserById(body.userId);
    else if (typeof body.username === 'string' && body.username)
      target = await store.get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [body.username]);
    if (!target) return res.status(404).json({ error: 'No such user.' });
    if (target.id === req.userId) return res.status(400).json({ error: 'Cannot block yourself.' });
    await store.run('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
      [req.userId, target.id, Date.now()]);
    await store.run('DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [req.userId, target.id, target.id, req.userId]);
    await store.run('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)',
      [req.userId, target.id, target.id, req.userId]);
    res.json({ ok: true, blocked: { id: target.id, username: target.username } });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

app.post('/api/friends/unblock', requireAuth, async (req, res, next) => {
  try {
    const userId = requireStringField(req.body || {}, 'userId', { min: 1, max: 64 });
    await store.run('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [req.userId, userId]);
    res.json({ ok: true });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

app.get('/api/friends/blocked', requireAuth, async (req, res, next) => {
  try {
    const rows = await store.all(`
      SELECT u.id, u.username, u.elo FROM blocks b JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = ? ORDER BY u.username COLLATE NOCASE
    `, [req.userId]);
    res.json({ blocked: rows });
  } catch (e) { if (!e.status) e.status = 500; next(e); }
});

// Recent game history
app.get('/api/games/recent', requireAuth, async (req, res, next) => {
  try {
    const rows = await store.all(`
      SELECT id, white_id, black_id, mode, result, winner_id, pgn,
             white_elo_delta, black_elo_delta, created_at, ended_at
      FROM games
      WHERE white_id = ? OR black_id = ?
      ORDER BY ended_at DESC LIMIT 50
    `, [req.userId, req.userId]);
    res.json({ games: rows });
  } catch (e) { if (!e.status) e.status = 500; next(e); }
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

app.post('/api/progress', requireAuth, async (req, res, next) => {
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
    // and let any other scalar fields take the incoming value.
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

    // Profile trophy showcase: ≤5 short string ids (validated again in the store).
    let showcase;
    if (body.showcase !== undefined) {
      if (!Array.isArray(body.showcase)) throw new Error('showcase must be an array.');
      showcase = body.showcase.filter(x => typeof x === 'string' && x.length <= 40).slice(0, 5);
    }
    // Trophy leaderboard fields (client-authoritative). Forwarded to the store,
    // which persists them into the achievements/streak_trophies/trophy_points
    // columns. Bounded here; the store validates again.
    let achievements, streakTrophies, trophyPoints;
    if (body.achievements !== undefined) {
      if (!Array.isArray(body.achievements)) throw new Error('achievements must be an array.');
      achievements = body.achievements.filter(a => a && typeof a === 'object' && typeof a.id === 'string').slice(0, 2000);
    }
    if (body.streakTrophies !== undefined) {
      if (!Array.isArray(body.streakTrophies)) throw new Error('streakTrophies must be an array.');
      streakTrophies = body.streakTrophies.slice(0, 2000);
    }
    if (body.trophyPoints !== undefined) {
      if (!Number.isFinite(body.trophyPoints)) throw new Error('trophyPoints must be a number.');
      trophyPoints = body.trophyPoints;
    }
    // Appearance theme (board/piece) — short identifier strings, follow the account.
    let themeBoard, themePieces;
    if (body.themeBoard !== undefined) {
      if (typeof body.themeBoard !== 'string') throw new Error('themeBoard must be a string.');
      themeBoard = body.themeBoard.slice(0, 32);
    }
    if (body.themePieces !== undefined) {
      if (typeof body.themePieces !== 'string') throw new Error('themePieces must be a string.');
      themePieces = body.themePieces.slice(0, 32);
    }
    // Preferred UI language (short ISO code) — follows the account across devices.
    let language;
    if (body.language !== undefined) {
      if (typeof body.language !== 'string') throw new Error('language must be a string.');
      language = body.language.slice(0, 8);
    }
    const result = await store.setProgress(req.userId, { lessonsCompleted: [...merged], puzzles, showcase, achievements, streakTrophies, trophyPoints, themeBoard, themePieces, language });
    res.json(result);
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// CHAT AUTO-TRANSLATION — server-side proxy to a LibreTranslate instance so the
// upstream URL/key stay server-side (no CORS, cacheable, abuse-limited). ENV-GATED:
// inert until LIBRETRANSLATE_URL is set, in which case it returns the text
// UNCHANGED with { translated:false, disabled:true } so the chat just shows the
// original — the feature degrades gracefully instead of erroring. Auth-gated
// (chat is between signed-in players) + its own tight rate limit.
//   POST /api/translate { q, source?, target } -> { translatedText, translated, ... }
app.post('/api/translate', translateLimiter, requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const q = typeof body.q === 'string' ? body.q : '';
    const target = typeof body.target === 'string' ? body.target.replace(/[^a-zA-Z-]/g, '').slice(0, 8) : '';
    const source = (typeof body.source === 'string' && body.source) ? body.source.replace(/[^a-zA-Z-]/g, '').slice(0, 8) : 'auto';
    if (!q.trim() || !target) return res.status(400).json({ error: 'q and target are required.' });
    if (q.length > 500) return res.status(400).json({ error: 'Text too long (max 500 chars).' });
    // Nothing to do when the source equals the target (or when there's no upstream).
    if (source !== 'auto' && source === target) return res.json({ translatedText: q, translated: false });
    const url = process.env.LIBRETRANSLATE_URL;
    if (!url) return res.json({ translatedText: q, translated: false, disabled: true });
    const payload = { q, source, target, format: 'text' };
    if (process.env.LIBRETRANSLATE_API_KEY) payload.api_key = process.env.LIBRETRANSLATE_API_KEY;
    const r = await fetch(url.replace(/\/+$/, '') + '/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return res.json({ translatedText: q, translated: false, error: 'upstream' });
    const j = await r.json().catch(() => ({}));
    const out = (j && typeof j.translatedText === 'string') ? j.translatedText : q;
    return res.json({ translatedText: out, translated: out !== q, detected: j && j.detectedLanguage });
  } catch (e) {
    // Never fail the chat over a translation hiccup — return the original text.
    return res.json({ translatedText: (req.body && req.body.q) || '', translated: false, error: 'fail' });
  }
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

// --- Social-share tracking -------------------------------------------------
// Public (no auth), rate-limited by the global apiLimiter. The client pings this
// when a user shares the game so the admin dashboard can see which platform is
// used most. Anything outside the allowlist is bucketed as 'other'. Stored as an
// idempotent per-platform counter (share_counts table) via the store facade.
const SHARE_PLATFORMS = new Set(['x', 'facebook', 'whatsapp', 'reddit', 'telegram', 'copy', 'native', 'other']);
app.post('/api/share/track', async (req, res, next) => {
  try {
    const raw = typeof (req.body && req.body.platform) === 'string' ? req.body.platform.trim().toLowerCase() : '';
    const platform = SHARE_PLATFORMS.has(raw) ? raw : 'other';
    await store.incShareCount(platform);
    res.json({ ok: true, platform });
  } catch (e) { if (!e.status) e.status = 400; next(e); }
});

// --- Admin stats -----------------------------------------------------------
// Lightweight usage dashboard data. Gated by the ADMIN_KEY env var (passed as
// ?key= or the x-admin-key header). Disabled (403) when ADMIN_KEY is unset, so
// it's never exposed by accident. Works on either DB backend via the store facade.
app.get('/api/admin/stats', async (req, res, next) => {
  try {
    const provided = req.get('x-admin-key') || req.query.key || '';
    if (!adminKeyOk(provided)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const now = Date.now();
    const DAY = 86400000;
    // Rolling window (days) for the windowed blocks (analytics funnel/geo/sources,
    // games-by-hour). Presets on the dashboard pass ?days=7|30|90|365.
    const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 30));
    const n = async (sql, p = []) => { const r = await store.get(sql, p); return r ? Number(r.n) : 0; };
    const stats = {
      totalUsers:     await n('SELECT COUNT(*) AS n FROM users'),
      verifiedUsers:  await n('SELECT COUNT(*) AS n FROM users WHERE email_verified = 1'),
      premiumUsers:   await n('SELECT COUNT(*) AS n FROM users WHERE is_premium = 1'),
      newUsers24h:    await n('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', [now - DAY]),
      newUsers7d:     await n('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', [now - 7 * DAY]),
      newUsers30d:    await n('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', [now - 30 * DAY]),
      activeUsers24h: await n('SELECT COUNT(*) AS n FROM users WHERE last_seen > ?', [now - DAY]),
      activeUsers7d:  await n('SELECT COUNT(*) AS n FROM users WHERE last_seen > ?', [now - 7 * DAY]),
      onlineNow:      getOnlineUserCount(),
      gamesTotal:     (await n('SELECT COUNT(*) AS n FROM games')) + (await n('SELECT COUNT(*) AS n FROM team_games')),
      games24h:       await n('SELECT COUNT(*) AS n FROM games WHERE created_at > ?', [now - DAY]),
      serverTime:     now,
    };
    // Social-share counts by platform. A stable object is preferred so the admin
    // page can render every bucket even at 0; total is the sum.
    const PLATFORMS = ['x', 'facebook', 'whatsapp', 'reddit', 'telegram', 'copy', 'native', 'other'];
    const byPlatform = {};
    for (const p of PLATFORMS) byPlatform[p] = 0;
    let shareTotal = 0;
    const shareRows = await store.all('SELECT platform, count FROM share_counts');
    for (const row of (shareRows || [])) {
      const p = String(row.platform);
      const c = Number(row.count) || 0;
      byPlatform[p] = (byPlatform[p] || 0) + c; // tolerate unexpected legacy keys
      shareTotal += c;
    }
    stats.shares = { total: shareTotal, byPlatform };

    // Subscription revenue rollups (Stripe billing). Computed from the payments
    // ledger via the store facade so it works on either DB backend. Zeros when
    // no payments have been recorded (e.g. before billing is configured).
    try {
      const rev = await store.revenueStats();
      stats.revenueMonthCents   = Number(rev.monthCents) || 0;
      stats.revenueYearCents    = Number(rev.yearCents) || 0;
      stats.revenueAllTimeCents = Number(rev.allTimeCents) || 0;
      stats.activeSubscribers   = Number(rev.activeSubscribers) || 0;
      stats.currency            = rev.currency || 'usd';
    } catch (e) {
      console.error('[admin] revenueStats failed:', e && e.message ? e.message : e);
      stats.revenueMonthCents = 0; stats.revenueYearCents = 0; stats.revenueAllTimeCents = 0;
      stats.activeSubscribers = 0; stats.currency = 'usd';
    }

    // Accurate revenue straight from Stripe (source of truth) — immune to any
    // local-ledger double-counting. Preferred for the dashboard; falls back to
    // the ledger numbers above if Stripe is unavailable.
    try {
      const sr = await stripeRevenueStats();
      stats.revenue = sr;
      stats.revenueAllTimeCents = sr.allTimeCents;
      stats.revenueMonthCents   = sr.monthCents;
      stats.revenueYearCents    = sr.yearCents;
      stats.activeSubscribers   = sr.activeSubscribers;
      stats.currency            = sr.currency;
    } catch (e) {
      stats.revenue = {
        source: 'ledger', currency: stats.currency || 'usd',
        allTimeCents: stats.revenueAllTimeCents || 0,
        monthCents: stats.revenueMonthCents || 0,
        yearCents: stats.revenueYearCents || 0,
        mrrCents: 0, activeSubscribers: stats.activeSubscribers || 0, arpuCents: 0,
        recentPayments: [], dailyCents: [],
      };
    }

    // Engagement time-series for the dashboard charts (last 30 days). Portable
    // SQL (just created_at); bucketed by UTC day in JS so it works on either DB.
    stats.series = {
      signupsDaily: await dailyCountSeries('users', 30),
      gamesDaily:   await dailyCountSeries('games', 30),
    };

    // --- Games breakdown (ranked vs casual, human-vs-human) -----------------
    // Bot games write NO games row by design, so `ranked` here is human ranked
    // volume only. Each block is failure-isolated so an empty/missing table can
    // never 500 this endpoint.
    try {
      stats.gamesBreakdown = {
        ranked: await n("SELECT COUNT(*) AS n FROM games WHERE mode = ?", ['ranked']),
        casual: await n("SELECT COUNT(*) AS n FROM games WHERE mode = ?", ['casual']),
      };
    } catch (e) { stats.gamesBreakdown = { ranked: 0, casual: 0 }; }

    // --- Current season ladder (monthly) ------------------------------------
    // season_id is the UTC year-month; standings are points DESC then peak_elo.
    try {
      const seasonId = new Date().toISOString().slice(0, 7); // "YYYY-MM"
      const players = await n('SELECT COUNT(*) AS n FROM season_stats WHERE season_id = ?', [seasonId]);
      const rows = await store.all(
        `SELECT u.username AS username, s.points AS points, s.wins AS wins, s.losses AS losses, s.draws AS draws
           FROM season_stats s JOIN users u ON u.id = s.user_id
          WHERE s.season_id = ?
          ORDER BY s.points DESC, s.peak_elo DESC
          LIMIT 8`,
        [seasonId]
      );
      stats.season = {
        seasonId,
        players,
        top: (rows || []).map(r => ({
          username: r.username || '—',
          points: Number(r.points) || 0,
          wins: Number(r.wins) || 0,
          losses: Number(r.losses) || 0,
          draws: Number(r.draws) || 0,
        })),
      };
    } catch (e) { stats.season = { seasonId: new Date().toISOString().slice(0, 7), players: 0, top: [] }; }

    // --- Most feared (Victim Wall) ------------------------------------------
    // Total victims recorded + the current top live streaks.
    try {
      const totalVictims = await n('SELECT COUNT(*) AS n FROM streak_victims');
      const rows = await store.all(
        `SELECT username, current_streak AS streak FROM users
          WHERE current_streak > 0
          ORDER BY current_streak DESC
          LIMIT 8`
      );
      stats.feared = {
        totalVictims,
        top: (rows || []).map(r => ({ username: r.username || '—', streak: Number(r.streak) || 0 })),
      };
    } catch (e) { stats.feared = { totalVictims: 0, top: [] }; }

    // --- Puzzle rating / Rush -----------------------------------------------
    try {
      const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
      const avgRow = await store.get('SELECT AVG(rating) AS a FROM puzzle_ratings');
      stats.puzzleStats = {
        avgRating:   avgRow && avgRow.a != null ? Math.round(Number(avgRow.a)) : 0,
        players:     await n('SELECT COUNT(*) AS n FROM puzzle_ratings'),
        totalSolved: await n('SELECT COUNT(*) AS n FROM puzzle_solves'),
        solvedToday: await n('SELECT COUNT(*) AS n FROM puzzle_solves WHERE day_key = ?', [today]),
        rushPlays:   await n('SELECT COUNT(*) AS n FROM rush_scores'),
        rushBest:    Number((await store.get('SELECT MAX(score) AS m FROM rush_scores') || {}).m) || 0,
      };
    } catch (e) { stats.puzzleStats = { avgRating: 0, players: 0, totalSolved: 0, solvedToday: 0, rushPlays: 0, rushBest: 0 }; }

    // --- Web Push reach -----------------------------------------------------
    try {
      stats.pushStats = {
        subscriptions: await n('SELECT COUNT(*) AS n FROM push_subscriptions'),
        subscribers:   await n('SELECT COUNT(DISTINCT user_id) AS n FROM push_subscriptions'),
      };
    } catch (e) { stats.pushStats = { subscriptions: 0, subscribers: 0 }; }

    // --- Arena tournaments ---------------------------------------------------
    try {
      const live = await liveArena().catch(() => null);
      let liveSummary = null;
      if (live) {
        const players = await n('SELECT COUNT(*) AS n FROM arena_scores WHERE arena_id = ?', [live.id]);
        liveSummary = { name: live.name, players, endsAt: Number(live.ends_at) };
      }
      stats.arena = {
        enabled: arenaEnabled(),
        live: liveSummary,
        totalArenas:     await n("SELECT COUNT(*) AS n FROM arenas WHERE status = 'finished'"),
        totalGamesScored: await n('SELECT COALESCE(SUM(games),0) AS n FROM arena_scores'),
        participants:    await n('SELECT COUNT(DISTINCT user_id) AS n FROM arena_scores'),
        recentChampions: await recentChampions(5),
      };
    } catch (e) { stats.arena = { enabled: false, live: null, totalArenas: 0, totalGamesScored: 0, participants: 0, recentChampions: [] }; }

    // --- Product analytics (privacy-light funnel) ---------------------------
    // analyticsStats() is itself failure-isolated (returns a zeroed shape on
    // error), but we double-wrap here so a missing analytics_events table can
    // never 500 the whole admin dashboard.
    try {
      stats.analytics = await analyticsStats(days);
    } catch (e) {
      stats.analytics = {
        funnel: [
          { stage: 'Landed',          key: 'land',            visitors: 0 },
          { stage: 'Played',          key: 'play_start',      visitors: 0 },
          { stage: 'Finished a game', key: 'play_finish',     visitors: 0 },
          { stage: 'Saw sign-up',     key: 'signup_cta_view', visitors: 0 },
          { stage: 'Signed up',       key: 'signup',          visitors: 0 },
        ],
        today: { visitors: 0, plays: 0, signups: 0 },
        daily: [],
        returning: { visitorsToday: 0, returningToday: 0 },
        topEvents: [],
      };
    }

    // --- Registered-player geography (derived from signup IP) ---------------
    // Where our ACCOUNTS are from (vs. the analytics block which is visitor
    // traffic). Self-reported `region` free-text is surfaced separately.
    try {
      const cRows = await store.all("SELECT geo_country AS c, COUNT(*) AS n FROM users WHERE geo_country IS NOT NULL AND geo_country <> '' GROUP BY geo_country ORDER BY n DESC LIMIT 20");
      const sRows = await store.all("SELECT geo_region AS r, COUNT(*) AS n FROM users WHERE geo_country = 'US' AND geo_region IS NOT NULL AND geo_region <> '' GROUP BY geo_region ORDER BY n DESC LIMIT 20");
      stats.userGeo = {
        topCountries: (cRows || []).map(r => ({ country: String(r.c), users: Number(r.n) || 0 })),
        topStates: (sRows || []).map(r => ({ region: String(r.r), users: Number(r.n) || 0 })),
        located: await n("SELECT COUNT(*) AS n FROM users WHERE geo_country IS NOT NULL AND geo_country <> ''"),
      };
    } catch (e) { stats.userGeo = { topCountries: [], topStates: [], located: 0 }; }

    // --- Self-reported region (free-text at signup) -------------------------
    try {
      const rRows = await store.all("SELECT region AS r, COUNT(*) AS n FROM users WHERE region IS NOT NULL AND region <> '' GROUP BY region ORDER BY n DESC LIMIT 15");
      stats.regions = (rRows || []).map(r => ({ region: String(r.r), users: Number(r.n) || 0 }));
    } catch (e) { stats.regions = []; }

    // --- Game-type split (chess vs checkers, + checkers board sizes) --------
    try {
      stats.gameTypes = {
        chess:      await n("SELECT COUNT(*) AS n FROM games WHERE game_type = 'chess' OR game_type IS NULL OR game_type = ''"),
        checkers:   await n("SELECT COUNT(*) AS n FROM games WHERE game_type = 'checkers'"),
        checkers8:  await n("SELECT COUNT(*) AS n FROM games WHERE game_type = 'checkers' AND variant = '8'"),
        checkers10: await n("SELECT COUNT(*) AS n FROM games WHERE game_type = 'checkers' AND variant = '10'"),
      };
    } catch (e) { stats.gameTypes = { chess: 0, checkers: 0, checkers8: 0, checkers10: 0 }; }

    // --- Games by UTC hour (when do people play?) over the window -----------
    try {
      const rows = await store.all('SELECT created_at FROM games WHERE created_at > ?', [now - days * DAY]);
      const hours = new Array(24).fill(0);
      for (const r of (rows || [])) { const h = new Date(Number(r.created_at)).getUTCHours(); if (h >= 0 && h < 24) hours[h]++; }
      stats.gamesByHour = hours;
    } catch (e) { stats.gamesByHour = new Array(24).fill(0); }

    // --- Retention cohorts (weekly) -----------------------------------------
    // For each of the last 8 signup-weeks: cohort size, classic D1/D7/D30
    // retention (% of the cohort still around >= N days after signup), plus how
    // many are "active" now (seen in the last 7 days). The dN denominator is the
    // ELIGIBLE cohort (members who've had >= N days to come back), so young
    // cohorts aren't penalised — dN is null (—) until the cohort is old enough.
    // Pragmatic read from users(created_at, last_seen) with no activity log:
    // last_seen-created_at >= N*DAY ⇒ still around at >= day N.
    try {
      const rows = await store.all('SELECT created_at, last_seen FROM users WHERE created_at > ?', [now - 9 * 7 * DAY]);
      const mkB = () => ({ size: 0, returned: 0, active: 0, e1: 0, r1: 0, e7: 0, r7: 0, e30: 0, r30: 0 });
      const buckets = {};
      for (const r of (rows || [])) {
        const ca = Number(r.created_at) || 0, ls = Number(r.last_seen) || 0;
        if (!ca) continue;
        const wi = Math.floor((now - ca) / (7 * DAY));
        if (wi < 0 || wi > 7) continue;
        const b = buckets[wi] || (buckets[wi] = mkB());
        const age = now - ca;
        const ret = ls > 0 ? ls - ca : -1; // how long after signup they were last seen
        b.size++;
        if (ret >= DAY) b.returned++;
        if (ls > now - 7 * DAY) b.active++;
        if (age >= DAY)      { b.e1++;  if (ret >= DAY)      b.r1++; }
        if (age >= 7 * DAY)  { b.e7++;  if (ret >= 7 * DAY)  b.r7++; }
        if (age >= 30 * DAY) { b.e30++; if (ret >= 30 * DAY) b.r30++; }
      }
      const pct = (rN, eN) => (eN ? Math.round(rN / eN * 100) : null);
      const retention = [];
      for (let wi = 7; wi >= 0; wi--) {
        const b = buckets[wi] || mkB();
        retention.push({
          week: new Date(now - wi * 7 * DAY).toISOString().slice(0, 10),
          size: b.size, returned: b.returned, active: b.active,
          pctReturned: b.size ? Math.round(b.returned / b.size * 100) : 0,
          pctActive: b.size ? Math.round(b.active / b.size * 100) : 0,
          d1: pct(b.r1, b.e1), d7: pct(b.r7, b.e7), d30: pct(b.r30, b.e30),
          eligible7: b.e7,
        });
      }
      stats.retention = retention;
    } catch (e) { stats.retention = []; }

    // --- True interval retention CURVES (per-user activity log) --------------
    // The cohort retention triangle: % of each signup-week cohort active in week
    // 0,1,2,… after signup, derived from analytics_events (events keyed by
    // user_id = "this user did something that day"). Pure engine in cohorts.js.
    try {
      const COHORT_WEEKS = 8;
      const cohortCutMs = now - COHORT_WEEKS * 7 * DAY;
      const cohortCutDay = new Date(cohortCutMs).toISOString().slice(0, 10);
      const uRows = await store.all('SELECT id, created_at FROM users WHERE created_at > ?', [cohortCutMs]);
      const evRows = await store.all(
        "SELECT DISTINCT user_id, day_key FROM analytics_events WHERE user_id IS NOT NULL AND user_id <> '' AND day_key >= ?",
        [cohortCutDay]
      );
      stats.retentionCurves = retentionCurves({
        now, weeks: COHORT_WEEKS,
        users: (uRows || []).map(r => ({ id: r.id, createdAt: Number(r.created_at) })),
        events: (evRows || []).map(r => ({ userId: r.user_id, dayKey: r.day_key })),
      });
    } catch (e) { stats.retentionCurves = { cohorts: [], maxWeeks: 0 }; }

    stats.windowDays = days;
    res.json(stats);
  } catch (e) { next(e); }
});

// Per-user detail for the admin drill-down modal (ADMIN_KEY-gated). Returns a
// profile snapshot + recent games. No password hash / tokens.
app.get('/api/admin/user/:id', async (req, res, next) => {
  try {
    const provided = req.get('x-admin-key') || req.query.key || '';
    if (!adminKeyOk(provided)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const id = String(req.params.id || '');
    const u = await store.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!u) { return res.status(404).json({ error: 'User not found.' }); }
    let achievements = [];
    try { const a = JSON.parse(u.achievements || '[]'); if (Array.isArray(a)) achievements = a; } catch (e) {}
    const games = await store.all(
      'SELECT id, mode, game_type, variant, result, created_at FROM games WHERE white_id = ? OR black_id = ? ORDER BY created_at DESC LIMIT 12',
      [id, id]
    );
    res.json({
      id: u.id, username: u.username, email: u.email, region: u.region || '',
      geoCountry: u.geo_country || '', geoRegion: u.geo_region || '',
      elo: u.elo, eloCheckers8: u.elo_checkers_8, eloCheckers10: u.elo_checkers_10,
      wins: u.wins, losses: u.losses, draws: u.draws,
      bestStreak: u.best_streak, currentStreak: u.current_streak,
      arenaWins: u.arena_wins || 0, trophyPoints: u.trophy_points || 0, trophyCount: achievements.length,
      invitesAccepted: u.invites_accepted || 0,
      isPremium: !!u.is_premium, emailVerified: !!u.email_verified,
      createdAt: u.created_at, lastSeen: u.last_seen,
      recentGames: (games || []).map(g => ({ id: g.id, mode: g.mode, type: g.game_type || 'chess', variant: g.variant || '', result: g.result || '', at: g.created_at })),
    });
  } catch (e) { if (!e.status) e.status = 500; next(e); }
});

// ADMIN HARD DELETE (ADMIN_KEY-gated) — PERMANENTLY removes a user row + every
// row that references it (games, stats, social graph, owned leagues, analytics).
// This is NOT the GDPR soft-delete (/api/me/delete, which anonymizes + keeps the
// row); it's for scrubbing TEST accounts so the data reflects only real users.
// IRREVERSIBLE. Preview first with `?dryRun=1` (returns per-table counts, deletes
// nothing). 404 if the id doesn't exist (and not a dry run).
app.delete('/api/admin/user/:id', async (req, res, next) => {
  try {
    const provided = req.get('x-admin-key') || req.query.key || '';
    if (!adminKeyOk(provided)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ error: 'User id required.' });
    const dryRun = /^(1|true|yes)$/i.test(String(req.query.dryRun || ''));
    const result = await store.adminDeleteUserHard(id, { dryRun });
    if (!result.found && !dryRun) return res.status(404).json({ error: 'User not found.' });
    res.json(result);
  } catch (e) { if (!e.status) e.status = 500; next(e); }
});

// Raw-data CSV export (ADMIN_KEY-gated) for offline analysis in a spreadsheet / BI
// tool. type = events | users | games. Bounded row cap; no raw IPs or PGNs.
app.get('/api/admin/export', async (req, res, next) => {
  try {
    const provided = req.get('x-admin-key') || req.query.key || '';
    if (!adminKeyOk(provided)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const type = String(req.query.type || 'events');
    const days = Math.max(1, Math.min(3650, parseInt(req.query.days, 10) || 90));
    const cutMs = Date.now() - days * 86400000;
    const cutDay = new Date(cutMs).toISOString().slice(0, 10);
    const esc = (v) => { const s = (v == null) ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    let cols, rows;
    if (type === 'users') {
      cols = ['id', 'username', 'region', 'geo_country', 'geo_region', 'elo', 'wins', 'losses', 'draws', 'is_premium', 'email_verified', 'created_at', 'last_seen'];
      rows = await store.all(`SELECT ${cols.join(', ')} FROM users ORDER BY created_at DESC LIMIT 100000`);
    } else if (type === 'games') {
      cols = ['id', 'mode', 'game_type', 'variant', 'result', 'white_elo_before', 'black_elo_before', 'white_elo_delta', 'black_elo_delta', 'created_at', 'ended_at'];
      rows = await store.all(`SELECT ${cols.join(', ')} FROM games WHERE created_at > ? ORDER BY created_at DESC LIMIT 100000`, [cutMs]);
    } else { // events
      cols = ['id', 'name', 'visitor_id', 'user_id', 'country', 'region', 'day_key', 'created_at'];
      rows = await store.all(`SELECT ${cols.join(', ')} FROM analytics_events WHERE day_key >= ? ORDER BY id DESC LIMIT 200000`, [cutDay]);
    }
    const body = (rows || []).map(r => cols.map(c => esc(r[c])).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ct-${type}-${cutDay}.csv"`);
    res.send(cols.join(',') + '\n' + body + '\n');
  } catch (e) { if (!e.status) e.status = 500; next(e); }
});

// Build a dense [{date:'YYYY-MM-DD', count}] series of row creations per UTC day
// over the last `days` days. `table` is a fixed internal literal (never user
// input), so interpolating it is safe. Uses only created_at -> portable SQL.
async function dailyCountSeries(table, days) {
  const DAY = 86400000;
  const since = Date.now() - days * DAY;
  let rows = [];
  try { rows = await store.all(`SELECT created_at FROM ${table} WHERE created_at > ?`, [since]); }
  catch (e) { return []; }
  const buckets = {};
  for (const r of rows) {
    const ms = Number(r.created_at) || 0;
    if (!ms) continue;
    const d = new Date(ms).toISOString().slice(0, 10);
    buckets[d] = (buckets[d] || 0) + 1;
  }
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
    out.push({ date: d, count: buckets[d] || 0 });
  }
  return out;
}

// --- Admin user directory ---------------------------------------------------
// Real users with usernames + emails (to invite top performers to tournaments)
// and top-N performers. Gated by ADMIN_KEY exactly like /api/admin/stats. Sort
// is allowlisted (never interpolated from raw input); `q` is a parameterized
// case-insensitive substring match on username OR email (LIKE-escaped).
app.get('/api/admin/users', async (req, res, next) => {
  try {
    const provided = req.get('x-admin-key') || req.query.key || '';
    if (!adminKeyOk(provided)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'elo';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 1000, 1), 1000);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const result = await store.adminListUsers({ sort, limit, q });
    res.json(result);
  } catch (e) { next(e); }
});

// Serve static client (optional — useful for one-command deploy)
const staticDir = path.join(__dirname, 'public');
app.use(express.static(staticDir));
app.get('/', (req, res) => res.sendFile(path.join(staticDir, 'index.html')));

app.use((err, req, res, next) => {
  console.error('[server]', err);
  const status = err.status || 500;
  if (status >= 500) captureException(err); // report unexpected server errors to Sentry (no-op if unconfigured)
  // Surface friendly validation/auth messages for client errors (4xx);
  // hide unexpected server errors behind a generic message.
  const message = (status >= 400 && status < 500 && err.message) ? err.message : 'Internal server error';
  res.status(status).json({ error: message });
});

// WebSocket
attachSocketHandlers(io, verifyToken, redisClient);

// Initialize the scalable persistence backend's schema when DATABASE_URL is
// set (Postgres). No-op on the SQLite default path (db.js created the schema
// synchronously on import), so this neither slows nor changes local/test boot.
if (store.usingPostgres) {
  try {
    await store.init();
    console.log('[db] Postgres backend active (DATABASE_URL set) — schema ensured');
  } catch (e) {
    console.error('[db] Postgres init failed:', e && e.message);
    process.exit(1);
  }
} else {
  console.log('[db] SQLite backend active (default; set DB_BACKEND=postgres + DATABASE_URL to scale to Postgres)');
}

// DURABILITY HONESTY: SQLite on ephemeral container storage with NO configured
// backup replica is NOT durable — a redeploy/restart can lose the volume (and an
// un-checkpointed data.db-wal). Make that posture LOUD instead of silent:
//   durable path = Postgres  OR  a configured + present Litestream replica.
// Litestream is installed best-effort (Dockerfile), so a failed download yields
// an image with NO backups; if LITESTREAM_REPLICA_URL is set but the binary is
// missing, that's a MISCONFIG (you asked for backups but they can't run) and we
// shout about it. We warn — we do NOT crash boot — UNLESS the operator opts in
// to strict mode with REQUIRE_DURABLE_DB=1 (then an undurable prod boot exits).
const DURABLE_DB = store.usingPostgres || (HAS_LITESTREAM && !!process.env.LITESTREAM_REPLICA_URL);
const IS_PROD = process.env.NODE_ENV === 'production';
if (!DURABLE_DB && IS_PROD) {
  console.warn('[durability] WARNING: running SQLite in production with NO configured backup replica.');
  console.warn('[durability]   The DB lives on ephemeral storage — a redeploy/restart can LOSE ALL DATA.');
  console.warn('[durability]   Durable options: (a) Postgres — set DB_BACKEND=postgres + DATABASE_URL;');
  console.warn('[durability]                    (b) Litestream — set LITESTREAM_REPLICA_URL + S3 creds.');
  if (process.env.LITESTREAM_REPLICA_URL && !HAS_LITESTREAM) {
    console.warn('[durability]   MISCONFIG: LITESTREAM_REPLICA_URL is set but the litestream binary is MISSING');
    console.warn('[durability]   from this image (the best-effort Dockerfile install likely failed) — backups are NOT running.');
  }
  if (process.env.REQUIRE_DURABLE_DB === '1') {
    console.error('[durability] REQUIRE_DURABLE_DB=1 and the DB is not durable — refusing to start. Configure Postgres or Litestream.');
    process.exit(1);
  }
} else if (DURABLE_DB && IS_PROD) {
  console.log(`[durability] OK — durable backend: ${store.usingPostgres ? 'Postgres' : 'SQLite + Litestream replica'}`);
}

// Start the rolling arena scheduler AFTER the schema is ensured (above). Inert
// when ARENA_ENABLED=0. Failure-isolated internally so it can never crash boot.
// onChampion crowns the bell-time leader: durable arena_wins++, a live socket
// celebration, and a best-effort re-engagement push. Wired here (not in arena.js)
// so arena.js stays decoupled from game.js's notifyUser + push.js.
startArenaScheduler(io, {
  onChampion: async ({ arena, championId, championPoints }) => {
    try { await store.run('UPDATE users SET arena_wins = arena_wins + 1 WHERE id = ?', [championId]); }
    catch (e) { console.error('[arena] champion increment failed', e && e.message); }
    try { notifyUser(championId, 'arena_champion', { arenaId: arena.id, name: arena.name, points: championPoints }); }
    catch (e) {}
    try { await sendPushToUser(championId, { title: '🏆 Arena champion!', body: `You won ${arena.name} with ${championPoints} points!`, url: '/', tag: 'arena-champ' }); }
    catch (e) {}
  },
});

// Start the re-engagement sender (audit BLOCKER fix). Hourly tick that selects
// streak-at-risk + inactive (d1/d3/d7) users via the PURE selector in
// reengage.js and dispatches a push (or comeback email) with a per-user
// cooldown. Env-gated: a complete no-op until VAPID (push) or RESEND_API_KEY
// (email) is configured, and failure-isolated so it can never crash boot. Passed
// the shared Redis client so, under multi-instance, a SET NX lock makes exactly
// one replica send each tick (no double-sends).
startReengagementScheduler({ redis: redisClient });

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`ChessTrophies server listening on :${PORT}`);
  // Make the email state obvious in the logs — the #1 "verification email never
  // arrived" cause is simply not having an email provider configured.
  if (isEmailConfigured()) {
    const from = process.env.RESEND_FROM || 'ChessTrophies <onboarding@resend.dev>';
    console.log(`[email] provider configured (Resend). From: ${from}. APP_URL: ${process.env.APP_URL || '(unset)'}`);
  } else {
    console.warn('[email] RESEND_API_KEY is NOT set — signup verification and password-reset emails will NOT be sent. Set RESEND_API_KEY, RESEND_FROM, and APP_URL to enable email.');
  }
  // Make the Stripe billing state obvious in the logs too (mirrors email above).
  logBillingStatus();
  // ...and how many cosmetic-store sets are live vs preview-only.
  logStoreStatus();
  // ...and whether Web Push is configured (VAPID) or inert.
  logPushStatus();
  // ...and whether arena tournaments are scheduling (ARENA_ENABLED).
  logArenaStatus();
  // ...and whether the re-engagement sender is live (push and/or email).
  logReengageStatus();
});

// --- Graceful shutdown + global error handlers ---------------------------------
// Close the WebSocket + HTTP server (stop accepting new work), then the DB and
// Redis, then exit so the process manager can restart us cleanly. Guarded so a
// second signal (or a signal mid-shutdown) doesn't double-run the teardown.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}, closing server...`);
  // Hard cap: if close() hangs (lingering sockets), force-exit anyway.
  const forceTimer = setTimeout(() => {
    console.error('[shutdown] graceful close timed out, forcing exit');
    process.exit(1);
  }, 10000);
  if (typeof forceTimer.unref === 'function') forceTimer.unref();
  io.close(() => {
    httpServer.close(() => {
      try { if (redisClient) redisClient.disconnect(); } catch (e) { console.error('[shutdown] redis', e && e.message); }
      try { if (db && typeof db.close === 'function') db.close(); } catch (e) { console.error('[shutdown] db', e && e.message); }
      // Drain the Postgres pool too (only loaded when DATABASE_URL is set).
      try { store.closePool && store.closePool().catch(() => {}); } catch (e) { console.error('[shutdown] pg', e && e.message); }
      clearTimeout(forceTimer);
      console.log('[shutdown] closed cleanly');
      process.exit(0);
    });
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Never silently swallow. Log unhandled rejections (keep running — likely a
// recoverable async bug); log uncaught exceptions and exit so the process
// manager restarts us in a known-good state.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  captureException(reason instanceof Error ? reason : new Error('unhandledRejection: ' + String(reason)));
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  // Flush the crash to Sentry (up to 2s) before exiting so it isn't lost.
  try { if (Sentry) { Sentry.captureException(err); Sentry.close(2000).finally(() => process.exit(1)); return; } } catch (e) {}
  process.exit(1);
});
