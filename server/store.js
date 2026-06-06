// Unified ASYNC data-access facade — the backend-agnostic persistence interface.
//
// Audit finding PE-M1: the app advertises horizontal scaling (Redis socket
// layer) but ALL persistence funnelled through a single synchronous
// better-sqlite3 file, a write-lock / event-loop bottleneck across replicas.
// This module introduces a pluggable persistence tier with TWO backends behind
// one async contract:
//
//   * DEFAULT (no DATABASE_URL): better-sqlite3 (db.js). Every call is wrapped
//     in a resolved Promise — trivial, zero new infra, behavior-identical to
//     today. Local dev and the existing test suite run on this path unchanged.
//   * SCALABLE (DATABASE_URL set): node-postgres pool (db-pg.js). A real
//     connection pool that scales horizontally across replicas; no single
//     file-level write lock.
//
// EVERY export here returns a Promise, so callers `await` the data layer
// regardless of which backend is active. New code (and the in-progress async
// migration of game.js / scale-*.js — see README "Persistence backends") should
// import from THIS module, not from db.js directly.
//
// IMPORTANT — backend selection is decided once, at import time, from the
// environment. We do NOT import db-pg.js at all on the SQLite default path, so
// the `pg` driver is never loaded and no Postgres connection is attempted in
// local dev or tests.
import * as sqlite from './db.js';

export const usingPostgres = !!process.env.DATABASE_URL;

// The active backend module. For Postgres we lazily import db-pg.js so the pg
// driver is only pulled in when actually configured.
let pgBackend = null;
async function loadPg() {
  if (!pgBackend) pgBackend = await import('./db-pg.js');
  return pgBackend;
}

// Initialize the active backend's schema. On SQLite, importing db.js already
// created the schema synchronously (preserving today's boot behavior), so this
// is a no-op there. On Postgres, this runs CREATE TABLE IF NOT EXISTS.
export async function init() {
  if (!usingPostgres) return; // db.js created the schema on import
  const pg = await loadPg();
  await pg.init();
}

// --- Async read/write helpers (mirror db.js exactly, but Promise-returning) ---
//
// On SQLite each just calls the synchronous db.js function and resolves; the
// returned row shapes are identical across both backends.

export async function areBlocked(a, b) {
  if (usingPostgres) return (await loadPg()).areBlocked(a, b);
  return sqlite.areBlocked(a, b);
}

export async function getUserById(id) {
  if (usingPostgres) return (await loadPg()).getUserById(id);
  return sqlite.getUserById(id);
}

export async function getUserByEmail(email) {
  if (usingPostgres) return (await loadPg()).getUserByEmail(email);
  return sqlite.getUserByEmail(email);
}

export async function getUserByUsername(username) {
  if (usingPostgres) return (await loadPg()).getUserByUsername(username);
  return sqlite.getUserByUsername(username);
}

export async function createUser(u) {
  if (usingPostgres) return (await loadPg()).createUser(u);
  return sqlite.createUser(u);
}

// getProgress is pure (parses an already-loaded user row) so it's identical on
// both backends and needs no await; we still expose it here for a single import.
export function getProgress(user) {
  return sqlite.getProgress(user);
}

export async function setProgress(userId, progress) {
  if (usingPostgres) return (await loadPg()).setProgress(userId, progress);
  return sqlite.setProgress(userId, progress);
}

export async function searchUsersByUsername(prefix, excludeId, limit = 8) {
  if (usingPostgres) return (await loadPg()).searchUsersByUsername(prefix, excludeId, limit);
  return sqlite.searchUsersByUsername(prefix, excludeId, limit);
}

export async function topByMetric(metric, limit = 100) {
  if (usingPostgres) return (await loadPg()).topByMetric(metric, limit);
  return sqlite.topByMetric(metric, limit);
}

// --- Generic single-statement helpers --------------------------------------
//
// For ad-hoc parameterized SQL in HTTP route handlers (friends/blocks/etc.)
// that isn't worth a named helper. SQL uses `?` placeholders (SQLite style);
// on Postgres they're auto-translated to `$1,$2,...`. Returns match
// better-sqlite3 semantics: get() -> first row | undefined, all() -> rows[],
// run() -> driver result (callers that need it ignore the shape).
export async function get(sql, params = []) {
  if (usingPostgres) {
    const pg = await loadPg();
    return (await pg.query(toPg(sql), params)).rows[0];
  }
  return sqlite.db.prepare(sql).get(...params);
}

