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

import { requireAuth, verifyToken } from './auth.js';
import * as store from './store.js';
import { PUZZLE_SEED } from './puzzle-seed.mjs';

// Best-effort: extract a valid user id from the Authorization header WITHOUT
// rejecting unauthenticated callers. Used by /next so the trainer can serve
// puzzles near the SIGNED-IN user's current rating (adaptive difficulty) while
// staying public for guests.
function optionalUserId(req) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token ? verifyToken(token) : null;
    return payload ? payload.uid : null;
  } catch { return null; }
}

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
//
// RESIDUAL RISK (accepted, for now): /daily and /next still ship the full `moves`
// solution line because the client's punish-then-retry UX drives its wrong-move
// detection from it. The streak is no longer forgeable from this (POST /solved now
// re-verifies the submitted line server-side), but a determined client could read
// the answer out of the daily payload and replay it. To fully close this, move the
// solution off the wire (e.g. validate moves server-side as they're played, or
// send only the FEN + a per-step "was that correct?" check) — tracked as a
// follow-up so we don't break the existing punish-then-retry loop here.
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

// The expected SOLVER line for a puzzle = the even-index plies of its `moves`
// array (0,2,4,…). The odd plies are scripted opponent replies the UI auto-plays;
// the player never submits those, so they are NOT part of the proof-of-solve.
function solverLine(p) {
  const out = [];
  for (let i = 0; i < p.moves.length; i += 2) out.push(p.moves[i]);
  return out;
}

// Normalize a UCI token for comparison: lowercase, trimmed, and tolerant of a
// trailing promotion letter the client may or may not include (chess.js can emit
// a 4-char UCI for a forced/queen promotion). We compare the from/to squares
// strictly and the promotion piece only when BOTH sides specify one.
function uciMatches(submitted, expected) {
  if (typeof submitted !== 'string' || typeof expected !== 'string') return false;
  const s = submitted.trim().toLowerCase();
  const e = expected.trim().toLowerCase();
  if (s === e) return true;
  // from/to (first 4 chars) must match exactly.
  if (s.slice(0, 4) !== e.slice(0, 4)) return false;
  // If one side omits the promotion letter, accept (the squares already match
  // and only one promotion is legal from->to for the moving pawn).
  if (s.length === 4 || e.length === 4) return true;
  return s.slice(4) === e.slice(4);
}

