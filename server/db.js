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
// Per-board-size ranked checkers games-played counters. Powers the checkers
// leaderboards' participation filter (only list users who actually played a
// ranked game at that board size). Additive; default 0.
ensureColumn('users', 'checkers8_games', 'INTEGER', '0');
ensureColumn('users', 'checkers10_games', 'INTEGER', '0');
// Token version — bumped on password reset/change to revoke all previously-issued
// JWTs (a stolen 30-day token dies the moment the owner resets their password).
ensureColumn('users', 'token_version', 'INTEGER', '0');
// Durable count of arena tournaments this user has won (crowned champion at the
// bell). Incremented in arena finalize; shown on the profile + rankings.
ensureColumn('users', 'arena_wins', 'INTEGER', '0');
// Tag game rows by type/variant so the existing `games` table can also record
// checkers games. Existing rows default to chess (game_type='chess'), so the
// historical data is unchanged. `variant` holds the checkers board size as a
// string ('8'|'10') for checkers rows; '' for chess.
ensureColumn('games', 'game_type', 'TEXT', "'chess'");
ensureColumn('games', 'variant', 'TEXT', "''");
// --- Stripe subscription billing (additive; inert until Stripe is configured) ---
// The Stripe Customer id for this user (set on first checkout) and the latest
// subscription status string from Stripe webhooks. Default '' = no billing yet.
ensureColumn('users', 'stripe_customer_id', 'TEXT', "''");
ensureColumn('users', 'subscription_status', 'TEXT', "''");

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

// --- Puzzle progress (daily challenge / trainer) ---------------------------
// Tracks which puzzles a user has solved (idempotent, one row per user+puzzle)
// and a per-user daily-solve streak. Additive + self-contained: nothing else in
// the schema depends on these tables, so they are safe to create lazily here.
db.exec(`
CREATE TABLE IF NOT EXISTS puzzle_solves (
  user_id TEXT NOT NULL,
  puzzle_id TEXT NOT NULL,
  solved_at INTEGER NOT NULL,
  day_key TEXT NOT NULL,
  PRIMARY KEY (user_id, puzzle_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_puzzle_solves_user ON puzzle_solves(user_id);
CREATE TABLE IF NOT EXISTS puzzle_streaks (
  user_id TEXT PRIMARY KEY,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  last_day_key TEXT NOT NULL DEFAULT '',
  total_solved INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
-- Per-user puzzle rating (Glicko-lite). Default 1200 / rd 350 (a fresh, very
-- uncertain rating that converges fast). One row per user; created lazily on
-- the first verified solve or fail.
CREATE TABLE IF NOT EXISTS puzzle_ratings (
  user_id TEXT PRIMARY KEY,
  rating INTEGER NOT NULL DEFAULT 1200,
  rd INTEGER NOT NULL DEFAULT 350,
  solved INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
-- Idempotent per-user+puzzle+day attempt result. Anti-abuse: a given puzzle can
-- only move a user's rating ONCE per UTC day (whether solved or failed), so a
-- fail can't be spammed to grief and a solve can't be farmed for rating. The
-- result column records the first scored outcome for that user/puzzle/day.
CREATE TABLE IF NOT EXISTS puzzle_attempts (
  user_id TEXT NOT NULL,
  puzzle_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  result TEXT NOT NULL,            -- 'solved' | 'failed'
  rated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, puzzle_id, day_key),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_puzzle_attempts_user ON puzzle_attempts(user_id);
-- Puzzle Rush: per-user best score + a history of completed runs.
CREATE TABLE IF NOT EXISTS rush_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'timed',
  ended_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_rush_scores_user ON rush_scores(user_id);
`);

