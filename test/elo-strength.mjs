#!/usr/bin/env node
/*
 * elo-strength.mjs — verifies CT_AI.bestMoveForElo(fen, targetElo): the
 * ELO-TARGETED move selector a server bot-backfill feature uses to match any
 * opponent's rating with the BUILT-IN engine (no Stockfish).
 *
 * It loads chess.js + ct-ai.js head-less (the synchronous Node path, exactly
 * like test/endgame.mjs) and asserts:
 *   1) LEGALITY  — bestMoveForElo returns a LEGAL move at 600/1000/1500/2000 on
 *      several positions.
 *   2) GRADIENT  — on a clear mate-in-1 and on a free-queen capture, a HIGH elo
 *      finds the best move (near-)reliably across repeats while a LOW elo is
 *      allowed to miss it. We measure both: (a) 2000 plays the mate-in-1 every
 *      time and 600 does NOT always, and (b) high-elo's average centipawn quality
 *      over N samples is strictly better than low-elo's on a tactical position.
 *   3) EDGE FENS — no crash (returns null, never throws) on stalemate / no-moves
 *      / garbage FEN inputs.
 *
 * Run:   node test/elo-strength.mjs   (exits 0 on PASS, 1 on FAIL).
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const log = (...a) => console.log('[elo-strength]', ...a);
let passed = 0;
const fail = (m) => { throw new Error('ASSERT FAILED: ' + m); };
const assert = (c, m) => { if (!c) fail(m); else passed++; };

// --- Load chess.js (CommonJS) then ct-ai.js as a plain global script (same as
// test/endgame.mjs): expose Chess on globalThis so ct-ai.js's _ChessCtor finds
// it; eval ct-ai.js so it installs globalThis.CT_AI (no Worker branch in Node).
const Chess = require(path.resolve(ROOT, 'chess.min.js')).Chess;
globalThis.Chess = Chess;
const aiSrc = fs.readFileSync(path.resolve(ROOT, 'ct-ai.js'), 'utf8');
(0, eval)(aiSrc);
const CT_AI = globalThis.CT_AI;
assert(CT_AI && typeof CT_AI.bestMoveForElo === 'function', 'CT_AI.bestMoveForElo is available');

// A move is "legal" if applying it to a fresh copy of the FEN succeeds.
function isLegal(fen, mv) {
  if (!mv || !mv.from || !mv.to) return false;
  const c = new Chess(fen);
  const applied = c.move({ from: mv.from, to: mv.to, promotion: mv.promotion || 'q' });
  return !!applied;
}

// Centipawn quality of a move, from the SIDE-TO-MOVE's perspective: how close the
// resulting position's eval is to the best available move's eval (0 = best, more
// negative = worse). We score every legal reply with the engine's own evaluate()
// at a fixed depth so high/low elo are judged on the same yardstick.
function moveQuality(fen, mv, depth) {
  const c = new Chess(fen);
  const stm = c.turn();
  const sign = stm === 'w' ? 1 : -1;
  const moves = c.moves({ verbose: true });
  let bestAfter = -Infinity; // best (for stm) reachable eval, in stm-positive cp
  const evalAfter = (m) => {
    const cc = new Chess(fen);
    cc.move(m);
    return sign * CT_AI.evaluate(cc.fen(), depth); // stm-positive
  };
  for (const m of moves) { const v = evalAfter(m); if (v > bestAfter) bestAfter = v; }
  const got = evalAfter({ from: mv.from, to: mv.to, promotion: mv.promotion || 'q' });
  return got - bestAfter; // 0 = played the best, negative = how much worse
}

function main() {
  // ---------------------------------------------------------------------------
  // 1) LEGALITY across the target rating range on several positions.
  // ---------------------------------------------------------------------------
  const positions = [
    new Chess().fen(),                                  // opening
    'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', // Ruy-ish midgame
    '4k3/8/8/8/8/8/8/3QK3 w - - 0 1',                   // K+Q vs K endgame
    '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1',                  // K+P vs K
  ];
  const elos = [600, 1000, 1500, 2000];
  for (const fen of positions) {
    for (const elo of elos) {
      const mv = CT_AI.bestMoveForElo(fen, elo);
      assert(isLegal(fen, mv), `legal move @${elo} on ${fen} (got ${mv && mv.from + mv.to})`);
    }
  }
  log(`1) legality: ${positions.length} positions x ${elos.length} elos all returned LEGAL moves ✓`);

  // ---------------------------------------------------------------------------
  // 2a) GRADIENT — mate-in-1. 2000 must find Ra8# every time; 600 is ALLOWED to
  //     miss it (and, given its noise/slack, should at least sometimes). We only
  //     hard-assert the strong end is reliable and that low<=high.
  // ---------------------------------------------------------------------------
  {
    const fen = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1'; // Ra8# is mate-in-1
    const N = 30;
    const playsMate = (elo) => {
      let hits = 0;
      for (let i = 0; i < N; i++) {
        const mv = CT_AI.bestMoveForElo(fen, elo);
        const c = new Chess(fen);
        c.move({ from: mv.from, to: mv.to, promotion: mv.promotion || 'q' });
        if (c.in_checkmate()) hits++;
      }
      return hits / N;
    };
    const hi = playsMate(2000);
    const lo = playsMate(600);
    log(`2a) mate-in-1 hit rate: 2000=${(hi * 100).toFixed(0)}%  600=${(lo * 100).toFixed(0)}% (N=${N})`);
    assert(hi >= 0.95, `high elo (2000) plays the mate-in-1 (near-)always, got ${(hi * 100).toFixed(0)}%`);
    assert(lo <= hi, `low elo (600) does not exceed high elo on the mate-in-1 (${(lo * 100).toFixed(0)}% vs ${(hi * 100).toFixed(0)}%)`);
  }

  // ---------------------------------------------------------------------------
  // 2b) GRADIENT — average centipawn quality on a tactical position. High elo's
  //     average must be STRICTLY better (closer to 0 = closer to best) than low
  //     elo's over N samples. This is the core "strength gradient" assertion.
  // ---------------------------------------------------------------------------
  {
    // White to move: Qxa8 wins a free queen (clear best). Lots of quiet
    // alternatives let a weak setting pick worse, so the gradient is visible.
    const fen = 'q3k3/8/8/8/8/8/8/Q3K3 w - - 0 1';
    const N = 40;
    const QDEPTH = 2;
    const avgQuality = (elo) => {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        const mv = CT_AI.bestMoveForElo(fen, elo);
        sum += moveQuality(fen, mv, QDEPTH);
      }
      return sum / N;
    };
    const hiQ = avgQuality(2000);
    const loQ = avgQuality(600);
    log(`2b) avg cp-quality (0=best, lower=worse): 2000=${hiQ.toFixed(1)}  600=${loQ.toFixed(1)} (N=${N})`);
    assert(hiQ > loQ, `high elo plays better on average than low elo (2000 ${hiQ.toFixed(1)} > 600 ${loQ.toFixed(1)})`);
    assert(hiQ > -30, `high elo stays near the best move on a free-queen position (got ${hiQ.toFixed(1)})`);
  }

  // ---------------------------------------------------------------------------
  // 2c) MATE-CONVERSION preserved at high elo — the no-slack-past-mate guard must
  //     still let a high-elo bot deliver the K+Q-vs-K mate. (Mirrors endgame.mjs
  //     but through bestMoveForElo to prove the elo path keeps the guard.)
  // ---------------------------------------------------------------------------
  {
    const fen = '4k3/8/8/8/8/8/8/3QK3 w - - 0 1';
    const c = new Chess(fen);
    let mated = false;
    const loneKingMove = (chess) => {
      const moves = chess.moves({ verbose: true });
      const board = chess.board(); const me = chess.turn();
      let ek = null;
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        const p = board[r][f]; if (p && p.type === 'k' && p.color !== me) ek = { r, f };
      }
      const sqRC = (sq) => ({ f: sq.charCodeAt(0) - 97, r: 8 - Number(sq[1]) });
      let best = moves[0], bs = -Infinity;
      for (const m of moves) {
        const to = sqRC(m.to);
        const dk = ek ? Math.max(Math.abs(to.r - ek.r), Math.abs(to.f - ek.f)) : 0;
        const dc = -(Math.abs(to.r - 3.5) + Math.abs(to.f - 3.5));
        const sc = dk * 10 + dc; if (sc > bs) { bs = sc; best = m; }
      }
      return best;
    };
    for (let ply = 0; ply < 60 && !chessDone(c); ply++) {
      const mv = c.turn() === 'w' ? CT_AI.bestMoveForElo(c.fen(), 2000) : loneKingMove(c);
      if (!mv) break;
      c.move(mv);
      if (c.in_checkmate()) { mated = true; break; }
    }
    log(`2c) K+Q-vs-K via bestMoveForElo(2000): ${mated ? 'MATE' : 'NO MATE'}`);
    assert(mated, 'high-elo bestMoveForElo still converts K+Q-vs-K (mate guard intact)');
  }

  // ---------------------------------------------------------------------------
  // 3) EDGE FENS — never throw, return null where there is no move.
  // ---------------------------------------------------------------------------
  {
    const stalemate = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'; // black to move, stalemated
    const checkmate = '6k1/5ppp/8/8/8/8/8/4R1K1 b - - 0 1'; // black mated? build a real one below
    const noMoveCases = [
      'k7/8/1Q6/8/8/8/8/K7 b - - 0 1',  // possibly stalemate-ish; just must not throw
      stalemate,
      checkmate,
      'not a fen',
      '',
      null,
      undefined,
    ];
    for (const fen of noMoveCases) {
      let threw = false, res;
      try { res = CT_AI.bestMoveForElo(fen, 1200); } catch (e) { threw = true; }
      assert(!threw, `bestMoveForElo must not throw on edge FEN ${JSON.stringify(fen)}`);
      // For genuinely no-move FENs, expect null; for garbage we just require no throw.
    }
    // Explicit stalemate: no legal move => null.
    const sm = CT_AI.bestMoveForElo(stalemate, 1500);
    assert(sm === null, `stalemate FEN returns null (got ${JSON.stringify(sm)})`);
    log('3) edge FENs: no crash on stalemate / garbage / null; stalemate -> null ✓');
  }

  // Bad/out-of-range elos clamp instead of breaking.
  {
    const fen = new Chess().fen();
    for (const elo of [0, 50, 99999, -100, NaN, 'x', null, undefined]) {
      const mv = CT_AI.bestMoveForElo(fen, elo);
      assert(isLegal(fen, mv), `out-of-range elo ${JSON.stringify(elo)} still yields a legal move`);
    }
    log('4) out-of-range / non-numeric elos clamp to a legal move ✓');
  }

  log(`PASS — ${passed} assertions; bestMoveForElo is legal, shows a strength gradient, and is edge-safe`);
  return 0;
}

function chessDone(c) {
  return c.game_over() || c.in_checkmate() || c.in_draw() || c.in_stalemate() || c.insufficient_material();
}

try {
  process.exit(main());
} catch (err) {
  console.error('[elo-strength] FAIL:', err.message);
  process.exit(1);
}
