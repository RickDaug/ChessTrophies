// PostgreSQL persistence backend (async).
//
// This is the horizontally-scalable persistence tier for the Redis-backed
// multi-replica deployment (audit finding PE-M1). It is ONLY loaded when
// `DATABASE_URL` is set; the zero-config default remains better-sqlite3 (db.js).
//
// node-postgres (`pg`) is ASYNC, so every export here returns a Promise. The
// matching synchronous SQLite backend lives in db.js; the unified async facade
// in store.js selects between the two at startup. Keeping the two backends in
// separate files (rather than a runtime swap inside db.js) avoids loading the
// `pg` driver at all in the SQLite default path, so local dev and the test
// suite need no Postgres and no new infrastructure.
//
// SQL translation notes (SQLite -> Postgres), all applied below:
//   * Placeholders `?` -> `$1, $2, ...` (positional, 1-based).
//   * Integer time columns stay BIGINT (we store Date.now() ms, never SQL
//     datetime), so no datetime() translation is needed.
//   * Boolean-ish INTEGER columns (is_premium, email_verified, used) stay
//     INTEGER to keep the row shape identical to SQLite for callers.
//   * `INSERT OR IGNORE` -> `INSERT ... ON CONFLICT DO NOTHING`.
//   * `ON CONFLICT(col) DO UPDATE SET x = excluded.x` is already valid Postgres
//     (Postgres also spells it `excluded`), kept as-is.
//   * `json_array_length(col)` -> `jsonb_array_length(col::jsonb)` (the columns
//     are TEXT holding JSON; cast to jsonb for the length function).
//   * `LIKE ... ESCAPE '\' COLLATE NOCASE` -> case-insensitive `ILIKE ... ESCAPE
//     '\'` (Postgres has no per-query COLLATE NOCASE; ILIKE is the idiomatic
//     case-insensitive match). LIKE-wildcard escaping of user input is preserved
//     identically.
//   * `LOWER(username) = LOWER(?)` is portable, kept as-is.
//   * No AUTOINCREMENT is used anywhere (all PKs are app-generated TEXT ids), so
//     nothing to translate there.
import pg from 'pg';

const { Pool } = pg;

// One shared pool per process. Sizing is conservative; tune via PGPOOL_MAX.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PGPOOL_MAX, 10) || 10,
  // Render/Railway/Fly managed Postgres usually require TLS. Allow opting in
  // without a CA bundle via PGSSL=1 (rejectUnauthorized:false), or out via
  // PGSSL=0. Default: enable relaxed TLS when the URL looks remote.
  ssl: resolveSsl(),
});

function resolveSsl() {
  const flag = process.env.PGSSL;
  if (flag === '0' || flag === 'false') return false;
  if (flag === '1' || flag === 'true') return { rejectUnauthorized: false };
  const url = process.env.DATABASE_URL || '';
  // Local connections don't need TLS; remote managed DBs typically do.
  if (/localhost|127\.0\.0\.1/.test(url)) return false;
  return { rejectUnauthorized: false };
}

// Low-level helpers ---------------------------------------------------------

// Run a single parameterized query on a pooled connection.
export async function query(text, params = []) {
  return pool.query(text, params);
}

// Run `fn(client)` inside a BEGIN/COMMIT transaction on one dedicated client,
// rolling back on any throw. Mirrors better-sqlite3's db.transaction() but is
// async: callers can `await` inside `fn`. Always releases the client.
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

// Schema --------------------------------------------------------------------

// Create the schema if absent. Idempotent — safe to call on every boot. Ported
// 1:1 from db.js. Postgres supports `ADD COLUMN IF NOT EXISTS`, so the
// SQLite PRAGMA-probe migration shim is unnecessary here.
export async function init() {
  await pool.query(`
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
  created_at BIGINT NOT NULL,
  elo_2v2 INTEGER NOT NULL DEFAULT 1200,
  wins_2v2 INTEGER NOT NULL DEFAULT 0,
  losses_2v2 INTEGER NOT NULL DEFAULT 0,
  draws_2v2 INTEGER NOT NULL DEFAULT 0,
  avatar_stock TEXT NOT NULL DEFAULT 'av_knight',
  avatar_data_url TEXT NOT NULL DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0,
  last_seen BIGINT NOT NULL DEFAULT 0
);
-- Idempotent for pre-existing Postgres databases created before last_seen.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS friendships (
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
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
  created_at BIGINT NOT NULL,
  ended_at BIGINT,
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
  winner_color TEXT,
  pgn TEXT,
  white_avg_elo_before INTEGER,
  black_avg_elo_before INTEGER,
  white_elo_delta INTEGER,
  black_elo_delta INTEGER,
  created_at BIGINT NOT NULL,
  ended_at BIGINT,
  FOREIGN KEY (white_p1_id) REFERENCES users(id),
  FOREIGN KEY (white_p2_id) REFERENCES users(id),
  FOREIGN KEY (black_p1_id) REFERENCES users(id),
  FOREIGN KEY (black_p2_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS friend_requests (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (from_id, to_id),
  FOREIGN KEY (from_id) REFERENCES users(id),
  FOREIGN KEY (to_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  FOREIGN KEY (blocker_id) REFERENCES users(id),
  FOREIGN KEY (blocked_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS email_verifications (
  user_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo DESC);
CREATE INDEX IF NOT EXISTS idx_users_wins ON users(wins DESC);
CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_games_created ON team_games(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
`);
}

