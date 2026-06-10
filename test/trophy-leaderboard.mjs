#!/usr/bin/env node
/*
 * trophy-leaderboard.mjs — verifies the TROPHY leaderboard:
 *   1) setProgress persists the client's achievements/streak_trophies arrays AND
 *      the tier-weighted trophy_points score (previously these columns were never
 *      written, so the board ranked everyone at 0);
 *   2) topByMetric('trophies') RANKS BY POINTS (count is the tiebreak) and exposes
 *      both `trophy_points` and the count alias `trophies`;
 *   3) the participation filter EXCLUDES users with no trophies.
 *
 * Drives db.js DIRECTLY on a throwaway SQLite file (no server boot, no Postgres).
 * Run: node test/trophy-leaderboard.mjs   Exit 0 = PASS.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const log = (...a) => console.log('[trophy-leaderboard]', ...a);
let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; log('PASS:', msg); }
  else { failed++; log('FAIL:', msg); }
}

const dbPath = path.join(os.tmpdir(), `ct-trophy-lb-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
delete process.env.DATABASE_URL;
delete process.env.DB_BACKEND;

async function main() {
  const db = await import('../server/db.js');
  const mk = (name) => {
    const id = crypto.randomUUID();
    db.createUser({ id, email: `${name}@lb.local`, username: name, region: 'Testland', pw_hash: 'x' });
    return id;
  };

  // Three users: high points, low points (more raw trophies but fewer points),
  // and a brand-new user with nothing.
  const champ = mk('Champ');    // 600 points, 4 trophies
  const rookie = mk('Rookie');  // 120 points, 6 trophies (more count, fewer points)
  const fresh = mk('Fresh');    // no trophies at all

  db.setProgress(champ, {
    lessonsCompleted: [], puzzles: {},
    achievements: [{ id: 'wins_t6' }, { id: 'gauntlet_t4' }, { id: 'arena_t2' }, { id: 'open_t3' }],
    streakTrophies: [], trophyPoints: 600,
  });
  db.setProgress(rookie, {
    lessonsCompleted: [], puzzles: {},
    achievements: [{ id: 'wins_t1' }, { id: 'wins_t2' }, { id: 'mate_t1' }, { id: 'fast_t1' }, { id: 'puz_t1' }, { id: 'games_t1' }],
    streakTrophies: [], trophyPoints: 120,
  });
  log('seeded 3 users (600pts/4, 120pts/6, none)');

  const board = db.topByMetric('trophies', 100);
  const ids = board.map(r => r.id);

  check(ids.includes(champ) && ids.includes(rookie), 'board INCLUDES both trophy-earning users');
  check(!ids.includes(fresh), 'board EXCLUDES the user with no trophies');
  check(ids.indexOf(champ) < ids.indexOf(rookie), 'ranks by POINTS — 600pts user above the 120pts user (despite fewer raw trophies)');

  const champRow = board.find(r => r.id === champ);
  const rookieRow = board.find(r => r.id === rookie);
  check(champRow && champRow.trophy_points === 600, `champ row exposes trophy_points (got ${champRow && champRow.trophy_points})`);
  check(champRow && champRow.trophies === 4, `champ row count alias = 4 achievements (got ${champRow && champRow.trophies})`);
  check(rookieRow && rookieRow.trophies === 6, `rookie row count alias = 6 achievements (got ${rookieRow && rookieRow.trophies})`);

  // Points tiebreak by count: two users with equal points, more trophies ranks higher.
  const tieA = mk('TieA'); const tieB = mk('TieB');
  db.setProgress(tieA, { lessonsCompleted: [], puzzles: {}, achievements: [{ id: 'wins_t1' }], streakTrophies: [], trophyPoints: 100 });
  db.setProgress(tieB, { lessonsCompleted: [], puzzles: {}, achievements: [{ id: 'wins_t1' }, { id: 'wins_t2' }], streakTrophies: [], trophyPoints: 100 });
  const board2 = db.topByMetric('trophies', 100).map(r => r.id);
  check(board2.indexOf(tieB) < board2.indexOf(tieA), 'equal points -> more trophies wins the tiebreak');

  // A trophy-only metric must not leak into elo/wins boards (sanity).
  const wins = db.topByMetric('wins', 100).map(r => r.id);
  check(!wins.includes(champ) && !wins.includes(rookie), "trophy users don't appear on the WINS board (no ranked wins)");

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
  .catch((e) => { console.error('[trophy-leaderboard] FAIL:', e); cleanup(); process.exit(1); });
