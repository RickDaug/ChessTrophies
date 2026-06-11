// JWT auth helpers.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import * as store from './store.js';

const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-account-enumeration-hardening', 12);
const TOKEN_EXPIRY = '30d';

function resolveSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    console.error(
      'FATAL: JWT_SECRET is required in production but is not set — aborting startup.\n' +
      '  Set it in your host\'s environment variables (e.g. Railway -> service -> Variables).\n' +
      '  Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
    );
    process.exit(1);
  }
  const generated = crypto.randomBytes(48).toString('hex');
  console.warn('WARNING: JWT_SECRET is not set; using an ephemeral dev secret. Tokens will not persist across restarts.');
  return generated;
}

const SECRET = resolveSecret();

function normalizeString(value, field, { min = 1, max = 255 } = {}) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new Error(`${field} must be ${min} to ${max} characters.`);
  return trimmed;
}

export async function signup({ email, username, password, region, invitedBy, geo }) {
  const lowEmail = normalizeString(email, 'email', { min: 3, max: 254 }).toLowerCase();
  const safeUsername = normalizeString(username, 'username', { min: 3, max: 20 });
  const safePassword = normalizeString(password, 'password', { min: 6, max: 128 });
  const safeRegion = typeof region === 'string' ? region.trim().slice(0, 64) : '';
  const safeInvitedBy = typeof invitedBy === 'string' && invitedBy.trim() ? invitedBy.trim().slice(0, 64) : null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lowEmail)) throw new Error('Email is invalid.');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(safeUsername)) throw new Error('Username must be 3–20 letters, numbers, or underscores.');
  if ((await store.getUserByEmail(lowEmail)) || (await store.getUserByUsername(safeUsername))) throw new Error('An account with that email or username already exists.');
  const pw_hash = await bcrypt.hash(safePassword, 12);
  const id = 'u_' + crypto.randomBytes(8).toString('hex');
  await store.createUser({ id, email: lowEmail, username: safeUsername, region: safeRegion, pw_hash, invited_by: safeInvitedBy });
  // Store derived signup geo (country + region/state code) if available. Best-
  // effort: a geo failure must never block account creation.
  if (geo && (geo.country || geo.region)) {
    try { await store.run('UPDATE users SET geo_country = ?, geo_region = ? WHERE id = ?', [geo.country || '', geo.region || '', id]); } catch (e) {}
  }
  if (safeInvitedBy && (await store.getUserById(safeInvitedBy))) {
    await store.run('UPDATE users SET invites_accepted = invites_accepted + 1 WHERE id = ?', [safeInvitedBy]);
  }
  // Issue a verification token so the caller can email a confirm link. Returns
  // both the JWT (for immediate sign-in — verification is soft, non-blocking)
  // and the raw verification token to send.
  const verification = await issueEmailVerification(id, lowEmail);
  return { token: makeToken(id), verification };
}

// Login by either a USERNAME or an EMAIL. The single `identifier` field may be
// either; we route on whether it contains '@'. Username lookups are
// case-insensitive (store.getUserByUsername does LOWER(username), mirroring
// /api/friends/add). The generic error message + dummy-bcrypt-compare on a
// missing user keep account-enumeration hardening intact.
export async function login({ identifier, password }) {
  const id = normalizeString(identifier, 'identifier', { min: 3, max: 254 });
  const safePassword = typeof password === 'string' ? password : '';
  const lower = id.toLowerCase();
  const u = id.includes('@')
    ? await store.getUserByEmail(lower)
    : await store.getUserByUsername(lower);
  const ok = await bcrypt.compare(safePassword, u ? u.pw_hash : DUMMY_HASH);
  if (!ok || !u) throw new Error('Email/username or password is incorrect.');
  store.markActive(u.id); // fire-and-forget activity ping for admin stats
  return makeToken(u.id, u.token_version || 0);
}

// ---------------------------------------------------------------------------
// Password reset + change password
// ---------------------------------------------------------------------------

const RESET_TTL_MS = 30 * 60 * 1000; // reset links are valid for 30 minutes

