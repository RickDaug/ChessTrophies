// Interactive chess puzzle subsystem — Express routes.
//
// Mounted from server.js via mountPuzzles(app) (mirrors mountBilling). Three
// routes:
//   GET  /api/puzzles/daily        — today's puzzle, DETERMINISTIC by UTC date
//                                     (everyone gets the same daily). Public.
//   GET  /api/puzzles/next?rating= — a puzzle near a target rating (trainer).
//                                     Public.
//   POST /api/puzzles/solved       — auth-gated. Idempotently records that the
//                                     user solved a puzzle today and advances a
//                                     daily streak (via the store facade).
//
// PUZZLE SOURCE: the routes prefer a `puzzles` DB table (populated by
// import-puzzles.mjs from the Lichess CC0 database) and TRANSPARENTLY fall back
// to the bundled verified seed corpus (puzzle-seed.mjs) when that table is empty
// or absent. So the feature works today with zero setup, and scales up the
// moment the table is filled — no code change required.

import { requireAuth } from './auth.js';
import * as store from './store.js';
import { PUZZLE_SEED } from './puzzle-seed.mjs';

// The canonical UTC "today" key (YYYY-MM-DD). Exported + accepts an injected
// Date so the deterministic-daily selection is unit-testable for a fixed date.
export function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// Deterministically map a UTC date string to an index in [0, n). A small stable
// string hash (FNV-1a-ish) of the day key — NO Date.now() / Math.random(), so
// the same date always yields the same index (everyone gets the same daily, and
// it doesn't drift between requests within a day).
export function dailyIndex(dayKey, n) {
  if (!n || n <= 0) return 0;
  let h = 2166136261;
  for (let i = 0; i < dayKey.length; i++) {
    h ^= dayKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % n;
}

// Strip server-only fields before sending a puzzle to the client. (Everything
// in the seed is already public — this is future-proofing for DB columns.)
function publicPuzzle(p) {
  return {
    id: p.id,
    fen: p.fen,
    moves: p.moves,        // full UCI solution line (even idx = solver moves)
    rating: p.rating,
    theme: p.theme,
    title: p.title || '',
    hint: p.hint || '',
  };
}

// Load all puzzles from the DB `puzzles` table if it exists + is non-empty;
// otherwise return null so callers fall back to the seed. Never throws (a
// missing table on either backend is treated as "use the seed").
async function loadDbPuzzles() {
  try {
    const rows = await store.all('SELECT id, fen, moves, rating, theme, title, hint FROM puzzles');
    if (!rows || !rows.length) return null;
    return rows.map((r) => ({
      id: r.id,
      fen: r.fen,
      // `moves` is stored as a space-separated UCI string in the table.
      moves: typeof r.moves === 'string' ? r.moves.trim().split(/\s+/) : r.moves,
      rating: Number(r.rating) || 0,
      theme: r.theme || 'tactics',
      title: r.title || '',
      hint: r.hint || '',
    }));
  } catch {
    return null; // table absent / query failed -> seed fallback
  }
}

// The active puzzle set: DB table when populated, else the verified seed. Sorted
// by id so the deterministic daily index is stable across processes regardless
// of DB row order.
async function getPuzzleSet() {
  const fromDb = await loadDbPuzzles();
  const set = (fromDb && fromDb.length) ? fromDb : PUZZLE_SEED.slice();
  return set.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Pick the puzzle nearest `target` rating; ties broken by id for determinism.
function nearestByRating(set, target) {
  let best = set[0];
  let bestDist = Infinity;
  for (const p of set) {
    const d = Math.abs((Number(p.rating) || 0) - target);
    if (d < bestDist || (d === bestDist && p.id < best.id)) { best = p; bestDist = d; }
  }
  return best;
}

export function mountPuzzles(app) {
  // PUBLIC: today's deterministic daily puzzle (same for everyone, by UTC date).
  app.get('/api/puzzles/daily', async (req, res, next) => {
    try {
      const set = await getPuzzleSet();
      if (!set.length) return res.status(503).json({ error: 'No puzzles available.' });
      const dayKey = utcDayKey();
      const idx = dailyIndex(dayKey, set.length);
      res.json({ dayKey, puzzle: publicPuzzle(set[idx]) });
    } catch (e) { if (!e.status) e.status = 500; next(e); }
  });

  // PUBLIC: a puzzle near a target rating, for the trainer mode. `rating` is
  // clamped to a sane band; omitted -> 1200. Optional `exclude` (comma-sep ids)
  // lets the client skip puzzles it just played so "Next" advances.
  app.get('/api/puzzles/next', async (req, res, next) => {
    try {
      const set = await getPuzzleSet();
      if (!set.length) return res.status(503).json({ error: 'No puzzles available.' });
      let target = parseInt(req.query.rating, 10);
      if (!Number.isFinite(target)) target = 1200;
      target = Math.min(Math.max(target, 400), 3000);
      const exclude = typeof req.query.exclude === 'string'
        ? new Set(req.query.exclude.split(',').map((s) => s.trim()).filter(Boolean))
        : new Set();
      let pool = set.filter((p) => !exclude.has(p.id));
      if (!pool.length) pool = set; // all excluded -> ignore the exclusion
      res.json({ puzzle: publicPuzzle(nearestByRating(pool, target)) });
    } catch (e) { if (!e.status) e.status = 500; next(e); }
  });

  // AUTH: record that the user solved a puzzle today (idempotent) + bump the
  // daily streak. Validates the puzzleId exists in the active set so a client
  // can't inflate its streak with arbitrary ids.
  app.post('/api/puzzles/solved', requireAuth, async (req, res, next) => {
    try {
      const body = req.body || {};
      const puzzleId = typeof body.puzzleId === 'string' ? body.puzzleId.trim().slice(0, 128) : '';
      if (!puzzleId) return res.status(400).json({ error: 'puzzleId is required.' });
      const set = await getPuzzleSet();
      if (!set.some((p) => p.id === puzzleId)) {
        return res.status(404).json({ error: 'Unknown puzzle.' });
      }
      const dayKey = utcDayKey();
      const result = await store.recordPuzzleSolved(req.userId, puzzleId, dayKey, Date.now());
      res.json({ ok: true, dayKey, ...result });
    } catch (e) { if (!e.status) e.status = 400; next(e); }
  });

  // AUTH: the signed-in user's puzzle progress (streak + total + solved ids).
  app.get('/api/puzzles/progress', requireAuth, async (req, res, next) => {
    try {
      res.json(await store.getPuzzleProgress(req.userId));
    } catch (e) { if (!e.status) e.status = 500; next(e); }
  });
}

export default mountPuzzles;
