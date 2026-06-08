#!/usr/bin/env node
/*
 * rankings-participation.mjs — unit test for the rankings participation filter.
 *
 * Regression guard for "the leaderboard listed EVERY registered user, even ones
 * who never played that match type". topByMetric must now only return users who
 * actually participated in the metric's match type:
 *   - elo / wins  -> needs a real ranked chess game (wins+losses+draws > 0)
 *   - checkers8/10 -> needs a ranked checkers game at that board size
 *
 * Drives db.js DIRECTLY on a throwaway SQLite file (no Postgres, no server
 * boot). Set DATABASE_PATH BEFORE importing the module so the schema is created
 * on the temp file. Run: npm run test:rankings-participation. Exit 0 = PASS.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const log = (...a) => console.log('[rankings-participation]', ...a);
let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; log('PASS:', msg); }
  else { failed++; log('FAIL:', msg); }
}

// Point the SQLite backend at a throwaway DB file, then import it. Importing
// db.js creates the schema synchronously on this path. Force the SQLite default
// backend (never Postgres) for this test.
const dbPath = path.join(os.tmpdir(), `ct-rankings-part-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
delete process.env.DATABASE_URL;
delete process.env.DB_BACKEND;

async function main() {
  const db = await import('../server/db.js');

  // Helper: create a user with a unique id/email/username.
  const mk = (name) => {
    const id = crypto.randomUUID();
    db.createUser({ id, email: `${name}@part.local`, username: name, region: 'Testland', pw_hash: 'x' });
    return id;
  };

  // Three users:
  //   chessUser    — ranked chess participation (wins > 0)
  //   checkersUser — ranked 8x8 checkers participation (checkers8_games > 0)
  //   freshUser    — brand new, all defaults, NO participation anywhere
  const chessUser = mk('ChessPlayer');
  const checkersUser = mk('CheckersPlayer');
  const freshUser = mk('FreshUser');

  db.db.prepare('UPDATE users SET wins = 3, losses = 1, draws = 0 WHERE id = ?').run(chessUser);
  db.db.prepare('UPDATE users SET checkers8_games = 5, elo_checkers_8 = 1300 WHERE id = ?').run(checkersUser);
  log('seeded 3 users (chess-participant, checkers8-participant, brand-new)');

  const ids = (rows) => rows.map(r => r.id);

  // --- elo metric: only users with ranked chess games (wins+losses+draws > 0) ---
  const elo = db.topByMetric('elo', 100);
  check(ids(elo).includes(chessUser), "topByMetric('elo') INCLUDES the ranked-chess user");
  check(!ids(elo).includes(freshUser), "topByMetric('elo') EXCLUDES the brand-new user");
  check(!ids(elo).includes(checkersUser), "topByMetric('elo') EXCLUDES the checkers-only user (no chess games)");

  // --- wins metric: only users with wins > 0 ---
  const wins = db.topByMetric('wins', 100);
  check(ids(wins).includes(chessUser), "topByMetric('wins') INCLUDES the user with wins > 0");
  check(!ids(wins).includes(freshUser), "topByMetric('wins') EXCLUDES zero-win brand-new user");
  check(!ids(wins).includes(checkersUser), "topByMetric('wins') EXCLUDES zero-win checkers user");

  // --- checkers8 metric: only users with checkers8_games > 0 ---
  const c8 = db.topByMetric('checkers8', 100);
  check(ids(c8).includes(checkersUser), "topByMetric('checkers8') INCLUDES the checkers8 participant");
  check(!ids(c8).includes(chessUser), "topByMetric('checkers8') EXCLUDES the chess-only user");
  check(!ids(c8).includes(freshUser), "topByMetric('checkers8') EXCLUDES the brand-new user");
  check(c8.length === 1, "topByMetric('checkers8') returns ONLY the one checkers8 participant");

  // --- checkers10 metric: nobody played 10x10, leaderboard is empty ---
  const c10 = db.topByMetric('checkers10', 100);
  check(c10.length === 0, "topByMetric('checkers10') is empty (no 10x10 participation)");

  log(`DONE — ${passed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

function cleanup() {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  }
}

main()
  .then((code) => { cleanup(); process.exit(code); })
  .catch((e) => { console.error('[rankings-participation] FAIL:', e); cleanup(); process.exit(1); });
