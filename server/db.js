// SQLite schema and access layer.
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data.db');

// Ensure the DB's parent directory exists (e.g. a mounted volume path like /data).
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  region TEXT,
  pw_hash TEXT NOT NULL,
  elo INTEGER NOT NULL DEFAULT 1200,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  is_premium INTEGER NOT NULL DEFAULT 0,
  invited_by TEXT,
  invites_accepted INTEGER NOT NULL DEFAULT 0,
  achievements TEXT NOT NULL DEFAULT '[]',
  streak_trophies TEXT NOT NULL DEFAULT '[]',
  flags TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS friendships (
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (friend_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  white_id TEXT NOT NULL,
  black_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  result TEXT,
  winner_id TEXT,
  pgn TEXT,
  white_elo_before INTEGER,
  black_elo_before INTEGER,
  white_elo_delta INTEGER,
  black_elo_delta INTEGER,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  FOREIGN KEY (white_id) REFERENCES users(id),
  FOREIGN KEY (black_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (host_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS team_games (
  id TEXT PRIMARY KEY,
  white_p1_id TEXT NOT NULL,
  white_p2_id TEXT NOT NULL,
  black_p1_id TEXT NOT NULL,
  black_p2_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  result TEXT,
  winner_color TEXT, -- 'w' | 'b' | NULL (draw)
  pgn TEXT,
  white_avg_elo_before INTEGER,
  black_avg_elo_before INTEGER,
  white_elo_delta INTEGER,
  black_elo_delta INTEGER,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  FOREIGN KEY (white_p1_id) REFERENCES users(id),
  FOREIGN KEY (white_p2_id) REFERENCES users(id),
  FOREIGN KEY (black_p1_id) REFERENCES users(id),
  FOREIGN KEY (black_p2_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo DESC);
CREATE INDEX IF NOT EXISTS idx_users_wins ON users(wins DESC);
CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_games_created ON team_games(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
`);

// Idempotent migrations: add 2v2-specific columns to users if they don't exist.
// SQLite has no IF NOT EXISTS for ADD COLUMN before 3.35, so we probe the schema.
function ensureColumn(table, col, type, defaultLiteral) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  if (info.some(r => r.name === col)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type} NOT NULL DEFAULT ${defaultLiteral}`);
}
ensureColumn('users', 'elo_2v2', 'INTEGER', '1200');
ensureColumn('users', 'wins_2v2', 'INTEGER', '0');
ensureColumn('users', 'losses_2v2', 'INTEGER', '0');
ensureColumn('users', 'draws_2v2', 'INTEGER', '0');
// Avatar (chosen on the client; mirrored here so opponents can see it in-game).
ensureColumn('users', 'avatar_stock', 'TEXT', "'av_knight'");
ensureColumn('users', 'avatar_data_url', 'TEXT', "''");

// Pending friend requests (from_id asked to befriend to_id; awaiting consent).
// Confirmed friendships still live in the `friendships` table.
db.exec(`
CREATE TABLE IF NOT EXISTS friend_requests (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id),
  FOREIGN KEY (from_id) REFERENCES users(id),
  FOREIGN KEY (to_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  FOREIGN KEY (blocker_id) REFERENCES users(id),
  FOREIGN KEY (blocked_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
`);

// True if either user has blocked the other (block is symmetric for matchmaking
// and friend-request purposes).
export function areBlocked(a, b) {
  const row = db.prepare(
    `SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1`
  ).get(a, b, b, a);
  return !!row;
}

// Helpers
export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
}
export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username);
}
export function createUser(u) {
  db.prepare(`INSERT INTO users (id, email, username, region, pw_hash, invited_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(u.id, u.email, u.username, u.region || '', u.pw_hash, u.invited_by || null, Date.now());
}
// --- Learning-progress sync (stored under users.flags JSON `progress` key) ---

function parseFlags(user) {
  try {
    const obj = user && user.flags ? JSON.parse(user.flags) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

// Read a user's learning progress, defaulting to an empty shape.
export function getProgress(user) {
  const flags = parseFlags(user);
  const p = flags.progress && typeof flags.progress === 'object' ? flags.progress : {};
  return {
    lessonsCompleted: Array.isArray(p.lessonsCompleted) ? p.lessonsCompleted : [],
    puzzles: p.puzzles && typeof p.puzzles === 'object' ? p.puzzles : {},
  };
}

// Persist progress back into the user's flags JSON, preserving other flags.
export function setProgress(userId, progress) {
  const user = getUserById(userId);
  if (!user) throw new Error('User not found.');
  const flags = parseFlags(user);
  flags.progress = {
    lessonsCompleted: Array.isArray(progress.lessonsCompleted) ? progress.lessonsCompleted : [],
    puzzles: progress.puzzles && typeof progress.puzzles === 'object' ? progress.puzzles : {},
  };
  db.prepare('UPDATE users SET flags = ? WHERE id = ?').run(JSON.stringify(flags), userId);
  return flags.progress;
}

// Search users by a username prefix for friend autocomplete. Case-insensitive
// prefix match (LIKE prefix || '%'), excluding the requester (excludeId) and any
// user who is already a friend of the requester. LIKE wildcards in `prefix` are
// escaped so user input cannot inject wildcards. All SQL is parameterized.
export function searchUsersByUsername(prefix, excludeId, limit = 8) {
  const trimmed = String(prefix == null ? '' : prefix).trim();
  if (trimmed.length < 1) return [];
  const lim = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 20);
  // Escape LIKE special characters (% _ \) and match a prefix with an explicit ESCAPE.
  const escaped = trimmed.replace(/[\\%_]/g, c => '\\' + c);
  const pattern = escaped + '%';
  return db.prepare(`
    SELECT id, username, elo FROM users
    WHERE username LIKE ? ESCAPE '\\' COLLATE NOCASE
      AND id <> ?
      AND id NOT IN (SELECT friend_id FROM friendships WHERE user_id = ?)
      AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
      AND id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
    ORDER BY username COLLATE NOCASE
    LIMIT ?
  `).all(pattern, excludeId, excludeId, excludeId, excludeId, lim);
}

export function topByMetric(metric, limit = 100) {
  const allowed = { elo: 'elo', wins: 'wins', best_streak: 'best_streak', invites_accepted: 'invites_accepted' };
  const col = allowed[metric] || 'elo';
  return db.prepare(`SELECT id, username, region, elo, wins, losses, best_streak, is_premium
                     FROM users ORDER BY ${col} DESC LIMIT ?`).all(limit);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Schema initialised at', dbPath);
}
