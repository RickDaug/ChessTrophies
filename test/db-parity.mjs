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
 *   2) every shared exported function has the SAME ARITY (top-level parameter
 *      count) in both backends — catches a signature drifting on one side (e.g. a
 *      new optional arg added to db.js but not db-pg.js, silently dropped on PG);
 *   3) the column set of EVERY shared table matches (not just `users`): CREATE
 *      TABLE columns UNION the incrementally-added columns (ensureColumn on
 *      SQLite, ALTER TABLE ADD COLUMN on PG), and the TABLE SET itself matches.
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

// --- Exported-function ARITY (top-level param count) ------------------------
// Map name -> raw param string, reading the balanced parens so destructured
// object params / default values aren't truncated by a naive `[^)]*` match.
function fnSignatures(src) {
  const out = new Map();
  const re = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex, depth = 1, params = '';
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
      params += c; i++;
    }
    out.set(m[1], params.trim());
  }
  return out;
}
// Count top-level params: commas at brace/bracket/paren depth 0. `({a,b})` is 1
// param, `x = Date.now()` is 1 param. Empty signature is 0.
function arityOf(params) {
  if (!params.trim()) return 0;
  let depth = 0, n = 1;
  for (const c of params) {
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) n++;
  }
  return n;
}

// Postgres-only infra the SQLite backend legitimately doesn't expose, and vice
// versa. Any drift OUTSIDE this allowlist fails the test.
const PG_ONLY_OK = new Set(['init', 'query', 'transaction', 'pool', 'usingPostgres']);
// db.js exports these; db-pg.js implements the SAME logic but keeps it
// module-private. They're internal puzzle-rating (Glicko-lite) helpers that
// db.js exposes only for its own unit test — NOT part of the store contract the
// facade delegates to, so an export-visibility difference here is benign.
const SQLITE_ONLY_OK = new Set(['db', 'glickoUpdate', 'PUZZLE_RATING_DEFAULT', 'PUZZLE_RD_DEFAULT']);

// --- Per-table column sets (EVERY table, not just users) ---------------------
// Returns Map<tableName, Set<columnName>> = CREATE TABLE columns UNION the
// incrementally-added columns (ensureColumn on SQLite, ALTER TABLE ... ADD
// COLUMN on PG). Reads each table's body with balanced-paren matching so nested
// `PRIMARY KEY (a, b)` / `UNIQUE(a, b)` constraints don't truncate the block.
const NON_COLUMN_KEYWORDS = new Set(['PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'CONSTRAINT']);
function tableColumns(src, kind) {
  const tables = new Map();
  const ensure = (t) => { let s = tables.get(t); if (!s) { s = new Set(); tables.set(t, s); } return s; };
  // 1) CREATE TABLE bodies.
  const re = /CREATE TABLE IF NOT EXISTS ([a-z_][a-z0-9_]*) \(/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    let i = m.index + m[0].length - 1, depth = 0, block = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
      if (depth >= 1) block += c;
    }
    const cols = ensure(name);
    for (const raw of block.slice(1).split('\n')) {
      const line = raw.trim();
      const cm = /^([a-z_][a-z0-9_]*)\s/.exec(line);
      if (cm && !NON_COLUMN_KEYWORDS.has(cm[1].toUpperCase())) cols.add(cm[1]);
    }
  }
  // 2) Incrementally-added columns, keyed by their table.
  if (kind === 'sqlite') {
    for (const mm of src.matchAll(/ensureColumn\('([a-z_]+)',\s*'([a-z0-9_]+)'/g)) ensure(mm[1]).add(mm[2]);
  } else {
    for (const mm of src.matchAll(/ALTER TABLE ([a-z_]+) ADD COLUMN IF NOT EXISTS ([a-z0-9_]+)/gi)) ensure(mm[1]).add(mm[2]);
  }
  return tables;
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

// --- Function ARITY parity (shared exported functions only) -----------------
// Compares the top-level parameter COUNT, not types/names (the two dialects
// legitimately differ in body, and PG fns are async). A drift here means one
// backend would silently ignore an argument the caller passes.
const sqSigs = fnSignatures(sqliteSrc);
const pgSigs = fnSignatures(pgSrc);
const arityMismatches = [];
for (const [name, params] of sqSigs) {
  if (SQLITE_ONLY_OK.has(name) || !pgSigs.has(name)) continue; // missing handled above
  const a = arityOf(params), b = arityOf(pgSigs.get(name));
  if (a !== b) arityMismatches.push(`${name}: db.js(${a}) vs db-pg.js(${b})  [db.js(${params}) | db-pg.js(${pgSigs.get(name)})]`);
}
log(`function arity: checked ${[...sqSigs.keys()].filter(n => pgSigs.has(n) && !SQLITE_ONLY_OK.has(n)).length} shared functions`);
if (arityMismatches.length) fail(`store-function arity differs across backends:\n  ${arityMismatches.join('\n  ')}`);
log('function-arity parity ✓ (every shared store function takes the same number of params)');

// --- Per-table column parity (table set + every shared table's columns) ------
const sqTables = tableColumns(sqliteSrc, 'sqlite');
const pgTables = tableColumns(pgSrc, 'pg');
const sqTableNames = new Set(sqTables.keys());
const pgTableNames = new Set(pgTables.keys());
log(`tables: sqlite=${sqTableNames.size}, pg=${pgTableNames.size}`);
const tablesOnlySqlite = diff(sqTableNames, pgTableNames);
const tablesOnlyPg = diff(pgTableNames, sqTableNames);
if (tablesOnlySqlite.length) fail(`tables in db.js but MISSING from db-pg.js: ${tablesOnlySqlite.join(', ')}`);
if (tablesOnlyPg.length) fail(`tables in db-pg.js but MISSING from db.js: ${tablesOnlyPg.join(', ')}`);
log('table-set parity ✓ (both backends define the same tables)');

const colDiffs = [];
for (const [t, cols] of sqTables) {
  if (!pgTables.has(t)) continue; // table-set drift already failed above
  const onlySq = diff(cols, pgTables.get(t));
  const onlyPgCols = diff(pgTables.get(t), cols);
  if (onlySq.length) colDiffs.push(`${t}: columns in db.js but MISSING from db-pg.js: ${onlySq.join(', ')}`);
  if (onlyPgCols.length) colDiffs.push(`${t}: columns in db-pg.js but MISSING from db.js: ${onlyPgCols.join(', ')}`);
}
if (colDiffs.length) fail(`per-table column parity failed:\n  ${colDiffs.join('\n  ')}`);
log(`per-table column parity ✓ (CREATE + incremental columns match across backends for all ${sqTableNames.size} tables)`);

// Sanity: the users table must exist + be non-trivial (guards the parser from
// silently matching nothing and "passing").
if (!sqTables.get('users') || sqTables.get('users').size < 10) fail('users table parse looks wrong (too few columns)');

log('PASS — db.js and db-pg.js are in export + function-arity + full-schema parity');
