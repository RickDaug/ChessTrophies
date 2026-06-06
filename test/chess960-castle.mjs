#!/usr/bin/env node
/*
 * chess960-castle.mjs — pure-node test for REAL Chess960 (Fischer Random)
 * castling implemented in chess960.js on top of the bundled chess.js 0.10.x.
 *
 * It loads chess.min.js and chess960.js inside a vm sandbox (no DOM, no
 * browser), grabs the `Chess` global and `window.CT_960Castle`, then verifies
 * castling across several 960 start positions plus negative cases.
 *
 * Run:   node test/chess960-castle.mjs        (exit 0 = PASS)
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const log = (...a) => console.log('[960-castle]', ...a);
let passed = 0;
function assert(cond, msg) {
  if (!cond) { throw new Error('ASSERT FAILED: ' + msg); }
  passed++;
}

// --- Load chess.min.js + chess960.js into one sandbox ---------------------
const sandbox = { window: {}, console, exports: {}, define: undefined };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'chess.min.js'), 'utf8'), sandbox, { filename: 'chess.min.js' });
// chess960.js references `Chess` and `window`; both live on the sandbox global.
vm.runInContext(fs.readFileSync(path.join(ROOT, 'chess960.js'), 'utf8'), sandbox, { filename: 'chess960.js' });

const Chess = sandbox.Chess;
const C960 = sandbox.window.CT_960Castle;
assert(typeof Chess === 'function', 'Chess global present');
assert(C960 && typeof C960.applyCastle === 'function', 'CT_960Castle API present');
log('loaded chess.js + chess960.js in vm; API present');

// Helper: build a custom FEN from a back rank string (white) with empty middle.
function fenFromBackRank(white, turn = 'w', rights = 'KQkq') {
  const black = white.toLowerCase();
  return `${black}/pppppppp/8/8/8/8/PPPPPPPP/${white} ${turn} ${rights} - 0 1`;
}

// Helper: pretty board lookup
function at(game, sq) { const p = game.get(sq); return p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : '.'; }

// =========================================================================
// 1) Standard back rank (king e, rooks a/h) — both castles work like normal.
// =========================================================================
(function standardBackRank() {
  // Clear the path: remove b,c,d,f,g pieces so castling is unobstructed.
  // Use a minimal legal position: kings + rooks only.
  const fen = '4k3/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const start = fen;
  let g = new Chess(fen);
  // h-side castle: K e1->g1, R h1->f1
  let h = C960.canCastle(g, 'h', start);
  assert(h, 'standard: h-side castle available');
  assert(h.kingTo === 'g1' && h.rookTo === 'f1', 'standard h-side targets g1/f1');
  const mvH = C960.applyCastle(g, 'h', start);
  assert(mvH, 'standard h-side applied');
  assert(at(g, 'g1') === 'K' && at(g, 'f1') === 'R', 'standard h-side: K g1 / R f1');
  assert(at(g, 'e1') === '.' && at(g, 'h1') === '.', 'standard h-side: e1/h1 cleared');
  assert(g.turn() === 'b', 'standard h-side: turn flipped to black');

  // a-side castle from a fresh game
  g = new Chess(fen);
  let a = C960.canCastle(g, 'a', start);
  assert(a && a.kingTo === 'c1' && a.rookTo === 'd1', 'standard a-side targets c1/d1');
  C960.applyCastle(g, 'a', start);
  assert(at(g, 'c1') === 'K' && at(g, 'd1') === 'R', 'standard a-side: K c1 / R d1');
  assert(at(g, 'a1') === '.' && at(g, 'e1') === '.', 'standard a-side: a1/e1 cleared');
  log('1) standard back-rank castling OK (both sides)');
})();

// =========================================================================
// 2) Shuffled position A: king on b1, rooks on a1 and h1.
//    a-side: K b1->c1, R a1->d1 ;  h-side: K b1->g1, R h1->f1
// =========================================================================
(function shuffledA() {
  // back rank: a=R, b=K, then bishops/queen/knights, h=R. Use full back rank.
  // RKNBQNBR -> rooks a/h, king b. bishops on c(light) & g(dark? check) — colours
  // don't matter for castling logic; keep it simple & legal-ish for the test.
  const white = 'RKR' + 'NBQNB'; // a=R b=K c=R ... wait need rooks a&h only.
  // Build explicitly: a1=R, b1=K, c..g = filler (N B Q N B), h1=R
  const wr = 'RK' + 'NBQNB' + 'R';
  const start = fenFromBackRank(wr);
  // For clean castling tests, clear the middle pieces by hand via put/remove.
  let g = new Chess(start);
  // remove everything between king(b1) and rooks so the path is empty
  ['c1', 'd1', 'e1', 'f1', 'g1'].forEach(s => g.remove(s));
  ['c8', 'd8', 'e8', 'f8', 'g8'].forEach(s => g.remove(s));
  const cleared = g.fen();
  g = new Chess(cleared);

  // h-side: K b1 -> g1, R h1 -> f1
  let h = C960.canCastle(g, 'h', start);
  assert(h && h.kingFrom === 'b1' && h.rookFrom === 'h1', 'shuffledA h-side rook is h1');
  assert(h.kingTo === 'g1' && h.rookTo === 'f1', 'shuffledA h-side -> K g1 / R f1');
  C960.applyCastle(g, 'h', start);
  assert(at(g, 'g1') === 'K' && at(g, 'f1') === 'R', 'shuffledA h-side result K g1 / R f1');
  assert(at(g, 'b1') === '.' && at(g, 'h1') === '.', 'shuffledA h-side cleared b1/h1');

  // a-side: K b1 -> c1, R a1 -> d1
  g = new Chess(cleared);
  let a = C960.canCastle(g, 'a', start);
  assert(a && a.rookFrom === 'a1', 'shuffledA a-side rook is a1');
  assert(a.kingTo === 'c1' && a.rookTo === 'd1', 'shuffledA a-side -> K c1 / R d1');
  C960.applyCastle(g, 'a', start);
  assert(at(g, 'c1') === 'K' && at(g, 'd1') === 'R', 'shuffledA a-side result K c1 / R d1');
  assert(at(g, 'a1') === '.', 'shuffledA a-side cleared a1');
  log('2) shuffled position A (K b1, R a1/h1) castling OK');
})();

// =========================================================================
// 3) Shuffled position B: king on f1, rooks on c1 and g1 (both rooks NOT on
//    a/h). a-side rook c1, h-side rook g1.
//    h-side: K f1->g1, R g1->f1 (king and rook swap-ish) ;
//    a-side: K f1->c1, R c1->d1.
// =========================================================================
const shuffledBStart = (function shuffledB() {
  // explicit back rank: a=N b=B c=R d=Q e=B f=K g=R h=N -> rooks c & g, king f
  const wr = 'NBRQBKRN';
  const start = fenFromBackRank(wr);
  let g = new Chess(start);
  // clear path squares between/around for clean test
  ['a1', 'b1', 'd1', 'e1', 'h1'].forEach(s => g.remove(s));
  ['a8', 'b8', 'd8', 'e8', 'h8'].forEach(s => g.remove(s));
  const cleared = g.fen();
  g = new Chess(cleared);

  // h-side: rook g1, king f1 -> K g1, R f1
  let h = C960.canCastle(g, 'h', start);
  assert(h && h.rookFrom === 'g1' && h.kingFrom === 'f1', 'shuffledB h-side rook g1 king f1');
  assert(h.kingTo === 'g1' && h.rookTo === 'f1', 'shuffledB h-side -> K g1 / R f1');
  C960.applyCastle(g, 'h', start);
  assert(at(g, 'g1') === 'K' && at(g, 'f1') === 'R', 'shuffledB h-side result K g1 / R f1');

  // a-side: rook c1, king f1 -> K c1, R d1
  g = new Chess(cleared);
  let a = C960.canCastle(g, 'a', start);
  assert(a && a.rookFrom === 'c1', 'shuffledB a-side rook c1');
  assert(a.kingTo === 'c1' && a.rookTo === 'd1', 'shuffledB a-side -> K c1 / R d1');
  C960.applyCastle(g, 'a', start);
  assert(at(g, 'c1') === 'K' && at(g, 'd1') === 'R', 'shuffledB a-side result K c1 / R d1');
  log('3) shuffled position B (K f1, R c1/g1) castling OK');
  return { start, cleared };
})();

// =========================================================================
// 4) NEGATIVE: blocked by a piece between king and destination.
// =========================================================================
(function blocked() {
  // standard rank but a knight sits on f1 blocking the h-side castle.
  const fen = '4k3/8/8/8/8/8/8/R3KN1R w KQkq - 0 1';
  const start = '4k3/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const g = new Chess(fen);
  assert(!C960.canCastle(g, 'h', start), 'blocked: h-side rejected (knight on f1)');
  // a-side is clear, should still work
  assert(C960.canCastle(g, 'a', start), 'blocked: a-side still legal');
  log('4) NEGATIVE blocked-by-piece OK');
})();

// =========================================================================
// 5) NEGATIVE: castling THROUGH an attacked square is rejected.
// =========================================================================
(function throughCheck() {
  // King e1, rooks a1/h1. Black rook on f8 attacks f1 — king passes f1 on the
  // h-side castle, so it must be rejected. a-side path (d1,c1) is safe.
  const fen = '5r2/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const start = '4k3/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  // give black a king so the position is legal-ish for chess.js load.
  const fen2 = '4k1r1/8/8/8/8/8/8/R3K2R w KQkq - 0 1'; // rook g8 attacks g1
  const g = new Chess(fen2);
  assert(!C960.canCastle(g, 'h', start), 'through-check: h-side rejected (g1 attacked)');
  assert(C960.canCastle(g, 'a', start), 'through-check: a-side still legal');
  log('5) NEGATIVE castle-through-attacked-square OK');
})();

// =========================================================================
// 6) NEGATIVE: castling while in check is rejected.
// =========================================================================
(function inCheck() {
  // Black rook on e8 gives check to white king on e1 -> no castling either side.
  const fen = '4r3/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const start = '4k3/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  // need a black king somewhere not giving spurious info
  const fen2 = 'k3r3/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const g = new Chess(fen2);
  assert(g.in_check(), 'in-check: white is actually in check');
  assert(!C960.canCastle(g, 'h', start), 'in-check: h-side rejected');
  assert(!C960.canCastle(g, 'a', start), 'in-check: a-side rejected');
  log('6) NEGATIVE castle-while-in-check OK');
})();

// =========================================================================
// 7) NEGATIVE: castling right consumed after a king move.
// =========================================================================
(function rightConsumed() {
  const start = '4k3/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const g = new Chess(start);
  // Move the king e1->e2 and back e2->e1; right must be gone.
  g.move({ from: 'e1', to: 'e2' });   // white king moves
  g.move({ from: 'e8', to: 'e7' });   // black king moves (any legal reply)
  g.move({ from: 'e2', to: 'e1' });   // white king returns home
  g.move({ from: 'e7', to: 'e8' });   // black replies
  // now white to move; king is home but right was lost on first king move
  assert(g.turn() === 'w', 'rightConsumed: white to move');
  assert(!C960.canCastle(g, 'h', start), 'rightConsumed: h-side gone after king move');
  assert(!C960.canCastle(g, 'a', start), 'rightConsumed: a-side gone after king move');
  log('7) NEGATIVE castling-right-consumed-after-king-move OK');
})();

// =========================================================================
// 8) NEGATIVE: castling right consumed after the specific rook moves.
// =========================================================================
(function rookMoved() {
  const start = '4k3/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const g = new Chess(start);
  g.move({ from: 'h1', to: 'g1' });   // h-rook moves
  g.move({ from: 'e8', to: 'd8' });
  g.move({ from: 'g1', to: 'h1' });   // h-rook returns
  g.move({ from: 'd8', to: 'e8' });
  assert(!C960.canCastle(g, 'h', start), 'rookMoved: h-side gone after h-rook moved');
  assert(C960.canCastle(g, 'a', start), 'rookMoved: a-side still legal (a-rook never moved)');
  log('8) NEGATIVE right-consumed-after-rook-move OK');
})();

// =========================================================================
// 9) castleIntent: detect king-onto-own-rook and king-to-g/c destination.
// =========================================================================
(function intents() {
  const { cleared, start } = shuffledBStart;
  let g = new Chess(cleared);
  // king f1, h-rook g1: clicking king f1 -> rook g1 should be detected.
  let d1 = C960.castleIntent(g, 'f1', 'g1', start);
  assert(d1 && d1.side === 'h', 'intent: king-onto-own-rook (f1->g1) => h-side');
  // a-side: king f1, a-rook c1: click king f1 -> c1 (its own rook) => a-side
  let d2 = C960.castleIntent(g, 'f1', 'c1', start);
  assert(d2 && d2.side === 'a', 'intent: king-onto-own-rook (f1->c1) => a-side');

  // standard rank: king e1 -> g1 destination (two squares) => h-side
  const sg = new Chess('4k3/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  let d3 = C960.castleIntent(sg, 'e1', 'g1', '4k3/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert(d3 && d3.side === 'h', 'intent: king e1->g1 (two squares) => h-side');
  let d4 = C960.castleIntent(sg, 'e1', 'c1', '4k3/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert(d4 && d4.side === 'a', 'intent: king e1->c1 (two squares) => a-side');
  // a normal one-square king move is NOT a castle
  let d5 = C960.castleIntent(sg, 'e1', 'd1', '4k3/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert(!d5, 'intent: e1->d1 is not a castle');
  log('9) castleIntent detection OK');
})();

// =========================================================================
// 10) Black castling works too (turn = black).
// =========================================================================
(function blackCastle() {
  const start = 'r3k2r/8/8/8/8/8/8/4K3 b KQkq - 0 1';
  const g = new Chess(start);
  assert(g.turn() === 'b', 'black to move');
  let h = C960.canCastle(g, 'h', start);
  assert(h && h.kingTo === 'g8' && h.rookTo === 'f8', 'black h-side -> g8/f8');
  C960.applyCastle(g, 'h', start);
  assert(at(g, 'g8') === 'k' && at(g, 'f8') === 'r', 'black h-side result k g8 / r f8');
  assert(g.turn() === 'w', 'black h-side: turn flipped to white');
  log('10) black castling OK');
})();

log(`PASS — ${passed} assertions across 10 cases`);
process.exit(0);