// Return the YYYY-MM-DD before `dayKey` (UTC). Used to detect a consecutive
// daily streak. `dayKey` is the canonical UTC date string the API derives.
function previousDayKey(dayKey) {
  const d = new Date(dayKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Idempotently record that `userId` solved `puzzleId` on UTC day `dayKey`, and
// advance the daily streak. Returns the resulting streak summary. Calling it
// again for the SAME puzzle is a no-op for both the solve row and the streak
// (so a double-submit can't inflate the streak). The streak counts CONSECUTIVE
// UTC days on which the user solved at least one puzzle:
//   - first solve ever, or a gap of 2+ days -> streak resets to 1
//   - solved yesterday -> streak += 1
//   - already counted today -> unchanged
export function recordPuzzleSolved(userId, puzzleId, dayKey, solvedAt = Date.now()) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO puzzle_solves (user_id, puzzle_id, solved_at, day_key) VALUES (?, ?, ?, ?)'
  );
  const tx = db.transaction(() => {
    const res = insert.run(userId, puzzleId, solvedAt, dayKey);
    const firstTime = res.changes > 0;
    let row = db.prepare('SELECT * FROM puzzle_streaks WHERE user_id = ?').get(userId);
    if (!row) {
      db.prepare('INSERT INTO puzzle_streaks (user_id, current_streak, best_streak, last_day_key, total_solved) VALUES (?, 0, 0, \'\', 0)').run(userId);
      row = { current_streak: 0, best_streak: 0, last_day_key: '', total_solved: 0 };
    }
    let { current_streak, best_streak, last_day_key, total_solved } = row;
    if (firstTime) total_solved += 1;
    // Only advance the streak when this is a NEW day for the user.
    if (last_day_key !== dayKey) {
      if (last_day_key === previousDayKey(dayKey)) current_streak += 1;
      else current_streak = 1;
      last_day_key = dayKey;
      if (current_streak > best_streak) best_streak = current_streak;
    }
    db.prepare('UPDATE puzzle_streaks SET current_streak = ?, best_streak = ?, last_day_key = ?, total_solved = ? WHERE user_id = ?')
      .run(current_streak, best_streak, last_day_key, total_solved, userId);
    return { solved: true, alreadySolved: !firstTime, currentStreak: current_streak, bestStreak: best_streak, totalSolved: total_solved };
  });
  return tx();
}

// Read a user's puzzle progress summary (streak + total). Defaults to zeros.
export function getPuzzleProgress(userId) {
  const row = db.prepare('SELECT current_streak, best_streak, last_day_key, total_solved FROM puzzle_streaks WHERE user_id = ?').get(userId);
  if (!row) return { currentStreak: 0, bestStreak: 0, lastDayKey: '', totalSolved: 0, solvedIds: [] };
  const ids = db.prepare('SELECT puzzle_id FROM puzzle_solves WHERE user_id = ?').all(userId).map(r => r.puzzle_id);
  return { currentStreak: row.current_streak, bestStreak: row.best_streak, lastDayKey: row.last_day_key, totalSolved: row.total_solved, solvedIds: ids };
}

// --- Per-user puzzle rating (Glicko-lite) ----------------------------------
//
// A lightweight Glicko-style update: the user has a `rating` and a rating
// deviation `rd` (uncertainty). Each scored attempt is a single "game" against
// the PUZZLE (whose rating is fixed/known), with outcome 1 (solved) or 0
// (failed). New players start at 1200 / rd 350 so early results move the rating
// a lot (fast convergence); rd shrinks toward a floor (~60) as they play, so a
// settled rating is stable. This is intentionally simpler than full Glicko-2
// (no volatility, no rating-period batching) but captures the two properties we
// want: provisional ratings move fast, established ratings move slowly, and the
// move is larger when the result is more surprising.
export const PUZZLE_RATING_DEFAULT = 1200;
export const PUZZLE_RD_DEFAULT = 350;
const PUZZLE_RD_FLOOR = 60;
const PUZZLE_Q = Math.log(10) / 400; // 0.0057565

function glickoG(rd) { return 1 / Math.sqrt(1 + (3 * PUZZLE_Q * PUZZLE_Q * rd * rd) / (Math.PI * Math.PI)); }