export async function all(sql, params = []) {
  if (usingPostgres) {
    const pg = await loadPg();
    return (await pg.query(toPg(sql), params)).rows;
  }
  return sqlite.db.prepare(sql).all(...params);
}

export async function run(sql, params = []) {
  if (usingPostgres) {
    const pg = await loadPg();
    return pg.query(toPg(sql), params);
  }
  return sqlite.db.prepare(sql).run(...params);
}

// --- Transactions ----------------------------------------------------------
//
// Atomic ELO + game-result writes. The two drivers have fundamentally different
// transaction models, so this facade exposes ONE async API that hides the gap:
//
//   await store.runTransaction((tx) => { ... });
//
// `tx` is a minimal query interface usable on either backend:
//   await tx.run(sql, params)  -> for INSERT/UPDATE/DELETE
//   await tx.get(sql, params)  -> first row | undefined
//   await tx.all(sql, params)  -> rows[]
//
// SQL passed to `tx` MUST use `?` placeholders (SQLite style); on Postgres they
// are auto-translated to `$1,$2,...` positional params. This lets a single call
// site work on both backends. On SQLite the work runs inside a synchronous
// db.transaction(); on Postgres inside BEGIN/COMMIT on a dedicated pooled
// client (rollback on throw). ACID atomicity is preserved on both.
export async function runTransaction(fn) {
  if (usingPostgres) {
    const pg = await loadPg();
    return pg.transaction(async (client) => {
      const tx = {
        run: (sql, params = []) => client.query(toPg(sql), params),
        get: async (sql, params = []) => (await client.query(toPg(sql), params)).rows[0],
        all: async (sql, params = []) => (await client.query(toPg(sql), params)).rows,
      };
      return fn(tx);
    });
  }
  // SQLite: db.transaction wraps a SYNCHRONOUS callback. We adapt the same `tx`
  // shape but back it with prepared statements; the callback must not truly
  // await anything (the SQLite calls resolve synchronously), which is fine
  // because tx.* return already-resolved values here.
  const { db } = sqlite;
  const tx = {
    run: (sql, params = []) => db.prepare(sql).run(...params),
    get: (sql, params = []) => db.prepare(sql).get(...params),
    all: (sql, params = []) => db.prepare(sql).all(...params),
  };
  return db.transaction(() => fn(tx))();
}

// Close the Postgres pool on shutdown (no-op if pg was never loaded). Safe to
// call on the SQLite path — it simply resolves without touching anything.
export async function closePool() {
  if (pgBackend && pgBackend.pool) await pgBackend.pool.end();
}

// Translate a SQLite-flavored statement to Postgres. Applied ONLY on the
// Postgres path (the SQLite backend gets the original SQL untouched), so it
// cannot affect the default behavior the test suite exercises. Handles the
// SQLite-isms that appear in our ad-hoc route SQL:
//   * `?`            -> `$1,$2,...` positional placeholders (1-based).
//   * `COLLATE NOCASE` -> removed; case-insensitive ordering/compares in our
//     queries are for ASCII usernames, and we pair this with LOWER() where it
//     matters (see toPg ORDER BY rewrite below is not needed — callers that
//     need case-insensitive ORDER already say `ORDER BY LOWER(...)`). Removing
//     the SQLite-only keyword keeps the statement valid on Postgres.
//   * `INSERT OR IGNORE` -> `INSERT ... ON CONFLICT DO NOTHING`.
// None of our SQL contains a literal `?` inside a string literal, so positional
// replacement is safe.
function toPg(sql) {
  let out = sql.replace(/\bINSERT\s+OR\s+IGNORE\b/gi, 'INSERT');
  out = out.replace(/\bCOLLATE\s+NOCASE\b/gi, '');
  // Append ON CONFLICT DO NOTHING for the rewritten INSERT OR IGNORE statements.
  if (/\bINSERT\s+OR\s+IGNORE\b/i.test(sql) && !/ON\s+CONFLICT/i.test(sql)) {
    out = out.replace(/\s*;?\s*$/, ' ON CONFLICT DO NOTHING');
  }
  let i = 0;
  out = out.replace(/\?/g, () => `$${++i}`);
  return out;
}
