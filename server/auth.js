// JWT auth helpers.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { createUser, getUserByEmail, getUserByUsername, getUserById, db } from './db.js';

const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-account-enumeration-hardening', 12);
const TOKEN_EXPIRY = '30d';

function resolveSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    console.error('JWT_SECRET is required in production. Aborting startup.');
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

export async function signup({ email, username, password, region, invitedBy }) {
  const lowEmail = normalizeString(email, 'email', { min: 3, max: 254 }).toLowerCase();
  const safeUsername = normalizeString(username, 'username', { min: 3, max: 20 });
  const safePassword = normalizeString(password, 'password', { min: 6, max: 128 });
  const safeRegion = typeof region === 'string' ? region.trim().slice(0, 64) : '';
  const safeInvitedBy = typeof invitedBy === 'string' && invitedBy.trim() ? invitedBy.trim().slice(0, 64) : null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lowEmail)) throw new Error('Email is invalid.');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(safeUsername)) throw new Error('Username must be 3–20 letters, numbers, or underscores.');
  if (getUserByEmail(lowEmail) || getUserByUsername(safeUsername)) throw new Error('An account with that email or username already exists.');
  const pw_hash = await bcrypt.hash(safePassword, 12);
  const id = 'u_' + crypto.randomBytes(8).toString('hex');
  createUser({ id, email: lowEmail, username: safeUsername, region: safeRegion, pw_hash, invited_by: safeInvitedBy });
  if (safeInvitedBy && getUserById(safeInvitedBy)) {
    db.prepare('UPDATE users SET invites_accepted = invites_accepted + 1 WHERE id = ?').run(safeInvitedBy);
  }
  return makeToken(id);
}

export async function login({ email, password }) {
  const normalizedEmail = normalizeString(email, 'email', { min: 3, max: 254 }).toLowerCase();
  const safePassword = typeof password === 'string' ? password : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) throw new Error('Email or password is incorrect.');
  const u = getUserByEmail(normalizedEmail);
  const ok = await bcrypt.compare(safePassword, u ? u.pw_hash : DUMMY_HASH);
  if (!ok || !u) throw new Error('Email or password is incorrect.');
  return makeToken(u.id);
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
export function requestPasswordReset(email) {
  const lowEmail = normalizeString(email, 'email', { min: 3, max: 254 }).toLowerCase();
  const u = getUserByEmail(lowEmail);
  if (!u) return { token: null };

  // Invalidate any prior unused tokens for this user so only one is ever live.
  db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used = 0').run(u.id);

  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);
  const now = Date.now();
  db.prepare(`INSERT INTO password_resets (token_hash, user_id, expires_at, used, created_at)
              VALUES (?, ?, ?, 0, ?)`)
    .run(tokenHash, u.id, now + RESET_TTL_MS, now);

  return { token: raw, userId: u.id };
}

// Consume a reset token and set a new password. Throws on invalid/expired token
// or invalid new password.
export async function resetPassword(token, newPassword) {
  const safePassword = normalizeString(newPassword, 'password', { min: 6, max: 128 });
  const safeToken = typeof token === 'string' ? token.trim() : '';
  const tokenHash = hashToken(safeToken);

  const row = db.prepare(`SELECT * FROM password_resets
                          WHERE token_hash = ? AND used = 0 AND expires_at > ?`)
    .get(tokenHash, Date.now());
  if (!row) throw new Error('This reset link is invalid or has expired.');

  const pw_hash = await bcrypt.hash(safePassword, 12);
  db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(pw_hash, row.user_id);
  // Mark used and remove the row so the token can never be replayed.
  db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(tokenHash);
  return true;
}

// Change the password for an authenticated user after verifying the current one.
export async function changePassword(userId, currentPassword, newPassword) {
  const u = getUserById(userId);
  if (!u) throw new Error('User not found.');
  const currentOk = await bcrypt.compare(typeof currentPassword === 'string' ? currentPassword : '', u.pw_hash);
  if (!currentOk) throw new Error('Current password is incorrect.');
  const safePassword = normalizeString(newPassword, 'password', { min: 6, max: 128 });
  const pw_hash = await bcrypt.hash(safePassword, 12);
  db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(pw_hash, u.id);
  return true;
}

export function makeToken(userId) {
  return jwt.sign({ uid: userId }, SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token) {
  try { return jwt.verify(token, SECRET); }
  catch (e) { return null; }
}

// Express middleware
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
  req.userId = payload.uid;
  req.user = getUserById(payload.uid);
  if (!req.user) return res.status(401).json({ error: 'User not found' });
  next();
}