// Compute the new {rating, rd} for one outcome (score 1=win, 0=loss) vs an
// opponent of `oppRating`. Pure + exported so it is unit-testable.
export function glickoUpdate(rating, rd, oppRating, score) {
  const g = glickoG(rd);
  const E = 1 / (1 + Math.pow(10, (g * (oppRating - rating)) / 400));
  const dSq = 1 / (PUZZLE_Q * PUZZLE_Q * g * g * E * (1 - E));
  const denom = 1 / (rd * rd) + 1 / dSq;
  let newRating = rating + (PUZZLE_Q / denom) * g * (score - E);
  let newRd = Math.sqrt(1 / denom);
  if (newRd < PUZZLE_RD_FLOOR) newRd = PUZZLE_RD_FLOOR;
  if (newRd > PUZZLE_RD_DEFAULT) newRd = PUZZLE_RD_DEFAULT;
  // Clamp the rating to a sane chess-puzzle band.
  newRating = Math.max(400, Math.min(3000, newRating));
  return { rating: Math.round(newRating), rd: Math.round(newRd) };
}

// Read (or lazily default) a user's puzzle rating row.
export function getPuzzleRating(userId) {
  const row = db.prepare('SELECT rating, rd, solved, failed FROM puzzle_ratings WHERE user_id = ?').get(userId);
  if (!row) return { rating: PUZZLE_RATING_DEFAULT, rd: PUZZLE_RD_DEFAULT, solved: 0, failed: 0, provisional: true };
  return { rating: row.rating, rd: row.rd, solved: row.solved, failed: row.failed, provisional: row.rd > 110 };
}

// Apply a scored attempt (solved=true|false) against a puzzle of `puzzleRating`,
// updating the user's rating IDEMPOTENTLY per (user, puzzle, UTC day). The FIRST
// scored outcome for that triple moves the rating; later attempts on the same
// puzzle that day are recorded as no-ops (so a fail can't be spammed to grief
// and a solve can't be farmed). Returns the rating before/after + the delta and
// whether this attempt actually counted.
export function applyPuzzleRating(userId, puzzleId, puzzleRating, solved, dayKey, now = Date.now()) {
  const tx = db.transaction(() => {
    const claim = db.prepare(
      'INSERT OR IGNORE INTO puzzle_attempts (user_id, puzzle_id, day_key, result, rated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, puzzleId, dayKey, solved ? 'solved' : 'failed', now);
    let cur = db.prepare('SELECT rating, rd, solved, failed FROM puzzle_ratings WHERE user_id = ?').get(userId);
    if (!cur) {
      db.prepare('INSERT INTO puzzle_ratings (user_id, rating, rd, solved, failed, updated_at) VALUES (?, ?, ?, 0, 0, ?)')
        .run(userId, PUZZLE_RATING_DEFAULT, PUZZLE_RD_DEFAULT, now);
      cur = { rating: PUZZLE_RATING_DEFAULT, rd: PUZZLE_RD_DEFAULT, solved: 0, failed: 0 };
    }
    const oldRating = cur.rating;
    if (claim.changes === 0) {
      // Already scored this puzzle today — no rating movement (anti-abuse).
      return { rating: cur.rating, oldRating, delta: 0, rd: cur.rd, counted: false, provisional: cur.rd > 110 };
    }
    const opp = Math.max(400, Math.min(3000, Number(puzzleRating) || PUZZLE_RATING_DEFAULT));
    const upd = glickoUpdate(cur.rating, cur.rd, opp, solved ? 1 : 0);
    const newSolved = cur.solved + (solved ? 1 : 0);
    const newFailed = cur.failed + (solved ? 0 : 1);
    db.prepare('UPDATE puzzle_ratings SET rating = ?, rd = ?, solved = ?, failed = ?, updated_at = ? WHERE user_id = ?')
      .run(upd.rating, upd.rd, newSolved, newFailed, now, userId);
    return { rating: upd.rating, oldRating, delta: upd.rating - oldRating, rd: upd.rd, counted: true, provisional: upd.rd > 110 };
  });
  return tx();
}

// --- Puzzle Rush -----------------------------------------------------------
// Record a completed rush run + return the user's (possibly new) best score.
export function recordRushScore(userId, score, mode = 'timed', now = Date.now()) {
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO rush_scores (user_id, score, mode, ended_at) VALUES (?, ?, ?, ?)')
      .run(userId, score, mode, now);
    const best = db.prepare('SELECT MAX(score) AS best FROM rush_scores WHERE user_id = ?').get(userId).best || 0;
    return { score, best, isBest: score >= best, runs: db.prepare('SELECT COUNT(*) AS n FROM rush_scores WHERE user_id = ?').get(userId).n };
  });
  return tx();
}