// sha256-hash a raw token so we never store the usable token at rest.
function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Issue a password-reset token for the account with this email.
// To avoid account enumeration the caller always responds 200 regardless of
// whether an account exists; when none does we simply return { token: null }.
export async function requestPasswordReset(email) {
  const lowEmail = normalizeString(email, 'email', { min: 3, max: 254 }).toLowerCase();

  // Cheap inline sweep of expired tokens (no cron needed).
  await store.run('DELETE FROM password_resets WHERE expires_at < ?', [Date.now()]);

  const u = await store.getUserByEmail(lowEmail);
  if (!u) return { token: null };

  // Invalidate any prior unused tokens for this user so only one is ever live.
  await store.run('DELETE FROM password_resets WHERE user_id = ? AND used = 0', [u.id]);

  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);
  const now = Date.now();
  await store.run(`INSERT INTO password_resets (token_hash, user_id, expires_at, used, created_at)
              VALUES (?, ?, ?, 0, ?)`,
    [tokenHash, u.id, now + RESET_TTL_MS, now]);

  return { token: raw, userId: u.id };
}

// Consume a reset token and set a new password. Throws on invalid/expired token
// or invalid new password.
export async function resetPassword(token, newPassword) {
  const safePassword = normalizeString(newPassword, 'password', { min: 6, max: 128 });
  const safeToken = typeof token === 'string' ? token.trim() : '';
  const tokenHash = hashToken(safeToken);

  const row = await store.get(`SELECT * FROM password_resets
                          WHERE token_hash = ? AND used = 0 AND expires_at > ?`,
    [tokenHash, Date.now()]);
  if (!row) throw new Error('This reset link is invalid or has expired.');

  const pw_hash = await bcrypt.hash(safePassword, 12);
  // Bump token_version too, so any JWT issued before this reset is revoked — the
  // core "I was hacked → reset my password" lockout (a stolen token dies here).
  await store.run('UPDATE users SET pw_hash = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?', [pw_hash, row.user_id]);
  // Mark used and remove the row so the token can never be replayed.
  await store.run('DELETE FROM password_resets WHERE token_hash = ?', [tokenHash]);
  return true;
}

// ---------------------------------------------------------------------------
// Email verification (soft — unverified users can still play; see server.js)
// ---------------------------------------------------------------------------

const VERIFY_TTL_MS = 60 * 60 * 1000; // verification codes are valid for 1 hour
const VERIFY_MAX_ATTEMPTS = 5;        // wrong tries before the code is burned

// A cryptographically-random, zero-padded 6-digit code (000000–999999).
function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// Issue a fresh 6-digit verification code for a user, replacing any prior one so
// only the latest code works. Returns { email, code, userId } (raw code).
export async function issueEmailVerification(userId, email) {
  // Cheap inline sweep of expired codes (no cron needed).
  await store.run('DELETE FROM email_verifications WHERE expires_at < ?', [Date.now()]);

  const code = generateCode();
  const now = Date.now();
  // One row per user (user_id is the PK) — upsert replaces any existing code.
  // `ON CONFLICT(col) DO UPDATE SET x = excluded.x` is valid on BOTH SQLite and
  // Postgres (Postgres also spells the pseudo-table `excluded`), so the same SQL
  // works on either backend.
  await store.run(`INSERT INTO email_verifications (user_id, code_hash, expires_at, attempts, created_at)
              VALUES (?, ?, ?, 0, ?)
              ON CONFLICT(user_id) DO UPDATE SET
                code_hash = excluded.code_hash,
                expires_at = excluded.expires_at,
                attempts = 0,
                created_at = excluded.created_at`,
    [userId, hashToken(code), now + VERIFY_TTL_MS, now]);
  return { email, code, userId };
}

// Check a 6-digit code for a specific (authenticated) user and mark them verified.
// User-scoped because a 6-digit code isn't globally unique. Throttled: after
// VERIFY_MAX_ATTEMPTS wrong tries the code is burned and a new one is required.
// Throws a friendly Error on any failure.
export async function verifyEmailCode(userId, code) {
  const safeCode = (typeof code === 'string' ? code : '').replace(/\s+/g, '');
  const row = await store.get('SELECT * FROM email_verifications WHERE user_id = ?', [userId]);
  if (!row || row.expires_at <= Date.now()) {
    if (row) await store.run('DELETE FROM email_verifications WHERE user_id = ?', [userId]);
    throw new Error('Your code has expired. Tap Resend to get a new one.');
  }
  if (row.attempts >= VERIFY_MAX_ATTEMPTS) {
    await store.run('DELETE FROM email_verifications WHERE user_id = ?', [userId]);
    throw new Error('Too many incorrect tries. Tap Resend to get a new code.');
  }
  const a = Buffer.from(hashToken(safeCode), 'hex');
  const b = Buffer.from(row.code_hash, 'hex');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    await store.run('UPDATE email_verifications SET attempts = attempts + 1 WHERE user_id = ?', [userId]);
    const left = VERIFY_MAX_ATTEMPTS - (row.attempts + 1);
    throw new Error(left > 0 ? `That code is incorrect. ${left} ${left === 1 ? 'try' : 'tries'} left.`
                             : 'That code is incorrect. Tap Resend to get a new code.');
  }
  await store.run('UPDATE users SET email_verified = 1 WHERE id = ?', [userId]);
  await store.run('DELETE FROM email_verifications WHERE user_id = ?', [userId]);
  return { userId };
}

