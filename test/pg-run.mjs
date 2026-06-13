#!/usr/bin/env node
/*
 * pg-run.mjs — run a list of server-backed tests against REAL Postgres, isolated.
 *
 * Most server-backed tests boot the server on SQLite via a throwaway DATABASE_PATH,
 * but the ones listed here are pure-HTTP (no direct better-sqlite3 access), so they
 * run unchanged against db-pg.js when DB_BACKEND=postgres + DATABASE_URL are set —
 * exercising the real Postgres SQL the eventual cutover depends on. This runner
 * resets the public schema between each test (so they don't pollute each other's
 * aggregates / unique constraints) and fails if any test fails.
 *
 * Tests that seed by opening the SQLite file directly (e.g. rankings.mjs:
 * `new Database(dbPath)`) are intentionally NOT here — their seed is a no-op under
 * Postgres, which is a harness limitation, not a db-pg.js bug.
 *
 * Usage (DB_BACKEND=postgres + DATABASE_URL required):
 *   node test/pg-run.mjs account-deletion auth-recovery client-errors challenges leagues analytics
 * With no args it runs the default PG-compatible set below.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');

const DEFAULT = ['account-deletion', 'auth-recovery', 'client-errors', 'challenges', 'leagues', 'analytics'];
const tests = process.argv.slice(2).filter(Boolean);
const list = tests.length ? tests : DEFAULT;

// SKIP cleanly (exit 0) when Postgres isn't configured, so the default SQLite
// suite / aggregate runner doesn't fail on it — this only does real work in the
// postgres.yml CI job (or locally with DB_BACKEND=postgres + DATABASE_URL set).
if (process.env.DB_BACKEND !== 'postgres' || !process.env.DATABASE_URL) {
  console.log('[pg-run] SKIP — not a Postgres run (set DB_BACKEND=postgres + DATABASE_URL)');
  process.exit(0);
}

// node-postgres, resolved from the server's node_modules (where it's installed).
const requireFromServer = createRequire(path.join(SERVER_DIR, 'db.js'));
const { Client } = requireFromServer('pg');

async function resetSchema() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('DROP SCHEMA public CASCADE');
    await c.query('CREATE SCHEMA public');
  } finally {
    await c.end();
  }
}

function runTest(name) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join('test', `${name}.mjs`)], { cwd: ROOT, stdio: 'inherit', env: process.env });
    p.on('exit', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
}

let failures = 0;
for (const name of list) {
  console.log(`\n[pg-run] ===== ${name} (Postgres) =====`);
  try { await resetSchema(); } catch (e) { console.error(`[pg-run] schema reset failed: ${e.message}`); failures++; continue; }
  const ok = await runTest(name);
  if (!ok) { failures++; console.error(`[pg-run] ${name} FAILED on Postgres`); }
}

console.log(`\n[pg-run] ${list.length - failures}/${list.length} passed on Postgres`);
process.exit(failures ? 1 : 0);