export function getRushBest(userId) {
  const row = db.prepare('SELECT MAX(score) AS best, COUNT(*) AS runs FROM rush_scores WHERE user_id = ?').get(userId);
  return { best: (row && row.best) || 0, runs: (row && row.runs) || 0 };
}

// Increment (or create) the counter for a share platform. Idempotent upsert.
export function incShareCount(platform) {
  return db.prepare(`
    INSERT INTO share_counts (platform, count, updated_at) VALUES (?, 1, ?)
    ON CONFLICT(platform) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at
  `).run(platform, Date.now());
}

// --- Stripe billing: payments ledger ---------------------------------------
// One row per recorded Stripe revenue event (checkout completion / paid invoice).
// `stripe_event_id` is UNIQUE so webhook retries can't double-count revenue
// (idempotent on the Stripe event id). Amounts are stored in the smallest
// currency unit (cents) as Stripe reports them. Aggregate telemetry (no FKs so a
// payment can still be recorded if the user row is missing/late).
db.exec(`
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  stripe_event_id TEXT UNIQUE,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'usd',
  kind TEXT DEFAULT 'subscription',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);
`);

// --- Web Push subscriptions (re-engagement) --------------------------------
// One row per browser/device push subscription. `endpoint` is UNIQUE (it is the
// push service's stable id for the subscription) so re-subscribing the same
// device is idempotent — addPushSub upserts on it. `p256dh`/`auth` are the
// subscription's public encryption keys (base64url). Additive + inert until
// VAPID keys are configured (nothing writes here otherwise). No FK on user_id so
// a stale row can't block deletes (we prune dead subs by endpoint anyway).
db.exec(`
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
`);

// Idempotently store a push subscription for `userId`. Keyed on the UNIQUE
// `endpoint`: re-subscribing the same device (or a device that moved to another
// account) UPSERTs the row rather than duplicating it, so listPushSubs returns
// exactly one row per endpoint. All SQL is parameterized.
export function addPushSub({ userId, endpoint, p256dh, auth }) {
  return db.prepare(`
    INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
  `).run(
    'push_' + Math.random().toString(36).slice(2) + Date.now().toString(36),
    userId, endpoint, p256dh, auth, Date.now()
  );
}

// Remove a subscription by endpoint, scoped to the owning user (so a user can
// only unsubscribe their own device). No-op if not present.
export function removePushSub(userId, endpoint) {
  return db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
}

// All push subscriptions for a user (for fan-out). Returns [{endpoint,p256dh,auth}].
export function listPushSubs(userId) {
  if (!userId) return [];
  return db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
}