// Server-side proof check: does the submitted move line MATCH the stored solver
// solution for this puzzle? The client must submit exactly the solver plies it
// played, in order. Returns true only on a full, exact-length match.
function verifySolution(puzzle, submittedMoves) {
  if (!Array.isArray(submittedMoves)) return false;
  const expected = solverLine(puzzle);
  if (submittedMoves.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (!uciMatches(submittedMoves[i], expected[i])) return false;
  }
  return true;
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
      // Difficulty adapts to the user. Priority: an explicit `rating` query
      // (e.g. a rush ramp) > the SIGNED-IN user's current puzzle rating > 1200.
      let target = parseInt(req.query.rating, 10);
      if (!Number.isFinite(target)) {
        const uid = optionalUserId(req);
        if (uid) {
          try { const r = await store.getPuzzleRating(uid); if (r && Number.isFinite(r.rating)) target = r.rating; } catch {}
        }
      }
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
  // daily streak. Requires PROOF of solve: the client must submit the solver's
  // move line (`moves`), which the server validates against the stored solution
  // for that puzzle. A bare puzzleId is NOT sufficient — without this check the
  // streak was trivially forgeable (just POST any valid id). Only a CORRECT line
  // records the solve + advances the streak; anything else is rejected (400).
  app.post('/api/puzzles/solved', requireAuth, async (req, res, next) => {
    try {
      const body = req.body || {};
      const puzzleId = typeof body.puzzleId === 'string' ? body.puzzleId.trim().slice(0, 128) : '';
      if (!puzzleId) return res.status(400).json({ error: 'puzzleId is required.' });
      // The submitted solving line is REQUIRED proof of solve. Cap length to a
      // sane bound so a giant payload can't be used to DoS the comparison.
      const submittedMoves = Array.isArray(body.moves)
        ? body.moves.slice(0, 64).map((m) => (typeof m === 'string' ? m : ''))
        : null;
      if (!submittedMoves || !submittedMoves.length) {
        return res.status(400).json({ error: 'moves (the solving line) is required.' });
      }
      const set = await getPuzzleSet();
      const puzzle = set.find((p) => p.id === puzzleId);
      if (!puzzle) {
        return res.status(404).json({ error: 'Unknown puzzle.' });
      }
      // SERVER-SIDE VERIFICATION: the submitted line must match the stored solver
      // solution (the even-index plies). Reject forged/incorrect solves with 400
      // BEFORE touching the streak, so a wrong/missing line never advances it.
      if (!verifySolution(puzzle, submittedMoves)) {
        return res.status(400).json({ error: 'Incorrect solution.' });
      }
      const dayKey = utcDayKey();
      const now = Date.now();
      const result = await store.recordPuzzleSolved(req.userId, puzzleId, dayKey, now);
      // SERVER-SIDE RATING: a verified solve RAISES the user's puzzle rating vs
      // the puzzle's own rating (Glicko-lite). Idempotent per puzzle/day, so
      // re-solving the same puzzle the same day can't farm rating. The client
      // NEVER sends a rating — it is computed here off the verified solve.
      const rating = await store.applyPuzzleRating(req.userId, puzzleId, puzzle.rating, true, dayKey, now);
      res.json({
        ok: true, dayKey, ...result,
        puzzleRating: rating.rating, ratingDelta: rating.delta,
        ratingBefore: rating.oldRating, rd: rating.rd,
        ratingCounted: rating.counted, provisional: rating.provisional,
      });
    } catch (e) { if (!e.status) e.status = 400; next(e); }
  });

  // AUTH: report that the user FAILED a puzzle (got it wrong / gave up). Lowers
  // the user's rating vs the puzzle's rating. Abuse-resistant: idempotent per
  // (user, puzzle, UTC day) — a fail can't be spammed to grief a rating, and a
  // puzzle that's already been SCORED today (solved or failed) is a no-op. The
  // puzzle id is verified to exist; no proof is needed for a fail (there's
  // nothing to forge in your own favor — a fail only ever lowers your rating).
  app.post('/api/puzzles/failed', requireAuth, async (req, res, next) => {
    try {
      const body = req.body || {};
      const puzzleId = typeof body.puzzleId === 'string' ? body.puzzleId.trim().slice(0, 128) : '';
      if (!puzzleId) return res.status(400).json({ error: 'puzzleId is required.' });
      const set = await getPuzzleSet();
      const puzzle = set.find((p) => p.id === puzzleId);
      if (!puzzle) return res.status(404).json({ error: 'Unknown puzzle.' });
      const dayKey = utcDayKey();
      const rating = await store.applyPuzzleRating(req.userId, puzzleId, puzzle.rating, false, dayKey, Date.now());
      res.json({
        ok: true, dayKey,
        puzzleRating: rating.rating, ratingDelta: rating.delta,
        ratingBefore: rating.oldRating, rd: rating.rd,
        ratingCounted: rating.counted, provisional: rating.provisional,
      });
    } catch (e) { if (!e.status) e.status = 400; next(e); }
  });

  // AUTH: the signed-in user's puzzle progress (streak + total + solved ids +
  // the per-user puzzle RATING and the rush personal best).
  app.get('/api/puzzles/progress', requireAuth, async (req, res, next) => {
    try {
      const [progress, rating, rush] = await Promise.all([
        store.getPuzzleProgress(req.userId),
        store.getPuzzleRating(req.userId),
        store.getRushBest(req.userId),
      ]);
      res.json({
        ...progress,
        puzzleRating: rating.rating, rd: rating.rd,
        ratingSolved: rating.solved, ratingFailed: rating.failed,
        provisional: rating.provisional,
        rushBest: rush.best, rushRuns: rush.runs,
      });
    } catch (e) { if (!e.status) e.status = 500; next(e); }
  });

  // AUTH: submit a completed Puzzle Rush run. The client sends the list of
  // puzzles it solved during the run, EACH with its verified solver line; the
  // server re-verifies every one (reusing the same proof check as /solved) and
  // the SCORE = the number that verify. This makes the score/best forgery-
  // resistant: you can't claim a 50 without actually submitting 50 correct
  // lines. The server records the run + returns the personal best. (Rush solves
  // do NOT move the daily rating — they're a separate survival mode — but they
  // DO require the same proof, so the leaderboard stat is honest.)
  app.post('/api/puzzles/rush/submit', requireAuth, async (req, res, next) => {
    try {
      const body = req.body || {};
      const runMode = body.mode === 'strikes' ? 'strikes' : 'timed';
      const items = Array.isArray(body.solved) ? body.solved.slice(0, 500) : [];
      const set = await getPuzzleSet();
      const byId = new Map(set.map((p) => [p.id, p]));
      const seen = new Set();
      let score = 0;
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const id = typeof it.puzzleId === 'string' ? it.puzzleId.trim().slice(0, 128) : '';
        // Count each distinct puzzle at most once per run (no dup-padding).
        if (!id || seen.has(id)) continue;
        const puzzle = byId.get(id);
        if (!puzzle) continue;
        const moves = Array.isArray(it.moves) ? it.moves.slice(0, 64).map((m) => (typeof m === 'string' ? m : '')) : null;
        if (!moves || !verifySolution(puzzle, moves)) continue;
        seen.add(id);
        score++;
      }
      const result = await store.recordRushScore(req.userId, score, runMode, Date.now());
      res.json({ ok: true, score, ...result });
    } catch (e) { if (!e.status) e.status = 400; next(e); }
  });

  // AUTH: the user's Puzzle Rush personal best.
  app.get('/api/puzzles/rush/best', requireAuth, async (req, res, next) => {
    try {
      res.json(await store.getRushBest(req.userId));
    } catch (e) { if (!e.status) e.status = 500; next(e); }
  });
}

export default mountPuzzles;
