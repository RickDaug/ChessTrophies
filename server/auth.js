// JWT auth helpers + signup/login.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { createUser, getUserByEmail, getUserByUsername, getUserById, db } from './db.js';

// --- JWT secret: hard-crash if not set in production -----------------------
// The previous default ('change-me-in-production') was a silent fallback that
// would let an attacker forge tokens against a misconfigured prod deploy.
// We now require JWT_SECRET in production and emit a loud warning in dev.
const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET is required in production. Refusing to start.');
    process.exit(1);
  } else {
    console.warn('WARNING: JWT_SECRET not set. Using an ephemeral random secret for this dev session.');
    console.warn('         Tokens will be invalidated on restart. Set JWT_SECRET in .env to persist.');
  }
}
const EFFECTIVE_SECRET = SECRET || crypto.randomBytes(48).toString('hex');
const TOKEN_EXPIRY = '30d';

// --- Validation rules (must mirror client app.js) --------------------------
// Charset/length applied here as defense-in-depth. The client validates the
// same rules but a hostile client could skip them.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 128;

// Generic message used for any signup conflict (taken email OR taken username)
// to avoid leaking which one matched. Same for login.
const GENERIC_AUTH_ERROR = 'Email or password is incorrect.';
const GENERIC_SIGNUP_CONFLICT = 'An account with that email or username already exists.';

export async function signup({ email, username, password, region, invitedBy }) {
  // Type guards — req.body is attacker-controlled; never trust shapes.
  if (typeof email !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
    throw new Error('All fields required.');
  }
  if (!USERNAME_RE.test(username))
    throw new Error('Username must be 3-20 characters: letters, numbers, underscore only.');
  if (!EMAIL_RE.test(email))
    throw new Error('Please enter a valid email address.');
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD)
    throw new Error(`Password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters.`);
  if (region != null && (typeof region !== 'string' || region.length > 32))
    throw new Error('Invalid region.');

  const lowEmail = email.toLowerCase().trim();
  // Single conflict message — do NOT distinguish taken email vs taken username.
  // Distinguishing leaks account-enumeration info to attackers.
  if (getUserByEmail(lowEmail) || getUserByUsername(username))
    throw new Error(GENERIC_SIGNUP_CONFLICT);

  const pw_hash = await bcrypt.hash(password, 12);
  const id = 'u_' + crypto.randomBytes(8).toString('hex');
  createUser({
    id, email: lowEmail, username: username.trim(),
    region: typeof region === 'string' ? region : '',
    pw_hash,
    invited_by: typeof invitedBy === 'string' && getUserById(invitedBy) ? invitedBy : null,
  });
  // If invited, credit the inviter
  if (typeof invitedBy === 'string' && getUserById(invitedBy)) {
    db.prepare('UPDATE users SET invites_accepted = invites_accepted + 1 WHERE id = ?').run(invitedBy);
  }
  return makeToken(id);
}

export async function login({ email, password }) {
  if (typeof email !== 'string' || typeof password !== 'string')
    throw new Error(GENERIC_AUTH_ERROR);
  const u = getUserByEmail(email);
  // Run bcrypt.compare even when user not found to keep timing constant.
  // Without this, an attacker can probe valid emails by measuring response time.
  const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuuJv6vWcXDBcuFRdGB.YDOaA1u0aB1tEK';
  const hash = u ? u.pw_hash : DUMMY_HASH;
  const ok = await bcrypt.compare(password, hash);
  if (!u || !ok) throw new Error(GENERIC_AUTH_ERROR);
  return makeToken(u.id);
}

export function makeToken(userId) {
  return jwt.sign({ uid: userId }, EFFECTIVE_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token) {
  try { return jwt.verify(token, EFFECTIVE_SECRET); }
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
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
