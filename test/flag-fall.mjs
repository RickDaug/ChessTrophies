#!/usr/bin/env node
/*
 * flag-fall.mjs — timeout (flag-fall) scoring per FIDE 6.9 (audit DOMAIN-M4 + QA-M4).
 *
 * The clock flag-fall WIN/draw decision was untested, and the rule it used only
 * inspected the WINNER's material — so K+B vs K+pawns was wrongly drawn (a helpmate
 * exists, so it's a WIN on time). The decision is now a pure module
 * (server/timeout-rules.js, wired into game.js's timeoutFinishGame/TeamGame); this
 * test exercises it directly across the material combinations that matter.
 *
 * No chess.js needed — winnerCanMateOnTimeout only consumes chess.board(), so we
 * synthesize that 8x8 shape straight from a FEN.
 *
 * Run:  node test/flag-fall.mjs   (exit 0 = PASS, 1 = FAIL)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[flag-fall]', ...a);
let failed = 0;
const check = (cond, msg) => { if (cond) log('✓', msg); else { failed++; console.error('✗ FAIL:', msg); } };

// Build chess.js's board() shape (rank 8 first; null | {type,color}) from a FEN.
function fenBoard(fen) {
  return fen.split(' ')[0].split('/').map((rank) => {
    const out = [];
    for (const ch of rank) {
      if (/[1-8]/.test(ch)) { for (let i = 0; i < Number(ch); i++) out.push(null); }
      else out.push({ type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' });
    }
    return out;
  });
}
const pos = (fen) => ({ board: () => fenBoard(fen) });

const { winnerCanMateOnTimeout } = await import(new URL(`file://${path.join(SERVER_DIR, 'timeout-rules.js').replace(/\\/g, '/')}`).href);
const canMate = (fen, winner) => winnerCanMateOnTimeout(pos(fen), winner);

// --- Cases (winner = the side that did NOT flag) ----------------------------
// true  = the flag STANDS (win on time);  false = downgraded to a DRAW.

// Sufficient material -> win stands.
check(canMate('7k/8/8/8/8/8/4K3/R7 w', 'w') === true,  'K+R vs K -> winner can mate (win)');
check(canMate('7k/8/8/8/8/8/4K3/Q7 w', 'w') === true,  'K+Q vs K -> win');
check(canMate('7k/8/8/8/8/4P3/4K3/8 w', 'w') === true, 'K+P vs K -> win (pawn can promote+mate)');
check(canMate('7k/8/8/8/8/8/3BKB2/8 w', 'w') === true, 'K+2B vs K -> win (two minors)');

// Insufficient -> draw.
check(canMate('7k/8/8/8/8/8/4K3/8 w', 'w') === false, 'K vs K -> draw (lone king)');
check(canMate('7k/8/8/8/8/8/4KB2/8 w', 'w') === false, 'K+B vs bare K -> draw (single minor, no helpmate)');
check(canMate('7k/8/8/8/8/8/4KN2/8 w', 'w') === false, 'K+N vs bare K -> draw');

// THE M4 FIX: a single minor CAN help-mate once the flagged side keeps material.
check(canMate('7k/8/8/8/8/5p2/4KB2/8 w', 'w') === true, 'K+B vs K+pawn -> WIN (helpmate exists) [M4]');
check(canMate('4n2k/8/8/8/8/8/4KN2/8 w', 'w') === true, 'K+N vs K+N -> win (loser has material -> helpmate)');

// Symmetry: works when BLACK is the side that didn't flag.
check(canMate('K7/r6k/8/8/8/8/8/8 w', 'b') === true,  'black K+R vs white K -> black can mate');
check(canMate('K6k/8/8/8/8/8/8/8 w', 'b') === false,  'black lone K -> draw');
check(canMate('K6k/8/8/8/8/8/8/1b6 w', 'b') === false, 'black K+B vs white bare K -> draw');
check(canMate('K6k/7P/8/8/8/8/8/1b6 w', 'b') === true, 'black K+B vs white K+pawn -> WIN (helpmate) [M4]');

if (failed) { console.error(`[flag-fall] FAIL — ${failed} case(s) wrong`); process.exit(1); }
log('PASS — flag-fall scoring matches FIDE 6.9 (both-sides material, helpmate-aware)');
