// JWT auth helpers.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { createUser, getUserByEmail, getUserByUsername, getUserById, db } from './db.js';

const SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const TOKEN_EXPIRY = '30d';

export async function signup({ email, username, password, region, invitedBy }) {
  if (!email || !username || !password) throw new Error('All fields required.');
  if (password.length < 6) throw new Error('Password must be at least 6 characters.');
  const lowEmail = email.toLowerCase().trim();
  if (getUserByEmail(lowEmail)) throw new Error('An account with that email already exists.');
  if (getUserByUsername(username)) throw new Error('That username is taken.');
  const pw_hash = await bcrypt.hash(password, 12);
  const id = 'u_' + crypto.randomBytes(8).toString('hex');
  createUser({ id, email: lowEmail, username: username.trim(), region, pw_hash, invited_by: invitedBy || null });
  // If invited, credit the inviter
  if (invitedBy && getUserById(invitedBy)) {
    db.prepare('UPDATE users SET invites_accepted = invites_accepted + 1 WHERE id = ?').run(invitedBy);
  }
  return makeToken(id);
}

export async function login({ email, password }) {
  const u = getUserByEmail(email);
  if (!u) throw new Error('No account with that email.');
  const ok = await bcrypt.compare(password, u.pw_hash);
  if (!ok) throw new Error('Incorrect password.');
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
