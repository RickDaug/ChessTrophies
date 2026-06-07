#!/usr/bin/env node
/*
 * chess960-ai-castle.mjs — pure-node vm test proving the COMPUTER opponent can
 * castle in Chess960. The engine (ct-ai.js) normally generates moves only via
 * chess.js .moves(), which can't produce a 960 castle; chooseMove now accepts an
 * optional startFen960 and, when supplied, folds CT_960Castle.legalCastlingMoves
 * into the ROOT candidate set (scope: ROOT-ONLY — see ct-ai.js chooseMove).
 *
 * We load chess.min.js + chess960.js + ct-ai.js into one vm sandbox, exposing
 * the global as BOTH window and self (mirrors how the worker sees self.*), then:
 *   1) build a 960 position where castling is clearly the best developing move,
 *      call chooseMove(chess, highElo, startFen) and assert it RETURNS a castle
 *      descriptor; apply it and assert a legal result (king g/c + rook f/d);
 *   2) regression: chooseMove on a NORMAL position (no startFen) still returns a
 *      sane legal chess.js move and standard behaviour is untouched.
 *
 * Run:   node test/chess960-ai-castle.mjs        (exit 0 = PASS)
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const log = (...a) => console.log('[960-ai-castle]', ...a);
let passed = 0;
function assert(cond, msg) {
  if (!cond) { throw new Error('ASSERT FAILED: ' + msg); }
  passed++;
}

// --- Load chess.min.js + chess960.js + ct-ai.js into one sandbox -----------
// Expose the sandbox global as BOTH window and self so chess960.js / ct-ai.js
// attach CT_960Castle / CT_AI somewhere both code paths can find them (the real
// worker sees self.*; the main thread sees window.*).
const sandbox = { console, exports: {}, define: undefined };
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'chess.min.js'), 'utf8'), sandbox, { filename: 'chess.min.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'ct-ai.js'), 'utf8'), sandbox, { filename: 'ct-ai.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'chess960.js'), 'utf8'), sandbox, { filename: 'chess960.js' });

const Chess = sandbox.Chess;
const CT_AI = sandbox.CT_AI;
const C960 = sandbox.CT_960Castle;
assert(typeof Chess === 'function', 'Chess global present');
assert(CT_AI && typeof CT_AI.chooseMove === 'function', 'CT_AI.chooseMove present');
assert(C960 && typeof C960.legalCastlingMoves === 'function', 'CT_960Castle present');
log('loaded chess.min.js + ct-ai.js + chess960.js in vm; APIs present');

function at(game, sq) { const p = game.get(sq); return p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : '.'; }

// =========================================================================
// 1) Engine CAN castle in 960 when it is clearly the best move.
//
// A genuinely SHUFFLED 960 back rank (index 537: RNKBBQNR) — king on c1 with
// rooks on a1 and h1, so chess.js's own .moves() cannot produce this castle
// (it only castles from the classic e-file king). We strip down to king + the
// two castling rooks + a few pawns and OPEN the centre so the king on c1 is
// exposed: the h-side castle (K c1->g1, R h1->f1) tucks the king onto g1 (a
// good king-PST square), which the static evaluator scores above every quiet
// alternative — a clear, tactic-free king-safety gain.
// =========================================================================
(function engineCastles() {
  const start = 'rnkbbqnr/pppppppp/8/8/8/8/PPPPPPPP/RNKBBQNR w KQkq - 0 1';
  // Sparse, symmetric, quiet: white K c1 R a1/h1, black K c8 R a8/h8, edge pawns
  // only. d1..g1 are clear so the h-side castle is legal; the open centre makes
  // castling the stand-out move with no capture/tactic to distract the search.
  const fen = 'r1k4r/pp4pp/8/8/8/8/PP4PP/R1K4R w KQkq - 0 1';

  // Sanity: the 960-castle helper agrees the h-side castle is legal here, and
  // chess.js itself does NOT list this as a normal move (king is off the e-file).
  const legal = C960.legalCastlingMoves(new Chess(fen), start);
  assert(legal.length >= 1, 'helper: at least one legal castle in test position');
  const hSide = legal.find(d => d.side === 'h');
  assert(hSide && hSide.kingFrom === 'c1' && hSide.kingTo === 'g1' && hSide.rookTo === 'f1',
    'helper: h-side -> K c1->g1 / R ->f1');

  // Ask the engine (strong setting -> deterministic top move, no noise/slack).
  // Try a few times to absorb the mild root randomisation; assert it can produce
  // a castle (and that, when it does, the result is a legal castled position).
  let gotCastle = null;
  for (let i = 0; i < 12 && !gotCastle; i++) {
    const g = new Chess(fen);
    const m = CT_AI.chooseMove(g, 2400, start);
    assert(m, 'engine returned a move');
    if (m.castle) gotCastle = m;
  }
  assert(gotCastle, 'engine CHOSE a 960 castle as (one of) its best move(s)');
  assert(gotCastle.kingFrom === 'c1' && gotCastle.kingTo === 'g1', 'chosen castle: K c1->g1');
  assert(gotCastle.rookFrom === 'h1' && gotCastle.rookTo === 'f1', 'chosen castle: R h1->f1');
  assert(gotCastle.from === 'c1' && gotCastle.to === 'g1', 'chosen castle exposes from/to (king hop)');

  // Apply it exactly as app.js does and assert a legal, correct result.
  const g = new Chess(fen);
  const applied = C960.applyCastleDescriptor(g, gotCastle);
  assert(applied && applied.castle, 'applyCastleDescriptor returned a castle move');
  assert(at(g, 'g1') === 'K' && at(g, 'f1') === 'R', 'after castle: K g1 / R f1');
  assert(at(g, 'c1') === '.' && at(g, 'h1') === '.', 'after castle: c1/h1 cleared');
  assert(g.turn() === 'b', 'after castle: turn flipped to black');
  assert(!g.in_check(), 'after castle: resulting position is legal (white king not in check)');
  log('1) engine castles in 960 (K c1->g1, R h1->f1) and result is legal OK');
})();

// =========================================================================
// 2) REGRESSION: standard chess (no startFen960) is untouched — chooseMove
//    still returns a sane, LEGAL chess.js move and never a castle descriptor.
// =========================================================================
(function standardUntouched() {
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  for (let i = 0; i < 5; i++) {
    const g = new Chess(fen);
    const m = CT_AI.chooseMove(g, 1800); // no startFen960 -> standard path
    assert(m, 'standard: engine returned a move');
    assert(!m.castle, 'standard: never returns a 960 castle descriptor');
    // It must be a real legal chess.js move on this board.
    const ok = g.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
    assert(ok, 'standard: returned move is legal on the board');
  }
  // And with an empty move list it returns null (defensive, unchanged behaviour).
  const mate = new Chess('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
  assert(mate.in_checkmate(), 'standard: fool-mate position is checkmate');
  assert(CT_AI.chooseMove(mate, 1800) === null, 'standard: returns null when no moves');
  log('2) standard-chess chooseMove regression OK (legal move, no castle, null on mate)');
})();

log(`PASS — ${passed} assertions`);
process.exit(0);