// Helpers (async mirrors of db.js) -----------------------------------------

// Both backends return row objects with the same column names so callers can be
// backend-agnostic. pg returns `rows`; we unwrap to match better-sqlite3's
// .get() (single row | undefined) and .all() (array) semantics.

export async function areBlocked(a, b) {
  const { rows } = await pool.query(
    `SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $3 AND blocked_id = $4) LIMIT 1`,
    [a, b, b, a]
  );
  return rows.length > 0;
}

export async function getUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0];
}

export async function getUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  return rows[0];
}

export async function getUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  return rows[0];
}

export async function createUser(u) {
  await pool.query(
    `INSERT INTO users (id, email, username, region, pw_hash, invited_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [u.id, u.email, u.username, u.region || '', u.pw_hash, u.invited_by || null, Date.now()]
  );
}

// --- Learning-progress sync (stored under users.flags JSON `progress` key) ---

function parseFlags(user) {
  try {
    const obj = user && user.flags ? JSON.parse(user.flags) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

export function getProgress(user) {
  const flags = parseFlags(user);
  const p = flags.progress && typeof flags.progress === 'object' ? flags.progress : {};
  return {
    lessonsCompleted: Array.isArray(p.lessonsCompleted) ? p.lessonsCompleted : [],
    puzzles: p.puzzles && typeof p.puzzles === 'object' ? p.puzzles : {},
  };
}

export async function setProgress(userId, progress) {
  const user = await getUserById(userId);
  if (!user) throw new Error('User not found.');
  const flags = parseFlags(user);
  flags.progress = {
    lessonsCompleted: Array.isArray(progress.lessonsCompleted) ? progress.lessonsCompleted : [],
    puzzles: progress.puzzles && typeof progress.puzzles === 'object' ? progress.puzzles : {},
  };
  await pool.query('UPDATE users SET flags = $1 WHERE id = $2', [JSON.stringify(flags), userId]);
  return flags.progress;
}

// Prefix search for friend autocomplete. Same LIKE-wildcard escaping as the
// SQLite backend; uses ILIKE for case-insensitivity (Postgres equivalent of
// `LIKE ... COLLATE NOCASE`). All SQL is parameterized.
export async function searchUsersByUsername(prefix, excludeId, limit = 8) {
  const trimmed = String(prefix == null ? '' : prefix).trim();
  if (trimmed.length < 1) return [];
  const lim = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 20);
  const escaped = trimmed.replace(/[\\%_]/g, c => '\\' + c);
  const pattern = escaped + '%';
  const { rows } = await pool.query(`
    SELECT id, username, elo FROM users
    WHERE username ILIKE $1 ESCAPE '\\'
      AND id <> $2
      AND id NOT IN (SELECT friend_id FROM friendships WHERE user_id = $3)
      AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $4)
      AND id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = $5)
    ORDER BY LOWER(username)
    LIMIT $6
  `, [pattern, excludeId, excludeId, excludeId, excludeId, lim]);
  return rows;
}

export async function topByMetric(metric, limit = 100) {
  // Same allowlist-of-sort-expressions design as the SQLite backend: the metric
  // name is mapped through a fixed table, NEVER interpolated from user input, so
  // there is no SQL-injection surface despite the dynamic ORDER BY.
  // json_array_length -> jsonb_array_length(col::jsonb) for Postgres.
  const trophiesExpr = '(jsonb_array_length(achievements::jsonb) + jsonb_array_length(streak_trophies::jsonb))';
  const allowed = {
    elo: 'elo', wins: 'wins',
    streak: 'best_streak', best_streak: 'best_streak',
    invites_accepted: 'invites_accepted',
    trophies: trophiesExpr,
  };
  const orderExpr = allowed[metric] || 'elo';
  const { rows } = await pool.query(
    `SELECT id, username, region, elo, wins, losses, best_streak, is_premium,
            ${trophiesExpr} AS trophies
     FROM users ORDER BY ${orderExpr} DESC, elo DESC LIMIT $1`,
    [limit]
  );
  return rows;
}
