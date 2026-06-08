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
  last_seen BIGINT NOT NULL DEFAULT 0,
  elo_checkers_8 INTEGER NOT NULL DEFAULT 1200,
  elo_checkers_10 INTEGER NOT NULL DEFAULT 1200,
  checkers8_games INTEGER NOT NULL DEFAULT 0,
  checkers10_games INTEGER NOT NULL DEFAULT 0
);
-- Idempotent for pre-existing Postgres databases created before last_seen.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen BIGINT NOT NULL DEFAULT 0;
-- Checkers ratings (additive; NEVER touch the chess elo column).
ALTER TABLE users ADD COLUMN IF NOT EXISTS elo_checkers_8 INTEGER NOT NULL DEFAULT 1200;
ALTER TABLE users ADD COLUMN IF NOT EXISTS elo_checkers_10 INTEGER NOT NULL DEFAULT 1200;
-- Per-board-size ranked checkers games-played counters (participation filter).
ALTER TABLE users ADD COLUMN IF NOT EXISTS checkers8_games INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS checkers10_games INTEGER NOT NULL DEFAULT 0;
-- Stripe subscription billing (additive; inert until Stripe is configured).
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT '';

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
  game_type TEXT NOT NULL DEFAULT 'chess',
  variant TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (white_id) REFERENCES users(id),
  FOREIGN KEY (black_id) REFERENCES users(id)
);
-- Additive game-type tags so the games table can also record checkers rows.
ALTER TABLE games ADD COLUMN IF NOT EXISTS game_type TEXT NOT NULL DEFAULT 'chess';
ALTER TABLE games ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT '';

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

-- Social-share counts: one row per platform, incremented via upsert. Powers the
-- admin dashboard's "which platform is used most to share" stat.
CREATE TABLE IF NOT EXISTS share_counts (
  platform TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT
);

-- Stripe billing: payments ledger. One row per recorded revenue event;
-- stripe_event_id is UNIQUE so webhook retries can't double-count (idempotent).
-- Amounts stored in the smallest currency unit (cents). No FKs (a payment can
-- still be recorded if the user row is missing/late).
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  stripe_event_id TEXT UNIQUE,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'usd',
  kind TEXT DEFAULT 'subscription',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);