// Resend throttle: without this, a signed-in user could spam resend to keep
// minting fresh codes (each reset to attempts=0), defeating the 5-try cap on
// verifyEmailCode and turning it into an unlimited brute-force surface.
// State is kept in-memory (userId -> { lastSentAt, windowStart, count }); we
// don't own db.js, and a process restart only clears the cooldown for a soft
// (non-blocking) verification flow, which is acceptable.
const RESEND_MIN_INTERVAL_MS = 60 * 1000;     // >= 60s between resends
const RESEND_WINDOW_MS = 60 * 60 * 1000;      // rolling 1-hour window
const RESEND_MAX_PER_WINDOW = 5;              // cap resends per hour
const resendThrottle = new Map();

// Re-issue a verification code for an authenticated user who hasn't confirmed yet.
// Returns { alreadyVerified: true } when there's nothing to do, else { email, code }.
// Throttled per-user (min interval + hourly cap); throws a friendly Error if hit.
export async function resendEmailVerification(userId) {
  const u = await store.getUserById(userId);
  if (!u) throw new Error('User not found.');
  if (u.email_verified) return { alreadyVerified: true };

  const now = Date.now();
  let t = resendThrottle.get(userId);
  if (!t || now - t.windowStart >= RESEND_WINDOW_MS) {
    t = { lastSentAt: 0, windowStart: now, count: 0 };
  }
  if (now - t.lastSentAt < RESEND_MIN_INTERVAL_MS) {
    const wait = Math.ceil((RESEND_MIN_INTERVAL_MS - (now - t.lastSentAt)) / 1000);
    throw new Error(`Please wait ${wait}s before requesting another code.`);
  }
  if (t.count >= RESEND_MAX_PER_WINDOW) {
    throw new Error('Too many resend requests. Please try again later.');
  }
  t.lastSentAt = now;
  t.count += 1;
  resendThrottle.set(userId, t);

  return await issueEmailVerification(u.id, u.email);
}

// Change the password for an authenticated user after verifying the current one.
export async function changePassword(userId, currentPassword, newPassword) {
  const u = await store.getUserById(userId);
  if (!u) throw new Error('User not found.');
  const currentOk = await bcrypt.compare(typeof currentPassword === 'string' ? currentPassword : '', u.pw_hash);
  if (!currentOk) throw new Error('Current password is incorrect.');
  const safePassword = normalizeString(newPassword, 'password', { min: 6, max: 128 });
  const pw_hash = await bcrypt.hash(safePassword, 12);
  // Bump token_version to revoke OTHER sessions; mint a fresh token so the current
  // session (the one that just changed the password) stays signed in.
  await store.run('UPDATE users SET pw_hash = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?', [pw_hash, u.id]);
  return { ok: true, token: makeToken(u.id, (u.token_version || 0) + 1) };
}

export function makeToken(userId, tokenVersion = 0) {
  return jwt.sign({ uid: userId, tv: tokenVersion | 0 }, SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token) {
  try { return jwt.verify(token, SECRET); }
  catch (e) { return null; }
}

// Express middleware. Async because the user lookup goes through the
// backend-agnostic store (synchronous SQLite by default, async Postgres when
// DATABASE_URL is set). Any thrown error is forwarded to Express's error handler.
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token ? verifyToken(token) : null;
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    req.userId = payload.uid;
    req.user = await store.getUserById(payload.uid);
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    // Token revocation: a password reset/change bumps the user's token_version,
    // invalidating every JWT issued before it. Legacy tokens (no `tv`) and users
    // with no bump both default to 0, so nothing is mass-logged-out — only tokens
    // older than a reset/change are rejected (client's 401 handler re-prompts login).
    if ((payload.tv || 0) !== (req.user.token_version || 0)) {
      return res.status(401).json({ error: 'Session expired' });
    }
    next();
  } catch (e) { next(e); }
}
