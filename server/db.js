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
// Email verification (soft): 0 until the user confirms their email via the link
// we send on signup. Unverified users can still play; the client just nudges them.
ensureColumn('users', 'email_verified', 'INTEGER', '0');
// Last activity timestamp (ms) — set on login + socket auth. Powers the admin
// "active users" stats. 0 = never seen since this column was added.
ensureColumn('users', 'last_seen', 'INTEGER', '0');
// --- Checkers ratings (additive; NEVER touch the chess `elo` column) ---
// Separate Elo per board size: 8x8 (ACF) and 10x10 (FMJD). Both default 1200.
ensureColumn('users', 'elo_checkers_8', 'INTEGER', '1200');
ensureColumn('users', 'elo_checkers_10', 'INTEGER', '1200');
// Tag game rows by type/variant so the existing `games` table can also record
// checkers games. Existing rows default to chess (game_type='chess'), so the
// historical data is unchanged. `variant` holds the checkers board size as a
// string ('8'|'10') for checkers rows; '' for chess.
ensureColumn('games', 'game_type', 'TEXT', "'chess'");
ensureColumn('games', 'variant', 'TEXT', "''");

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

// Social-share counts: one row per platform, incremented via upsert. Powers the
// admin dashboard's "which platform is used most to share" stat. Transient/
// aggregate telemetry (no FKs).
db.exec(`
CREATE TABLE IF NOT EXISTS share_counts (
  platform TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER
);
`);

// Increment (or create) the counter for a share platform. Idempotent upsert.
export function incShareCount(platform) {
  return db.prepare(`
    INSERT INTO share_counts (platform, count, updated_at) VALUES (?, 1, ?)
    ON CONFLICT(platform) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at
  `).run(platform, Date.now());
}

// Email verification: a per-user 6-digit code (one live code per user) with an
// attempt counter to throttle guessing. We store only the sha256 of the code.
// Migration: an earlier version keyed this table by a long link token
// (token_hash PK); drop that shape and recreate. The data is transient (users
// can just request a new code), so dropping is safe.
{
  const cols = db.prepare('PRAGMA table_info(email_verifications)').all();
  if (cols.length && cols.some((c) => c.name === 'token_hash')) {
    db.exec('DROP TABLE email_verifications');
  }
}
db.exec(`
CREATE TABLE IF NOT EXISTS email_verifications (
  user_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
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
  // Map the client's metric names to a sort expression. `trophies` and `streak`
  // are aliases the leaderboard UI uses; trophies is the combined count of the
  // achievements + streak_trophies JSON arrays (SQLite JSON1, built into
  // better-sqlite3). Every row defaults those columns to '[]', so the length
  // expression is always valid.
  const trophiesExpr = '(json_array_length(achievements) + json_array_length(streak_trophies))';
  const allowed = {
    elo: 'elo', wins: 'wins',
    streak: 'best_streak', best_streak: 'best_streak',
    invites_accepted: 'invites_accepted',
    trophies: trophiesExpr,
    // Checkers leaderboards (additive). Each sorts by the matching checkers Elo.
    checkers8: 'elo_checkers_8',
    checkers10: 'elo_checkers_10',
  };
  const orderExpr = allowed[metric] || 'elo';
  return db.prepare(`SELECT id, username, region, elo, wins, losses, best_streak, is_premium,
                            elo_checkers_8, elo_checkers_10,
                            ${trophiesExpr} AS trophies
                     FROM users ORDER BY ${orderExpr} DESC, elo DESC LIMIT ?`).all(limit);
}

// Admin user directory: list users with usernames + emails (and ratings/record)
// for the admin dashboard. `sort` is allowlisted to a fixed ORDER BY expression
// (never interpolated from raw input). `q` is an optional case-insensitive
// substring match on username OR email (LIKE wildcards in the input are escaped).
// Returns { total, users:[...] } where total ignores the limit (but honors q).
const ADMIN_USER_SORTS = {
  elo: 'elo DESC, id ASC',
  checkers8: 'elo_checkers_8 DESC, id ASC',
  checkers10: 'elo_checkers_10 DESC, id ASC',
  games: '(wins + losses + draws) DESC, id ASC',
  recent: 'last_seen DESC, id ASC',
  joined: 'created_at DESC, id ASC',
};
export function adminListUsers({ sort = 'elo', limit = 1000, q = '' } = {}) {
  const orderExpr = ADMIN_USER_SORTS[sort] || ADMIN_USER_SORTS.elo;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 1000, 1), 1000);
  const trimmed = String(q == null ? '' : q).trim();
  let where = '';
  const whereParams = [];
  if (trimmed) {
    // Escape LIKE special chars; case-insensitive substring on username OR email.
    const escaped = trimmed.replace(/[\\%_]/g, c => '\\' + c);
    const pattern = '%' + escaped + '%';
    where = "WHERE (username LIKE ? ESCAPE '\\' COLLATE NOCASE OR email LIKE ? ESCAPE '\\' COLLATE NOCASE)";
    whereParams.push(pattern, pattern);
  }
  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM users ${where}`).get(...whereParams);
  const total = totalRow ? Number(totalRow.n) : 0;
  const rows = db.prepare(`
    SELECT id, username, email, elo, elo_checkers_8, elo_checkers_10,
           wins, losses, draws, last_seen, created_at, email_verified, is_premium
    FROM users ${where}
    ORDER BY ${orderExpr} LIMIT ?
  `).all(...whereParams, lim);
  const users = rows.map(r => ({
    id: r.id, username: r.username, email: r.email,
    elo: r.elo, eloCheckers8: r.elo_checkers_8, eloCheckers10: r.elo_checkers_10,
    wins: r.wins, losses: r.losses, draws: r.draws,
    games: (r.wins || 0) + (r.losses || 0) + (r.draws || 0),
    lastSeen: r.last_seen, createdAt: r.created_at,
    emailVerified: !!r.email_verified, isPremium: !!r.is_premium,
  }));
  return { total, users };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Schema initialised at', dbPath);
}
