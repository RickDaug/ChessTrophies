#!/usr/bin/env node
/*
 * db-parity.mjs — STATIC drift guard between the two persistence backends.
 *
 * Audit finding QA-M1 / PE-M1: db.js (SQLite, what the whole test suite + prod
 * run today) and db-pg.js (Postgres, the pending scale cutover) are HAND-MIRRORED
 * and nothing co-tests them. The classic drift is a new synced `users` column or
 * a new store function added to ONE backend but not the other (the same family of
 * bug as the /api/progress fields that silently didn't forward).
 *
 * This test needs NO Postgres instance — it parses both source files and asserts:
 *   1) the EXPORTED function/const set matches (modulo a tiny allowlist of
 *      Postgres-only infra: init/query/transaction, and the raw SQLite handle);
 *   2) the FULL `users` column set matches (CREATE TABLE columns UNION the
 *      incrementally-added columns — ensureColumn on SQLite, ADD COLUMN on PG).
 *
 * It is a cheap early-warning that the two schemas have diverged; it does NOT
 * prove the Postgres SQL executes correctly (that needs the PG integration job,
 * .github/workflows/postgres.yml). Run: node test/db-parity.mjs (0=PASS,1=FAIL).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[db-parity]', ...a);
const fail = (m) => { console.error('[db-parity] FAIL:', m); process.exit(1); };

const sqliteSrc = fs.readFileSync(path.join(SERVER_DIR, 'db.js'), 'utf8');
const pgSrc = fs.readFileSync(path.join(SERVER_DIR, 'db-pg.js'), 'utf8');

// --- Exported symbol sets ---------------------------------------------------
function exportsOf(src) {
  const out = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)) out.add(m[1]);
  for (const m of src.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*=/g)) out.add(m[1]);
  return out;
}

// Postgres-only infra the SQLite backend legitimately doesn't expose, and vice
// versa. Any drift OUTSIDE this allowlist fails the test.
const PG_ONLY_OK = new Set(['init', 'query', 'transaction', 'pool', 'usingPostgres']);
// db.js exports these; db-pg.js implements the SAME logic but keeps it
// module-private. They're internal puzzle-rating (Glicko-lite) helpers that
// db.js exposes only for its own unit test — NOT part of the store contract the
// facade delegates to, so an export-visibility difference here is benign.
const SQLITE_ONLY_OK = new Set(['db', 'glickoUpdate', 'PUZZLE_RATING_DEFAULT', 'PUZZLE_RD_DEFAULT']);

// --- Full users-column sets -------------------------------------------------
function usersColumns(src, kind) {
  const cols = new Set();
  // 1) CREATE TABLE ... users ( ... ) column list.
  const start = src.indexOf('CREATE TABLE IF NOT EXISTS users (');
  if (start === -1) fail(`${kind}: could not find CREATE TABLE users`);
  const end = src.indexOf(');', start);
  const block = src.slice(start, end);
  for (const raw of block.split('\n').slice(1)) {
    const line = raw.trim();
    // A column line starts with a lowercase identifier; constraint lines start
    // with an UPPERCASE keyword (PRIMARY/FOREIGN/UNIQUE/...) and won't match.
    const m = /^([a-z_][a-z0-9_]*)\s/.exec(line);
    if (m) cols.add(m[1]);
  }
  // 2) Incrementally-added columns.
  if (kind === 'sqlite') {
    for (const m of src.matchAll(/ensureColumn\('users',\s*'([a-z0-9_]+)'/g)) cols.add(m[1]);
  } else {
    for (const m of src.matchAll(/ALTER TABLE users ADD COLUMN IF NOT EXISTS ([a-z0-9_]+)/gi)) cols.add(m[1]);
  }
  return cols;
}

function diff(a, b) { return [...a].filter(x => !b.has(x)); }

// --- Assertions -------------------------------------------------------------
const sqExports = exportsOf(sqliteSrc);
const pgExports = exportsOf(pgSrc);
const onlySqlite = diff(sqExports, pgExports).filter(x => !SQLITE_ONLY_OK.has(x));
const onlyPg = diff(pgExports, sqExports).filter(x => !PG_ONLY_OK.has(x));
log(`exports: sqlite=${sqExports.size}, pg=${pgExports.size}`);
if (onlySqlite.length) fail(`store functions in db.js but MISSING from db-pg.js: ${onlySqlite.join(', ')}`);
if (onlyPg.length) fail(`store functions in db-pg.js but MISSING from db.js: ${onlyPg.join(', ')}`);
log('export parity ✓ (every store function exists in both backends)');

const sqCols = usersColumns(sqliteSrc, 'sqlite');
const pgCols = usersColumns(pgSrc, 'pg');
const colsOnlySqlite = diff(sqCols, pgCols);
const colsOnlyPg = diff(pgCols, sqCols);
log(`users columns: sqlite=${sqCols.size}, pg=${pgCols.size}`);
if (colsOnlySqlite.length) fail(`users columns in db.js but MISSING from db-pg.js: ${colsOnlySqlite.join(', ')}`);
if (colsOnlyPg.length) fail(`users columns in db-pg.js but MISSING from db.js: ${colsOnlyPg.join(', ')}`);
log('users-column parity ✓ (CREATE + incremental columns match across backends)');

log('PASS — db.js and db-pg.js are in export + users-schema parity');