`);
}

// --- Stripe billing (async mirrors of db.js) -------------------------------

// Persist the Stripe Customer id for a user (set on first checkout).
export async function setStripeCustomer(userId, customerId) {
  await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, userId]);
}

// Flip a user's premium flag + subscription status, keyed by Stripe Customer id.
export async function setPremiumByCustomer(customerId, isPremium, status) {
  await pool.query('UPDATE users SET is_premium = $1, subscription_status = $2 WHERE stripe_customer_id = $3',
    [isPremium ? 1 : 0, status == null ? '' : String(status), customerId]);
}

// Flip a user's premium flag + subscription status, keyed by user id.
export async function setPremiumByUserId(userId, isPremium, status) {
  await pool.query('UPDATE users SET is_premium = $1, subscription_status = $2 WHERE id = $3',
    [isPremium ? 1 : 0, status == null ? '' : String(status), userId]);
}

// Idempotently record a revenue event (ON CONFLICT (stripe_event_id) DO NOTHING
// so a webhook retry for the same event is a no-op; the amount is counted once).
export async function recordPayment({ userId, eventId, amountCents, currency, kind, createdAt }) {
  await pool.query(`INSERT INTO payments
      (id, user_id, stripe_event_id, amount_cents, currency, kind, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (stripe_event_id) DO NOTHING`,
    [
      'pay_' + (eventId || ('x' + Math.random().toString(36).slice(2))),
      userId || null,
      eventId || null,
      Number(amountCents) || 0,
      currency || 'usd',
      kind || 'subscription',
      Number(createdAt) || Date.now(),
    ]);
}

export async function getUserByStripeCustomer(customerId) {
  if (!customerId) return undefined;
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE stripe_customer_id = $1 AND stripe_customer_id <> ''", [customerId]);
  return rows[0];
}

// Revenue rollups for the admin dashboard. Current calendar month, current
// calendar year, all-time, plus active-subscriber count (is_premium = 1).
// Boundaries use the SERVER's clock.
export async function revenueStats() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
  const sum = async (sql, p = []) => { const r = await pool.query(sql, p); return r.rows[0] && r.rows[0].s != null ? Number(r.rows[0].s) : 0; };
  const monthCents = await sum('SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE created_at >= $1', [monthStart]);
  const yearCents = await sum('SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE created_at >= $1', [yearStart]);
  const allTimeCents = await sum('SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments');
  const subRes = await pool.query('SELECT COUNT(*) AS n FROM users WHERE is_premium = 1');
  const activeSubscribers = subRes.rows[0] ? Number(subRes.rows[0].n) : 0;
  return { monthCents, yearCents, allTimeCents, activeSubscribers, currency: 'usd' };
}

// Increment (or create) the counter for a share platform. Idempotent upsert.
export async function incShareCount(platform) {
  await pool.query(`
    INSERT INTO share_counts (platform, count, updated_at) VALUES ($1, 1, $2)
    ON CONFLICT(platform) DO UPDATE SET count = share_counts.count + 1, updated_at = excluded.updated_at
  `, [platform, Date.now()]);
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
    // Checkers leaderboards (additive). Each sorts by the matching checkers Elo.
    checkers8: 'elo_checkers_8',
    checkers10: 'elo_checkers_10',
  };
  // Participation filter, keyed by the SAME canonical metric (a fixed code map,
  // never raw input — injection-safe). A leaderboard must only list users who
  // actually played/earned in that match type, not every registered user.
  // Unknown metric falls through to the elo filter (and elo ordering, below).
  // trophies uses the same jsonb_array_length expression as trophiesExpr.
  const participation = {
    elo: '(wins + losses + draws) > 0',
    wins: 'wins > 0',
    streak: 'best_streak > 0', best_streak: 'best_streak > 0',
    invites_accepted: 'invites_accepted > 0',
    trophies: `${trophiesExpr} > 0`,
    checkers8: 'checkers8_games > 0',
    checkers10: 'checkers10_games > 0',
  };
  const orderExpr = allowed[metric] || 'elo';
  const whereExpr = participation[metric] || participation.elo;
  const { rows } = await pool.query(
    `SELECT id, username, region, elo, wins, losses, best_streak, is_premium,
            elo_checkers_8, elo_checkers_10, checkers8_games, checkers10_games,
            ${trophiesExpr} AS trophies
     FROM users WHERE ${whereExpr} ORDER BY ${orderExpr} DESC, elo DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

// Admin user directory (async mirror of db.js adminListUsers). Same allowlisted
// ORDER BY; `q` uses ILIKE for case-insensitive substring match (Postgres
// equivalent of LIKE ... COLLATE NOCASE). All SQL is parameterized.
const ADMIN_USER_SORTS = {
  elo: 'elo DESC, id ASC',
  checkers8: 'elo_checkers_8 DESC, id ASC',
  checkers10: 'elo_checkers_10 DESC, id ASC',
  games: '(wins + losses + draws) DESC, id ASC',
  recent: 'last_seen DESC, id ASC',
  joined: 'created_at DESC, id ASC',
};
export async function adminListUsers({ sort = 'elo', limit = 1000, q = '' } = {}) {
  const orderExpr = ADMIN_USER_SORTS[sort] || ADMIN_USER_SORTS.elo;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 1000, 1), 1000);
  const trimmed = String(q == null ? '' : q).trim();
  let where = '';
  const whereParams = [];
  if (trimmed) {
    const escaped = trimmed.replace(/[\\%_]/g, c => '\\' + c);
    const pattern = '%' + escaped + '%';
    where = "WHERE (username ILIKE $1 ESCAPE '\\' OR email ILIKE $2 ESCAPE '\\')";
    whereParams.push(pattern, pattern);
  }
  const totalRes = await pool.query(`SELECT COUNT(*) AS n FROM users ${where}`, whereParams);
  const total = totalRes.rows[0] ? Number(totalRes.rows[0].n) : 0;
  // Limit placeholder follows the (0 or 2) where params positionally.
  const limPlaceholder = '$' + (whereParams.length + 1);
  const res = await pool.query(`
    SELECT id, username, email, elo, elo_checkers_8, elo_checkers_10,
           wins, losses, draws, last_seen, created_at, email_verified, is_premium
    FROM users ${where}
    ORDER BY ${orderExpr} LIMIT ${limPlaceholder}
  `, [...whereParams, lim]);
  const users = res.rows.map(r => ({
    id: r.id, username: r.username, email: r.email,
    elo: r.elo, eloCheckers8: r.elo_checkers_8, eloCheckers10: r.elo_checkers_10,
    wins: r.wins, losses: r.losses, draws: r.draws,
    games: (r.wins || 0) + (r.losses || 0) + (r.draws || 0),
    lastSeen: r.last_seen, createdAt: r.created_at,
    emailVerified: !!r.email_verified, isPremium: !!r.is_premium,
  }));
  return { total, users };
}
