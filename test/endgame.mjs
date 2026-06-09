#!/usr/bin/env node
/*
 * endgame.mjs — empirical proof that the built-in engine can CONVERT elementary
 * endgames. The domain audit found it playing 22 moves of K+Q-vs-K without ever
 * mating, because it used a single MIDDLEGAME king PST in every phase (the king
 * never centralised, never drove the lone king to the edge). This test loads
 * chess.js + ct-ai.js head-less (the synchronous path — no Web Worker, exactly
 * like the audit) and asserts the engine actually delivers CHECKMATE.
 *
 * It plays engine moves for the WINNING side and a simple "king runs away"
 * defence for the lone king, until chess.js reports checkmate — within a move
 * budget — for both K+Q-vs-K and K+R-vs-K. Plus a regression sanity check that a
 * normal mate-in-1 / obvious capture is still found.
 *
 * Run:   node test/endgame.mjs    (exits 0 on PASS, 1 on FAIL).
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const log = (...a) => console.log('[endgame]', ...a);
let passed = 0;
const fail = (m) => { throw new Error('ASSERT FAILED: ' + m); };
const assert = (c, m) => { if (!c) fail(m); else passed++; };

// --- Load chess.js (CommonJS export) then ct-ai.js as a plain global script. --
// chess.min.js does `exports.Chess = Chess`; ct-ai.js attaches CT_AI to the live
// global (globalThis under Node). We expose Chess on globalThis so ct-ai.js's
// internal `_ChessCtor()` (used by evaluate/bestMove) can find it.
const Chess = require(path.resolve(ROOT, 'chess.min.js')).Chess;
globalThis.Chess = Chess;
// Evaluate ct-ai.js in the current realm so it sees globalThis.Chess and
// installs globalThis.CT_AI (no Worker branch — typeof window === 'undefined').
const aiSrc = fs.readFileSync(path.resolve(ROOT, 'ct-ai.js'), 'utf8');
(0, eval)(aiSrc);
const CT_AI = globalThis.CT_AI;
assert(CT_AI && typeof CT_AI.chooseMove === 'function', 'CT_AI.chooseMove is available');

// HARD-band Elo: full strength enough to convert, with weakening still active.
// The mate-guard must stop slack from dawdling past a forced mate.
const HARD_ELO = 1800;

// Lone-king "defence": just walk away from the enemy king (maximise distance),
// breaking ties toward the centre — a stubborn, non-cooperative escape that a
// broken (non-centralising / non-driving) engine would shuffle against forever.
function loneKingMove(chess) {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;
  // Find the enemy king square.
  const board = chess.board();
  let ek = null;
  const me = chess.turn();
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f];
    if (p && p.type === 'k' && p.color !== me) ek = { r, f };
  }
  const sqRC = (sq) => ({ f: sq.charCodeAt(0) - 97, r: 8 - Number(sq[1]) });
  let best = moves[0], bestScore = -Infinity;
  for (const m of moves) {
    const to = sqRC(m.to);
    // Distance from the enemy king (Chebyshev) — run away.
    const dk = ek ? Math.max(Math.abs(to.r - ek.r), Math.abs(to.f - ek.f)) : 0;
    // Slight pull to the centre to resist being cornered.
    const dc = -(Math.abs(to.r - 3.5) + Math.abs(to.f - 3.5));
    const score = dk * 10 + dc;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

// Play out a position: engine (winning side) vs. lone-king defence. Returns the
// number of plies until checkmate, or -1 if the budget ran out / it drew.
function playToMate(fen, winningColor, budgetPlies) {
  const chess = new Chess(fen);
  for (let ply = 0; ply < budgetPlies; ply++) {
    if (chess.game_over()) break;
    let mv;
    if (chess.turn() === winningColor) {
      mv = CT_AI.chooseMove(chess, HARD_ELO);
    } else {
      mv = loneKingMove(chess);
    }
    if (!mv) break;
    chess.move(mv);
    if (chess.in_checkmate()) return ply + 1;
    if (chess.in_draw() || chess.in_stalemate() || chess.insufficient_material()) return -1;
  }
  return chess.in_checkmate() ? budgetPlies : -1;
}

function main() {
  // Plies budget. Elementary mates are well under 30 plies of *engine* moves;
  // we allow headroom because HARD-band weakening (slack/noise) can lengthen the
  // technique a little. The point is that it CONVERTS — the audit bug shuffled
  // forever (22 moves, no mate) regardless of budget.
  const BUDGET = 50;

  // --- 1) K+Q vs K (white to move, queen on d1, kings e1/e8) -----------------
  {
    const fen = '4k3/8/8/8/8/8/8/3QK3 w - - 0 1';
    const t = Date.now();
    const plies = playToMate(fen, 'w', BUDGET);
    log(`K+Q-vs-K: ${plies > 0 ? 'MATE in ' + plies + ' plies' : 'NO MATE'} (${Date.now() - t}ms)`);
    assert(plies > 0, `engine delivers K+Q-vs-K checkmate within ${BUDGET} plies (was the 22-move audit bug)`);
  }

  // --- 2) K+R vs K (white to move, rook on a1, kings e1/e8) ------------------
  {
    const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
    const t = Date.now();
    const plies = playToMate(fen, 'w', BUDGET);
    log(`K+R-vs-K: ${plies > 0 ? 'MATE in ' + plies + ' plies' : 'NO MATE'} (${Date.now() - t}ms)`);
    assert(plies > 0, `engine delivers K+R-vs-K checkmate within ${BUDGET} plies`);
  }

  // --- 3) K+Q vs K from a corner-ish start, black winning --------------------
  {
    const fen = '3qk3/8/8/8/8/8/8/4K3 b - - 0 1';
    const t = Date.now();
    const plies = playToMate(fen, 'b', BUDGET);
    log(`K+Q-vs-K (black): ${plies > 0 ? 'MATE in ' + plies + ' plies' : 'NO MATE'} (${Date.now() - t}ms)`);
    assert(plies > 0, `engine delivers K+Q-vs-K checkmate for black within ${BUDGET} plies`);
  }

  // --- 4) Regression: normal positions / tactics still work ------------------
  {
    // Obvious winning capture (free queen on a8) — must still be found.
    const bm = CT_AI.bestMove('q3k3/8/8/8/8/8/8/Q3K3 w - - 0 1', 3);
    assert(bm && bm.move && bm.move.to === 'a8' && bm.move.captured,
      `regression: still captures the hanging queen on a8 (got ${bm && bm.move && bm.move.to})`);

    // Mate-in-1: back-rank mate, Ra8#. The engine must find it.
    const m1 = new Chess('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
    const mv = CT_AI.chooseMove(m1, HARD_ELO);
    m1.move(mv);
    assert(m1.in_checkmate(), `regression: finds the mate-in-1 (Ra8#), played ${mv && mv.san}`);
    log(`regression: hanging-queen capture + mate-in-1 ✓`);

    // Phase sanity: the opening eval is still ~0 (the endgame king term must NOT
    // leak into the middlegame).
    const startEval = CT_AI.evaluate(new Chess().fen(), 1);
    assert(Math.abs(startEval) < 80, `regression: opening eval ~0, got ${startEval}`);
    log(`regression: opening eval ${startEval} (~0) ✓`);
  }

  log(`PASS — ${passed} assertions; engine converts elementary endgames + no midgame regression`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error('[endgame] FAIL:', err.message);
  process.exit(1);
}
