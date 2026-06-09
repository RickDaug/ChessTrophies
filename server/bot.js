// server/bot.js — server-side chess engine wrapper for RANKED bot-backfill.
//
// Loads the SAME engine the client uses (chess.min.js + ct-ai.js) into this node
// process, the way test/endgame.mjs does: require chess.min.js (CommonJS export),
// expose globalThis.Chess, then evaluate ct-ai.js in this realm so it installs
// globalThis.CT_AI (it takes the no-Worker, head-less branch because
// `typeof window === 'undefined'`). The engine is then driven server-side to pick
// the bot's reply to each human move.
//
// botMove(fen, targetElo) -> the bot's chosen move {from,to[,promotion]} (or null).
// NEVER throws — every failure path returns null so the caller can decide what to
// do (we simply don't move on null, which is safe: it's never the bot's turn-loss).
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// repo ROOT is one level up from server/ in dev; in the Docker image the assets
// are copied next to the server files. Try both layouts (mirrors game.js).
const CANDIDATE_DIRS = [path.resolve(__dirname, '..'), __dirname];

let CT_AI = null;
let ChessCtor = null;

function tryLoad() {
  if (CT_AI && ChessCtor) return true;
  for (const dir of CANDIDATE_DIRS) {
    const chessPath = path.join(dir, 'chess.min.js');
    const aiPath = path.join(dir, 'ct-ai.js');
    try {
      if (!fs.existsSync(chessPath) || !fs.existsSync(aiPath)) continue;
      const Chess = _require(chessPath).Chess;
      if (!Chess) continue;
      globalThis.Chess = Chess;       // ct-ai.js + its _ChessCtor() read this
      const aiSrc = fs.readFileSync(aiPath, 'utf8');
      // Evaluate in this realm (indirect eval) so it installs globalThis.CT_AI.
      (0, eval)(aiSrc);
      if (globalThis.CT_AI && typeof globalThis.CT_AI.chooseMove === 'function') {
        CT_AI = globalThis.CT_AI;
        ChessCtor = Chess;
        return true;
      }
    } catch (e) {
      console.error('[bot] engine load attempt failed:', e && e.message);
    }
  }
  return false;
}

// Try once at import so a load failure is visible in the boot logs (non-fatal).
if (!tryLoad()) {
  console.error('[bot] chess engine (chess.min.js + ct-ai.js) not found — ranked bot-backfill disabled');
}

// Is the server-side engine available? Used by game.js to decide whether to offer
// bot-backfill at all (if the engine couldn't load, we never queue a bot game).
export function botEngineReady() {
  return !!(CT_AI && ChessCtor);
}

// Compute the bot's move for `fen`, played at roughly `targetElo` strength.
// Prefers CT_AI.bestMoveForElo(fen, targetElo) (a strength-calibrated entry point
// a parallel agent is adding); if that's absent at runtime, falls back to the
// existing CT_AI.bestMove / CT_AI.chooseMove at a difficulty derived from the
// target Elo. Returns {from,to,promotion?} or null. Never throws.
export async function botMove(fen, targetElo) {
  try {
    if (!tryLoad()) return null;
    const elo = Number.isFinite(targetElo) ? targetElo : 1200;

    // 1) Preferred: strength-calibrated API (added in parallel). It may be sync or
    //    return a promise; await tolerates both. Accept either a verbose move or a
    //    { move } wrapper.
    if (typeof CT_AI.bestMoveForElo === 'function') {
      try {
        const r = await CT_AI.bestMoveForElo(fen, elo);
        const mv = normalizeMove(r);
        if (mv) return mv;
      } catch (e) { /* fall through to the legacy paths */ }
    }

    // 2) Fallback: drive the engine ourselves at a sensible difficulty.
    const chess = new ChessCtor(fen);
    if (typeof chess.game_over === 'function' ? chess.game_over() : false) return null;

    // chooseMove(chess, aiElo) returns a verbose move scaled by Elo.
    if (typeof CT_AI.chooseMove === 'function') {
      const r = CT_AI.chooseMove(chess, elo);
      const mv = normalizeMove(r);
      if (mv) return mv;
    }

    // 3) Last resort: bestMove(fen, depth) -> { move }. Map Elo to a small depth.
    if (typeof CT_AI.bestMove === 'function') {
      const depth = elo >= 1800 ? 3 : elo >= 1400 ? 2 : 2;
      const r = CT_AI.bestMove(fen, depth);
      const mv = normalizeMove(r);
      if (mv) return mv;
    }

    return null;
  } catch (e) {
    console.error('[bot] botMove failed:', e && e.message);
    return null;
  }
}

// Accept the various shapes the engine entry points can return and reduce to the
// minimal { from, to, promotion? } the server-authoritative move loop needs.
function normalizeMove(r) {
  if (!r) return null;
  // bestMove() returns { move, scoreWhite }; chooseMove() returns the move directly.
  const m = (r && r.move && typeof r.move === 'object') ? r.move : r;
  if (!m || typeof m.from !== 'string' || typeof m.to !== 'string') return null;
  const out = { from: m.from, to: m.to };
  if (m.promotion) out.promotion = m.promotion;
  return out;
}
