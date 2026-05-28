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
