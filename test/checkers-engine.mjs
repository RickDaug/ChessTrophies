#!/usr/bin/env node
/*
 * checkers-engine.mjs — rules test for the self-contained Checkers/Draughts engine.
 *
 * Loads ../checkers.js (a CLASSIC UMD-lite script) via createRequire, exactly the
 * way test/challenge.mjs loads the socket.io-client CommonJS package, and asserts
 * the OFFICIAL rules for ACF (8x8), FMJD (10x10) and the casual variant.
 *
 * Run:   node test/checkers-engine.mjs   (or npm run test:checkers)
 *        Exits 0 on PASS, 1 on FAIL.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CT = require(path.resolve(__dirname, '..', 'checkers.js'));

const log = (...a) => console.log('[checkers-engine]', ...a);
let passed = 0;
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail('ASSERT FAILED: ' + m); else { passed++; } };
const eq = (a, b, m) => assert(a === b, m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');

const n8 = (r, c) => CT.rcToSquare(8, r, c);
const n10 = (r, c) => CT.rcToSquare(10, r, c);
const notations = (g) => g.legalMoves().map((m) => m.notation);

function main() {
  // --- Opening legal-move counts -------------------------------------------
  {
    const g = CT.create({ size: 8, rules: 'acf' });
    eq(g.legalMoves().length, 7, '8x8 ACF opening has 7 first moves');
    eq(g.turn(), 'w', 'white moves first');
    eq(g.size, 8, 'size is 8'); eq(g.rules, 'acf', 'rules is acf');
  }
  {
    const g = CT.create({ size: 10, rules: 'fmjd' });
    eq(g.legalMoves().length, 9, '10x10 FMJD opening has 9 first moves');
  }
  log('opening counts OK');

  // --- Mandatory capture: only captures offered when one exists ------------
  {
    // White man at 18, black man at 14 (capturable up-left to 9), plus a quiet
    // white man at 23. With mandatory capture, only the capture is legal.
    const g = CT.create({ size: 8, rules: 'acf', position: { 18: 'w', 14: 'b', 23: 'w' }, turn: 'w' });
    const lm = g.legalMoves();
    assert(lm.length === 1 && lm[0].notation === '18x9', 'ACF mandatory: only the capture is offered');
    assert(lm.every((m) => m.captures.length > 0), 'ACF mandatory: every legal move is a capture');
  }
  log('mandatory capture OK');

  // --- Multi-jump returned as ONE move, no double-jumping a piece ----------
  {
    // White at 22 double-jumps black at 17 then black at 9 -> 22x13x6.
    const g = CT.create({ size: 8, rules: 'acf', position: { 22: 'w', 17: 'b', 9: 'b' }, turn: 'w' });
    const lm = g.legalMoves();
    eq(lm.length, 1, 'multi-jump: a single sequence is returned');
    eq(lm[0].notation, '22x13x6', 'multi-jump notation lists every landing');
    eq(lm[0].captures.length, 2, 'multi-jump captures both pieces');
    eq(lm[0].path.length, 3, 'multi-jump path has 3 squares (start + 2 lands)');
    // No piece captured twice (captures set is unique).
    const uniq = new Set(lm[0].captures);
    eq(uniq.size, lm[0].captures.length, 'no captured square appears twice');
  }
  log('multi-jump OK');

  // --- ACF men capture FORWARD ONLY; kings may capture backward ------------
  {
    // White man at 14 with a black man directly "behind" it at 18 (down the
    // board = backward for white). The man may NOT capture backward.
    const g = CT.create({ size: 8, rules: 'acf', position: { 14: 'w', 18: 'b' }, turn: 'w' });
    const lm = notations(g);
    assert(lm.every((m) => m.indexOf('x') === -1), 'ACF man does NOT capture backward');
    assert(lm.length > 0 && lm.some((m) => m.indexOf('-') !== -1), 'ACF man still has a quiet move');
    // Same position but the white piece is a KING -> it CAN capture backward.
    const gk = CT.create({ size: 8, rules: 'acf', position: { 14: 'W', 18: 'b' }, turn: 'w' });
    const lk = notations(gk);
    assert(lk.includes('14x23'), 'ACF KING captures backward (14x23)');
  }
  log('ACF forward-only men / backward-capturing king OK');

  // --- FMJD men DO capture backward ----------------------------------------
  {
    // White man at (3,2) with a black at (4,3) below it -> capture backward to (5,4).
    const g = CT.create({ size: 10, rules: 'fmjd', position: { [n10(3, 2)]: 'w', [n10(4, 3)]: 'b' }, turn: 'w' });
    const lm = notations(g);
    assert(lm.some((m) => m.indexOf('x') !== -1), 'FMJD man capture backward is offered');
  }
  log('FMJD backward-capturing men OK');

  // --- FMJD maximum capture: a 2-capture and a 3-capture -> only the 3 ------
  {
    const pos = {};
    pos[n10(7, 4)] = 'w';
    pos[n10(6, 5)] = 'b'; pos[n10(4, 7)] = 'b';                 // right chain (2)
    pos[n10(6, 3)] = 'b'; pos[n10(4, 1)] = 'b'; pos[n10(2, 1)] = 'b'; // left chain (3)
    const g = CT.create({ size: 10, rules: 'fmjd', position: pos, turn: 'w' });
    const lm = g.legalMoves();
    eq(lm.length, 1, 'FMJD maximum: only the maximum-count sequence is legal');
    eq(lm[0].captures.length, 3, 'FMJD maximum: the legal sequence captures 3');
    // And the engine actually generated a 2-capture alternative that was filtered.
    const all = g._captureMoves('w');
    assert(all.some((m) => m.captures.length === 2) && all.some((m) => m.captures.length === 3),
      'FMJD maximum: both a 2- and a 3-capture sequence exist before filtering');
  }
  log('FMJD maximum capture OK');

  // --- FMJD flying king: distant capture + quiet long slide ----------------
  {
    // Quiet long slide: a lone king in the corner can slide the whole diagonal.
    const gq = CT.create({ size: 10, rules: 'fmjd', position: { [n10(9, 0)]: 'W' }, turn: 'w' });
    eq(gq.legalMoves().length, 9, 'FMJD flying king slides the full open diagonal (9 squares)');
    // Distant capture: king at (8,1), enemy at (5,4) with empties between; the
    // king jumps it and may land on ANY empty square beyond.
    const gc = CT.create({ size: 10, rules: 'fmjd', position: { [n10(8, 1)]: 'W', [n10(5, 4)]: 'b' }, turn: 'w' });
    const lm = gc.legalMoves();
    assert(lm.length >= 2, 'FMJD flying king has multiple landing squares beyond the victim');
    assert(lm.every((m) => m.captures.length === 1), 'FMJD flying king capture jumps exactly the one enemy');
    const victim = n10(5, 4);
    assert(lm.every((m) => m.captures[0] === victim), 'FMJD flying king captures the correct distant piece');
  }
  log('FMJD flying king OK');

  // --- ACF non-flying king moves only one square ---------------------------
  {
    const gk = CT.create({ size: 8, rules: 'acf', position: { [n8(4, 3)]: 'W' }, turn: 'w' });
    const lm = gk.legalMoves();
    eq(lm.length, 4, 'ACF king has exactly 4 one-square moves from the center');
    assert(lm.every((m) => Math.abs(CT.squareToRC(8, m.from).r - CT.squareToRC(8, m.to).r) === 1),
      'ACF king moves exactly one rank');
  }
  log('ACF non-flying king OK');

  // --- Promotion ends the turn (no further jump even if geometrically there) -
  {
    // White man at 11=(2,5) jumps black at 7=(1,4), landing at 2=(0,3) which is
    // the last rank -> promotes and STOPS, even though black at 6=(1,2) would
    // otherwise be jumpable from (0,3).
    const pos = {}; pos[n8(2, 5)] = 'w'; pos[n8(1, 4)] = 'b'; pos[n8(1, 2)] = 'b';
    const g = CT.create({ size: 8, rules: 'acf', position: pos, turn: 'w' });
    const lm = g.legalMoves();
    eq(lm.length, 1, 'promotion-jump: single sequence');
    eq(lm[0].notation, '11x2', 'promotion-jump stops at the last rank (11x2)');
    eq(lm[0].captures.length, 1, 'promotion-jump captures only one (does not chain past promotion)');
    assert(lm[0].promotion === true, 'promotion flag set');
    const m = g.move(lm[0]);
    assert(m !== null, 'promotion move applies');
    const k = g.get(2);
    assert(k && k.king === true && k.color === 'w', 'man became a king on the last rank');
    const stillThere = g.get(n8(1, 2));
    assert(stillThere && stillThere.color === 'b', 'the second black man was NOT captured (turn ended)');
    eq(g.turn(), 'b', 'turn passed to black after promotion');
  }
  log('promotion ends the turn OK');

  // --- Game over: a side with no pieces (no moves) loses --------------------
  {
    const g = CT.create({ size: 8, rules: 'acf', position: { [n8(0, 1)]: 'w' }, turn: 'b' });
    assert(g.isGameOver(), 'game over when the side to move has no pieces');
    eq(g.winner(), 'w', 'the other side wins');
    eq(g.gameOverReason(), 'no-moves', 'reason is no-moves');
    assert(!g.isDraw(), 'a win is not a draw');
  }
  // Game over: a side whose every piece is blocked has no legal move and loses.
  {
    // Black man boxed in the top-left corner by white men so it cannot move.
    // Black at (0,1)=2; white men adjacent diagonals below it occupy its squares.
    const pos = {};
    pos[n8(0, 1)] = 'b';            // black man, can only move down to (1,0)/(1,2)
    pos[n8(1, 0)] = 'w'; pos[n8(1, 2)] = 'w'; // both forward squares occupied
    // Make sure the white pieces themselves can't be captured by black (man forward only
    // -> black moving down, would jump white at (1,0) to (2,-1) off-board; (1,2) to (2,3)?).
    // Block the landing (2,3) too so no capture is possible.
    pos[n8(2, 3)] = 'w';
    const g = CT.create({ size: 8, rules: 'acf', position: pos, turn: 'b' });
    eq(g.legalMoves().length, 0, 'fully blocked side has no legal moves');
    assert(g.isGameOver(), 'blocked side: game over');
    eq(g.winner(), 'w', 'blocked side loses');
  }
  log('game over (no pieces / blocked) OK');

  // --- serialize() / load() round-trip -------------------------------------
  {
    const g = CT.create({ size: 10, rules: 'fmjd' });
    // play a few moves to dirty turn/counters/position
    g.move(g.legalMoves()[0]);
    g.move(g.legalMoves()[0]);
    const s = g.serialize();
    const g2 = CT.load(s);
    eq(g2.serialize(), s, 'serialize/load round-trips to an identical string');
    eq(g2.size, g.size, 'round-trip preserves size');
    eq(g2.rules, g.rules, 'round-trip preserves rules');
    eq(g2.turn(), g.turn(), 'round-trip preserves turn');
    eq(JSON.stringify(g2.board()), JSON.stringify(g.board()), 'round-trip preserves the board');
    eq(g2.legalMoves().length, g.legalMoves().length, 'round-trip preserves legal moves');
    // A king position round-trips too.
    const gk = CT.create({ size: 8, rules: 'acf', position: { 5: 'W', 28: 'B', 16: 'w' }, turn: 'b' });
    const gk2 = CT.load(gk.serialize());
    eq(JSON.stringify(gk2.board()), JSON.stringify(gk.board()), 'round-trip preserves kings');
    eq(gk2.turn(), 'b', 'round-trip preserves a non-default turn');
  }
  log('serialize/load round-trip OK');

  // --- casual variant: captures allowed but NOT forced ---------------------
  {
    const g = CT.create({ size: 8, rules: 'casual', position: { 18: 'w', 14: 'b', 23: 'w' }, turn: 'w' });
    const lm = g.legalMoves();
    assert(lm.some((m) => m.captures.length > 0), 'casual: capture is available');
    assert(lm.some((m) => m.captures.length === 0), 'casual: quiet moves are still legal (capture NOT forced)');
  }
  log('casual non-mandatory capture OK');

  // --- config table sanity --------------------------------------------------
  {
    eq(CT.configFor('acf', 8).menCaptureBack, false, 'config: ACF men do NOT capture backward (official correction)');
    eq(CT.configFor('acf', 8).flyingKings, false, 'config: ACF kings non-flying');
    eq(CT.configFor('fmjd', 10).menCaptureBack, true, 'config: FMJD men capture backward');
    eq(CT.configFor('fmjd', 10).flyingKings, true, 'config: FMJD flying kings');
    eq(CT.configFor('fmjd', 10).maximumCapture, true, 'config: FMJD maximum capture');
    eq(CT.configFor('casual', 8).mandatory, false, 'config: casual capture not mandatory');
  }
  log('config table OK');

  log('ALL ' + passed + ' ASSERTIONS PASSED');
}

try {
  main();
  log('PASS');
  process.exit(0);
} catch (e) {
  console.error('[checkers-engine] FAIL:', e.message);
  process.exit(1);
}
