#!/usr/bin/env node
/*
 * checkers-ai.mjs — sanity test for the Checkers AI (checkers-ai.js).
 *
 * Loads ../checkers.js and ../checkers-ai.js (CLASSIC UMD-lite scripts) via
 * createRequire and asserts:
 *   - the AI returns a LEGAL move quickly (< ~1.5s) at several Elos on BOTH
 *     board sizes / rule sets;
 *   - in a position with a free single capture available, a STRONG AI takes a
 *     capture;
 *   - a WEAK-Elo move is still legal and never a self-capture.
 *
 * Run:   node test/checkers-ai.mjs   (or npm run test:checkers-ai)
 *        Exits 0 on PASS, 1 on FAIL.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CT = require(path.resolve(__dirname, '..', 'checkers.js'));
const AI = require(path.resolve(__dirname, '..', 'checkers-ai.js'));

const log = (...a) => console.log('[checkers-ai]', ...a);
let passed = 0;
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail('ASSERT FAILED: ' + m); else { passed++; } };

const n8 = (r, c) => CT.rcToSquare(8, r, c);

// Confirm a move object is in the game's legal set right now.
function isInLegalSet(game, move) {
  return game.legalMoves().some((m) => m.notation === move.notation);
}

function timeChoose(game, elo) {
  const t = Date.now();
  const m = AI.chooseMove(game, elo);
  return { move: m, ms: Date.now() - t };
}

function main() {
  const TIME_CAP = 1500;

  // --- Legal + fast at several Elos on both sizes --------------------------
  const configs = [
    { size: 8, rules: 'acf' },
    { size: 10, rules: 'fmjd' },
  ];
  const elos = [800, 1200, 1600, 2000, 2400];
  for (const cfg of configs) {
    for (const elo of elos) {
      const g = CT.create(cfg);
      const { move, ms } = timeChoose(g, elo);
      assert(move !== null, `AI returns a move (${cfg.rules} elo ${elo})`);
      assert(isInLegalSet(g, move), `AI move is LEGAL (${cfg.rules} elo ${elo})`);
      assert(ms < TIME_CAP, `AI is fast: ${ms}ms < ${TIME_CAP}ms (${cfg.rules} elo ${elo})`);
    }
    log(`legal + fast at all Elos OK (${cfg.rules})`);
  }

  // --- Strong AI takes a free single capture -------------------------------
  {
    // White man at 18 can freely capture black at 14 (-> 9). Mandatory anyway,
    // but we assert the AI plays a capture (and the engine forces only captures).
    const g = CT.create({ size: 8, rules: 'acf', position: { 18: 'w', 14: 'b', 23: 'w', 30: 'w' }, turn: 'w' });
    const { move } = timeChoose(g, 2400);
    assert(move !== null && isInLegalSet(g, move), 'strong AI returns a legal move (capture position)');
    assert(move.captures.length >= 1, 'strong AI takes a capture when one is freely available');
  }
  // A position where a capture is OPTIONAL (casual) and clearly winning material:
  // the strong AI should still grab it.
  {
    // casual: capture not forced. White at 18 may capture black at 14, or play
    // a quiet move. Capturing wins a man for free, so a strong AI takes it.
    const g = CT.create({ size: 8, rules: 'casual', position: { 18: 'w', 14: 'b', 30: 'w' }, turn: 'w' });
    const { move } = timeChoose(g, 2400);
    assert(move !== null && isInLegalSet(g, move), 'strong AI legal move (casual capture-optional)');
    assert(move.captures.length >= 1, 'strong AI grabs the free man even when capture is optional');
  }
  log('strong AI takes free captures OK');

  // --- Weak-Elo move: legal, never a self-capture --------------------------
  {
    // Run the weak AI many times from the opening; every move must be legal and
    // must never land on / capture a friendly piece (the engine guarantees this,
    // but we assert it to lock the contract).
    const g = CT.create({ size: 8, rules: 'acf' });
    for (let i = 0; i < 30; i++) {
      const m = AI.chooseMove(g, 700);
      assert(m !== null && isInLegalSet(g, m), 'weak AI move is legal');
      // No captured square may hold a friendly piece (self-capture).
      const me = g.turn();
      for (const cap of m.captures) {
        const victim = g.get(cap);
        assert(victim && victim.color !== me, 'weak AI never self-captures');
      }
    }
    log('weak AI legal / no self-capture OK');
  }

  // --- Weak vs strong: strong should not lose material on a free-capture pos -
  {
    // Sanity: at a position where the only sensible move is a capture, even the
    // weakest Elo (forced by mandatory capture) plays it.
    const g = CT.create({ size: 8, rules: 'acf', position: { 18: 'w', 14: 'b', 23: 'w' }, turn: 'w' });
    const m = AI.chooseMove(g, 700);
    assert(m !== null && m.captures.length >= 1, 'weak AI still makes the forced capture');
  }
  log('forced-capture handling OK');

  // --- difficultyFor mapping monotonic in depth ----------------------------
  {
    const lo = AI.difficultyFor(700), hi = AI.difficultyFor(2400);
    assert(hi.depth > lo.depth, 'higher Elo searches deeper');
    assert(hi.noise <= lo.noise, 'higher Elo has no more noise');
    assert(hi.slackN <= lo.slackN, 'higher Elo has no more slack');
  }
  log('difficultyFor mapping OK');

  log('ALL ' + passed + ' ASSERTIONS PASSED');
}

try {
  main();
  log('PASS');
  process.exit(0);
} catch (e) {
  console.error('[checkers-ai] FAIL:', e.message);
  process.exit(1);
}