// Prune a dead subscription by endpoint (called when the push service returns
// 404/410 Gone). Unscoped by user on purpose — the endpoint is globally unique
// and a dead endpoint is dead for everyone. No-op if not present.
export function removeDeadSub(endpoint) {
  return db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

// --- Victim Wall / revenge loop --------------------------------------------
// One row per "streak victim": recorded SERVER-SIDE whenever a player beats
// someone during (or extending) a ranked win streak. winner_id is the streaking
// winner; victim_id/victim_name are the defeated player (a real user id for a
// human loser, or a synthetic 'bot_...' id for the engine bot — victim_name is
// always the human-readable label shown on the wall). streak_len is the winner's
// NEW streak length at the moment of this win (1 = first win of a new streak).
// Powers the public "Most Feared" board + the loser's "get revenge?" prompt,
// independent of any client. No FK on winner_id/victim_id so a bot victim (which
// has no users row) can still be recorded; the wall joins winner_id -> users for
// the live username/streak. All SQL is parameterized.
db.exec(`
CREATE TABLE IF NOT EXISTS streak_victims (
  id TEXT PRIMARY KEY,
  winner_id TEXT NOT NULL,
  victim_id TEXT NOT NULL,
  victim_name TEXT NOT NULL DEFAULT '',
  streak_len INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_streak_victims_winner ON streak_victims(winner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_streak_victims_victim ON streak_victims(victim_id, created_at DESC);
`);

// Record one streak-victim row. Parameterized; never overlaps an existing id.
export function recordStreakVictim({ winnerId, victimId, victimName, streakLen, createdAt }) {
  return db.prepare(
    `INSERT INTO streak_victims (id, winner_id, victim_id, victim_name, streak_len, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    'sv_' + Math.random().toString(36).slice(2) + Date.now().toString(36),
    winnerId, victimId, String(victimName || ''), Number(streakLen) || 1,
    Number(createdAt) || Date.now()
  );
}

// --- SEASONS (monthly competitive ladder) ----------------------------------
// One row per (season, user): the user's performance THIS season, tracked
// SEPARATELY from the live ELO/W-L ladder on `users` (resetting that is risky).
// `season_id` is the UTC calendar month, e.g. "2026-06". `points` is a simple
// season score (+3 win / +1 draw, ranked games only). `peak_elo` snapshots the
// user's highest ELO seen during the season. UPSERT-incremented idempotently per
// finished ranked game. No FK on user_id (mirrors the streak/payments
// convention) so a write can still land if the user row is momentarily missing.
// All SQL parameterized.
db.exec(`
CREATE TABLE IF NOT EXISTS season_stats (
  season_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  peak_elo INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (season_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_season_stats_board ON season_stats(season_id, points DESC, peak_elo DESC);

CREATE TABLE IF NOT EXISTS arenas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tc TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming',
  champion_id TEXT,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_arenas_window ON arenas(status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS arena_scores (
  arena_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  peak_elo INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (arena_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_arena_scores_board ON arena_scores(arena_id, points DESC, games ASC, peak_elo DESC);
`);

// Idempotently increment a user's season row for one finished ranked game.
// result is 'win' | 'loss' | 'draw'. points: +3 win / +1 draw / 0 loss.
// peak_elo is raised to the max of the existing value and the passed elo.
// UPSERT so the first game of the season inserts and the rest increment.
export function recordSeasonResult({ seasonId, userId, result, elo, now }) {
  const win = result === 'win' ? 1 : 0;
  const loss = result === 'loss' ? 1 : 0;
  const draw = result === 'draw' ? 1 : 0;
  const points = win * 3 + draw * 1;
  const peak = Number.isFinite(elo) ? Math.round(elo) : 0;
  const ts = Number(now) || Date.now();
  return db.prepare(
    `INSERT INTO season_stats (season_id, user_id, wins, losses, draws, points, peak_elo, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(season_id, user_id) DO UPDATE SET
       wins = wins + excluded.wins,
       losses = losses + excluded.losses,
       draws = draws + excluded.draws,
       points = points + excluded.points,
       peak_elo = MAX(peak_elo, excluded.peak_elo),
       updated_at = excluded.updated_at`
  ).run(seasonId, userId, win, loss, draw, points, peak, ts);
}

// Top N for a season's leaderboard: ordered by points then peak_elo, joined to
// users for the live username/elo/premium. Parameterized.
export function seasonLeaderboard(seasonId, limit = 50) {
  return db.prepare(
    `SELECT s.user_id, s.wins, s.losses, s.draws, s.points, s.peak_elo,
            u.username, u.elo, u.is_premium
     FROM season_stats s
     JOIN users u ON u.id = s.user_id
     WHERE s.season_id = ?
     ORDER BY s.points DESC, s.peak_elo DESC, u.elo DESC
     LIMIT ?`
  ).all(seasonId, limit);
}

// A single user's season row + their 1-based rank (by points then peak_elo).
// Returns null when the user has no row this season.
export function seasonStatsForUser(seasonId, userId) {
  const row = db.prepare(
    'SELECT wins, losses, draws, points, peak_elo FROM season_stats WHERE season_id = ? AND user_id = ?'
  ).get(seasonId, userId);
  if (!row) return null;
  const rankRow = db.prepare(
    `SELECT COUNT(*) AS ahead FROM season_stats
     WHERE season_id = ? AND (points > ? OR (points = ? AND peak_elo > ?))`
  ).get(seasonId, row.points, row.points, row.peak_elo);
  return { ...row, rank: (Number(rankRow.ahead) || 0) + 1 };
}

// The champion (rank 1) of a PRIOR season — used for end-of-season recognition.
// Returns { username, points, ... } or null if that season had no participants.
export function seasonChampion(seasonId) {
  return db.prepare(
    `SELECT s.user_id, s.points, s.peak_elo, s.wins, s.losses, s.draws,
            u.username, u.is_premium
     FROM season_stats s
     JOIN users u ON u.id = s.user_id
     WHERE s.season_id = ?
     ORDER BY s.points DESC, s.peak_elo DESC, u.elo DESC
     LIMIT 1`
  ).get(seasonId) || null;
}

// --- Cosmetic store: entitlements ------------------------------------------
// One row per (user, sku) ownership grant for a one-time cosmetic purchase
// (themed piece-set). UNIQUE(user_id, sku) makes grants idempotent — a webhook
// retry (or a double-purchase race) can't create a duplicate row, so ownership
// is exactly-once. `source_event_id` records the Stripe event that granted it
// (for audit / refund-revoke). No FK on user_id so a grant can still be recorded
// if the user row is missing/late (mirrors the payments-ledger convention).
db.exec(`
CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  source_event_id TEXT,
  UNIQUE(user_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements(user_id);
`);

// Idempotently grant `sku` to `userId`. Returns true if a NEW row was inserted,
// false if the user already owned it (INSERT OR IGNORE on UNIQUE(user_id, sku)).
export function grantEntitlement(userId, sku, eventId) {
  const res = db.prepare(
    `INSERT OR IGNORE INTO entitlements (id, user_id, sku, granted_at, source_event_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    'ent_' + Math.random().toString(36).slice(2) + Date.now().toString(36),
    userId, sku, Date.now(), eventId || null
  );
  return res.changes > 0;
}

// Atomically (one transaction) grant a one-time set purchase AND record its
// revenue, both idempotent on the Stripe event id. Used by the webhook so a
// retry can neither double-grant the set nor double-count the revenue. The
// entitlement is keyed UNIQUE(user_id, sku); the payment UNIQUE(stripe_event_id).
export function grantSetPurchase({ userId, sku, eventId, amountCents, currency }) {
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO entitlements (id, user_id, sku, granted_at, source_event_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run('ent_' + (eventId || ('x' + Math.random().toString(36).slice(2))), userId, sku, Date.now(), eventId || null);
    db.prepare(
      `INSERT OR IGNORE INTO payments (id, user_id, stripe_event_id, amount_cents, currency, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('pay_' + (eventId || ('x' + Math.random().toString(36).slice(2))), userId || null, eventId || null,
      Number(amountCents) || 0, currency || 'usd', 'piece_set', Date.now());
  });
  tx();
}

// True if `userId` owns `sku`.
export function userOwnsSku(userId, sku) {
  if (!userId || !sku) return false;
  const row = db.prepare('SELECT 1 FROM entitlements WHERE user_id = ? AND sku = ? LIMIT 1').get(userId, sku);
  return !!row;
}

// All SKUs `userId` owns (string[]).
export function listUserSkus(userId) {
  if (!userId) return [];
  return db.prepare('SELECT sku FROM entitlements WHERE user_id = ? ORDER BY granted_at').all(userId).map(r => r.sku);
}

// Revoke a single (user, sku) grant (refund / dispute). No-op if not present.
export function revokeEntitlement(userId, sku) {
  if (!userId || !sku) return false;
  const res = db.prepare('DELETE FROM entitlements WHERE user_id = ? AND sku = ?').run(userId, sku);
  return res.changes > 0;
}

// Persist the Stripe Customer id for a user (set on first checkout).
export function setStripeCustomer(userId, customerId) {
  return db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, userId);
}

// Flip a user's premium flag + subscription status, keyed by Stripe Customer id.
export function setPremiumByCustomer(customerId, isPremium, status) {
  return db.prepare('UPDATE users SET is_premium = ?, subscription_status = ? WHERE stripe_customer_id = ?')
    .run(isPremium ? 1 : 0, status == null ? '' : String(status), customerId);
}

// Flip a user's premium flag + subscription status, keyed by user id.
export function setPremiumByUserId(userId, isPremium, status) {
  return db.prepare('UPDATE users SET is_premium = ?, subscription_status = ? WHERE id = ?')
    .run(isPremium ? 1 : 0, status == null ? '' : String(status), userId);
}

// Idempotently record a revenue event. INSERT OR IGNORE on the UNIQUE
// stripe_event_id means a webhook retry for the same event is a no-op (the
// amount is counted exactly once).
export function recordPayment({ userId, eventId, amountCents, currency, kind, createdAt }) {
  return db.prepare(`INSERT OR IGNORE INTO payments
      (id, user_id, stripe_event_id, amount_cents, currency, kind, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(
      'pay_' + (eventId || ('x' + Math.random().toString(36).slice(2))),
      userId || null,
      eventId || null,
      Number(amountCents) || 0,
      currency || 'usd',
      kind || 'subscription',
      Number(createdAt) || Date.now()
    );
}

export function getUserByStripeCustomer(customerId) {
  if (!customerId) return undefined;
  return db.prepare("SELECT * FROM users WHERE stripe_customer_id = ? AND stripe_customer_id <> ''").get(customerId);
}

// Revenue rollups for the admin dashboard. Sums payments for the current
// calendar month, current calendar year, and all-time, plus the count of active
// subscribers (users.is_premium = 1). Boundaries use the SERVER's clock.
export function revenueStats() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
  const sum = (sql, p = []) => { const r = db.prepare(sql).get(...p); return r && r.s != null ? Number(r.s) : 0; };
  return {
    monthCents:      sum('SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE created_at >= ?', [monthStart]),
    yearCents:       sum('SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE created_at >= ?', [yearStart]),
    allTimeCents:    sum('SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments'),
    activeSubscribers: (() => { const r = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_premium = 1').get(); return r ? Number(r.n) : 0; })(),
    currency: 'usd',
  };
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
  // Participation filter, keyed by the SAME canonical metric (a fixed code map,
  // never raw input — injection-safe). A leaderboard must only list users who
  // actually played/earned in that match type, not every registered user.
  // Unknown metric falls through to the elo filter (and elo ordering, below).
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
  return db.prepare(`SELECT id, username, region, elo, wins, losses, best_streak, is_premium,
                            elo_checkers_8, elo_checkers_10, checkers8_games, checkers10_games,
                            ${trophiesExpr} AS trophies
                     FROM users WHERE ${whereExpr} ORDER BY ${orderExpr} DESC, elo DESC LIMIT ?`).all(limit);
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
