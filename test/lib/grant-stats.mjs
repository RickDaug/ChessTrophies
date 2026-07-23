/*
 * grant-stats.mjs — give a test account real SERVER-SIDE gameplay counters.
 *
 * Trophies are server-authoritative AND entitlement-checked (audit 2026-07):
 * POST /api/progress drops any trophy the account's own counters cannot support,
 * because id-filtering alone still let a zero-game account claim all 105 real
 * catalog ids for the maximum score. A freshly signed-up test account therefore
 * has 0 wins / 0 games and is entitled to NOTHING.
 *
 * Tests that exercise the progress-sync PLUMBING (does the field round-trip?)
 * rather than the scoring rules use this to write the counters directly into the
 * test's throwaway SQLite file, simulating an account that genuinely played.
 * The server holds the DB in WAL mode, so an external writer is safe.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'server');

// Generous defaults: enough to entitle the mid-tier trophies these tests sync.
export const DEFAULT_STATS = {
  wins: 150, losses: 10, draws: 5, elo: 1750,
  best_streak: 10, arena_wins: 6, invites_accepted: 5,
  elo_checkers_8: 1600, elo_checkers_10: 1600,
};

export function grantStats(dbPath, userId, stats = {}) {
  const s = { ...DEFAULT_STATS, ...stats };
  const require = createRequire(path.join(SERVER_DIR, 'package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  try {
    db.prepare(
      `UPDATE users SET wins=?, losses=?, draws=?, elo=?, best_streak=?, arena_wins=?,
       invites_accepted=?, elo_checkers_8=?, elo_checkers_10=? WHERE id=?`
    ).run(s.wins, s.losses, s.draws, s.elo, s.best_streak, s.arena_wins,
          s.invites_accepted, s.elo_checkers_8, s.elo_checkers_10, userId);
  } finally {
    db.close();
  }
  return s;
}
