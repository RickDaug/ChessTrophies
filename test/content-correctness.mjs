#!/usr/bin/env node
/*
 * content-correctness.mjs — domain-correctness tests for the chess content fixed
 * in the "content correctness" workstream. Pure (no server). Exit 0 = PASS.
 *
 * Covers:
 *   1. AI rating labels are HONEST: ct-checkers.js aiNameForElo never claims
 *      "Grandmaster"/"Master"; ct-gauntlet.js ships no "Grandmaster X".
 *   2. The two re-themed academy puzzles (ct-PN03 pin, ct-RG04 hanging piece)
 *      have legal solution lines AND positions that genuinely match their theme.
 *   3. The corrected ECO codes (ruy-lopez C84, sicilian-open B92, qgd D63) are in
 *      place and every opening's main line is fully LEGAL through chess.min.js.
 *
 * Run:  node test/content-correctness.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const log = (...a) => console.log('[content]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

async function loadChess() {
  const mod = await import(pathToFileURL(path.join(ROOT, 'chess.min.js')).href);
  return mod.Chess;
}

// Load a browser IIFE module (window.* assignment) in a minimal sandbox and
// return the sandbox's window. Good enough for content modules whose top-level
// body only defines functions + assigns to window.
function loadBrowserModule(file) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const noop = () => {};
  const win = {};
  const doc = {
    getElementById: () => null,
    createElement: () => ({ classList: { add: noop, remove: noop }, appendChild: noop, setAttribute: noop, style: {} }),
    querySelector: () => null,
    addEventListener: noop,
  };
  win.document = doc;
  win.addEventListener = noop;
  win.location = { href: '' };
  const sandbox = { window: win, document: doc, self: win, globalThis: win, console, setTimeout: noop, clearTimeout: noop };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  return win;
}

// Replay a UCI line from a FEN; assert legality. Returns { mate, sansByPly }.
function replay(Chess, id, fen, moves) {
  const c = new Chess(fen);
  assert(c.fen().split(' ')[0] === fen.split(' ')[0], `${id}: FEN failed to load`);
  const solverColor = c.turn();
  let mate = false;
  const sans = [];
  for (let i = 0; i < moves.length; i++) {
    const u = moves[i];
    assert(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u), `${id}: malformed UCI "${u}"`);
    const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u.slice(4) : undefined });
    assert(mv, `${id}: ILLEGAL move "${u}" at ply ${i} (fen ${c.fen()})`);
    if (i % 2 === 0) assert(mv.color === solverColor, `${id}: solver move ${u} by wrong color`);
    sans.push(mv.san);
    mate = c.in_checkmate();
  }
  return { mate, sans, solverColor };
}

// ---------------------------------------------------------------------------
// 1 — Honest AI labels
// ---------------------------------------------------------------------------
function testLabels() {
  const checkers = fs.readFileSync(path.join(ROOT, 'ct-checkers.js'), 'utf8');
  const fnMatch = checkers.match(/function aiNameForElo\(e\)\s*\{[\s\S]*?\n\s*\}/);
  assert(fnMatch, 'could not find aiNameForElo in ct-checkers.js');
  // Only inspect the RETURN labels (ignore explanatory comments that may mention
  // the old names to document the rename).
  const returns = (fnMatch[0].match(/return\s+['"][^'"]+['"]/g) || []).join(' | ');
  assert(!/Grandmaster/.test(returns), 'ct-checkers aiNameForElo still RETURNS "Grandmaster"');
  assert(!/['"]Master['"]/.test(returns), 'ct-checkers aiNameForElo still RETURNS "Master"');
  const fn = returns;
  // The honest top tier should be Candidate Master / Expert.
  assert(/Candidate Master|Expert/.test(fn), 'ct-checkers aiNameForElo lost its honest top tier');
  log('1a OK — ct-checkers aiNameForElo claims no Grandmaster/Master ✓');

  const gauntlet = fs.readFileSync(path.join(ROOT, 'ct-gauntlet.js'), 'utf8');
  // The ROSTER blurbs/names must not literally claim "Grandmaster".
  assert(!/Grandmaster/.test(gauntlet), 'ct-gauntlet still ships a "Grandmaster" character');
  log('1b OK — ct-gauntlet roster claims no Grandmaster ✓');
}

// ---------------------------------------------------------------------------
// 2 — Re-themed academy puzzles
// ---------------------------------------------------------------------------
async function testPuzzles(Chess) {
  const { PUZZLE_SEED } = await import(pathToFileURL(path.join(ROOT, 'server', 'puzzle-seed.mjs')).href);
  const byId = Object.fromEntries(PUZZLE_SEED.map((p) => [p.id, p]));

  // ct-PN03 — must be a real PIN: with the solver to move switched off, the
  // pinned piece (the bishop) must have ZERO legal moves, and the FEN must NOT
  // be the old doubled-rook (king-off-the-file) position.
  const pn = byId['ct-PN03'];
  assert(pn, 'ct-PN03 missing');
  assert(pn.theme === 'pin', `ct-PN03 theme should be pin, got ${pn.theme}`);
  replay(Chess, pn.id, pn.fen, pn.moves); // legality
  // Find the pinned bishop square = the solver move's destination (we capture it).
  const target = pn.moves[0].slice(2, 4);
  // Flip side to move and confirm that piece is genuinely pinned (no legal move).
  const parts = pn.fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  const flipped = new Chess(parts.join(' '));
  const pinnedPiece = flipped.get(target);
  assert(pinnedPiece && pinnedPiece.type === 'b', `ct-PN03: expected a bishop on ${target} to pin`);
  const pinnedMoves = flipped.moves({ square: target, verbose: true });
  assert(pinnedMoves.length === 0, `ct-PN03: piece on ${target} is NOT pinned (has ${pinnedMoves.length} legal moves) — not a pin puzzle`);
  log(`2a OK — ct-PN03 is a genuine pin (${target} bishop has 0 legal moves) ✓`);

  // ct-RG04 — was a mislabeled "deflection"; now a hanging-piece capture. Assert
  // the theme is no longer "deflection", the line is legal, and the captured
  // piece really is UNDEFENDED (hanging) before the capture.
  const rg = byId['ct-RG04'];
  assert(rg, 'ct-RG04 missing');
  assert(rg.theme !== 'deflection', 'ct-RG04 still tagged deflection (it is a free capture, not a deflection)');
  replay(Chess, rg.id, rg.fen, rg.moves);
  const capSq = rg.moves[0].slice(2, 4);
  const board = new Chess(rg.fen);
  const victim = board.get(capSq);
  assert(victim, `ct-RG04: nothing to capture on ${capSq}`);
  // Undefended check: flip side to move; the victim's owner has no recapture of
  // the capture square (i.e. no defender). Easiest: after the solver captures,
  // the opponent cannot recapture on capSq.
  const after = new Chess(rg.fen);
  after.move({ from: rg.moves[0].slice(0, 2), to: capSq });
  const recaptures = after.moves({ verbose: true }).filter((m) => m.to === capSq && m.flags.indexOf('c') >= 0);
  assert(recaptures.length === 0, `ct-RG04: captured piece on ${capSq} was DEFENDED (${recaptures.length} recapture) — not a free/hanging piece`);
  log(`2b OK — ct-RG04 is a genuine hanging-piece win (${capSq} undefended) ✓`);

  // Whole seed still loads & every line legal (guards against a regression in the
  // two edits). Mirror puzzles.mjs Part A's legality+mate check.
  let n = 0;
  for (const p of PUZZLE_SEED) {
    const { mate } = replay(Chess, p.id, p.fen, p.moves);
    if (p.theme === 'mate') assert(mate, `${p.id}: theme=mate but line is not checkmate`);
    n++;
  }
  log(`2c OK — all ${n} seed puzzles still have fully legal solution lines ✓`);
}

// ---------------------------------------------------------------------------
// 3 — ECO codes + opening line legality
// ---------------------------------------------------------------------------
function testOpenings(Chess) {
  const win = loadBrowserModule('openings.js');
  const openings = win.CT_Openings && win.CT_Openings._openings;
  assert(Array.isArray(openings) && openings.length > 0, 'could not load openings via window.CT_Openings._openings');
  const byId = Object.fromEntries(openings.map((o) => [o.id, o]));

  const expectEco = { 'ruy-lopez': 'C84', 'sicilian-open': 'B92', 'qgd': 'D63' };
  for (const [id, eco] of Object.entries(expectEco)) {
    assert(byId[id], `opening ${id} missing`);
    assert(byId[id].eco === eco, `opening ${id} ECO should be ${eco}, got ${byId[id].eco}`);
  }
  log(`3a OK — corrected ECO codes in place (ruy-lopez C84, sicilian-open B92, qgd D63) ✓`);

  // The untouched codes must stay as documented.
  const keep = { italian: 'C50', london: 'D02', french: 'C11', 'caro-kann': 'B19' };
  for (const [id, eco] of Object.entries(keep)) {
    assert(byId[id] && byId[id].eco === eco, `opening ${id} ECO should remain ${eco}, got ${byId[id] && byId[id].eco}`);
  }
  log('3b OK — already-correct ECO codes left untouched ✓');

  // Every opening's full SAN main line is legal from the start position.
  for (const o of openings) {
    const c = new Chess();
    for (let i = 0; i < o.line.length; i++) {
      const mv = c.move(o.line[i], { sloppy: true });
      assert(mv, `${o.id}: ILLEGAL book move "${o.line[i]}" at ply ${i}`);
    }
  }
  log(`3c OK — all ${openings.length} opening main lines are fully legal ✓`);
}

async function main() {
  const Chess = await loadChess();
  testLabels();
  await testPuzzles(Chess);
  testOpenings(Chess);
  log('PASS — content correctness: honest labels, themed puzzles legal+matching, ECO codes accurate, all lines legal');
  return 0;
}
main().then((c) => process.exit(c ?? 0)).catch((e) => { console.error('[content] FAIL:', e.message); process.exit(1); });
