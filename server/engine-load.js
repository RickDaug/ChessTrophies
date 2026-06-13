// server/engine-load.js — shared loader for the head-less chess engine
// (chess.min.js + ct-ai.js). Used by BOTH bot.js (in-process readiness signal +
// last-resort fallback) and bot-worker.js (the worker-thread compute path), so
// the load logic lives in exactly one place. loadEngine() installs
// globalThis.Chess / globalThis.CT_AI in the CURRENT realm and returns refs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// repo ROOT is one level up from server/ in dev; in the Docker image the engine
// assets are copied next to the server files at /app. Try both layouts.
const CANDIDATE_DIRS = [path.resolve(__dirname, '..'), __dirname];

export function loadEngine() {
  const diag = { dirname: __dirname, checked: [], error: null, loaded: false };
  // Also probe /app/public (where the Dockerfile copies the CLIENT bundle) so a
  // misplacement reads as "wrong dir" rather than "missing".
  const probeDirs = [...CANDIDATE_DIRS, path.join(__dirname, 'public')];
  for (const dir of probeDirs) {
    const chessPath = path.join(dir, 'chess.min.js');
    const aiPath = path.join(dir, 'ct-ai.js');
    const rec = { dir, chess: fs.existsSync(chessPath), ai: fs.existsSync(aiPath) };
    diag.checked.push(rec);
    if (CANDIDATE_DIRS.indexOf(dir) === -1) continue; // public is probe-only
    try {
      if (!rec.chess || !rec.ai) continue;
      // chess.min.js is a UMD. Evaluate it through a CommonJS shim so its
      // `exports.Chess =` branch is taken regardless of the surrounding package
      // "type" or Node version (require(ESM) would drop the named export).
      const chessSrc = fs.readFileSync(chessPath, 'utf8');
      const _m = { exports: {} };
      (new Function('module', 'exports', 'require', chessSrc))(_m, _m.exports, _require);
      const Chess = _m.exports.Chess || (typeof _m.exports === 'function' ? _m.exports : null);
      if (!Chess) { diag.error = 'chess.min.js loaded but no Chess constructor'; continue; }
      globalThis.Chess = Chess;            // ct-ai.js's _ChessCtor() reads this
      const aiSrc = fs.readFileSync(aiPath, 'utf8');
      (0, eval)(aiSrc);                     // installs globalThis.CT_AI (head-less branch)
      if (globalThis.CT_AI && typeof globalThis.CT_AI.chooseMove === 'function') {
        diag.loaded = true;
        return { CT_AI: globalThis.CT_AI, ChessCtor: Chess, diag };
      }
      diag.error = 'ct-ai.js evaluated but globalThis.CT_AI.chooseMove missing';
    } catch (e) { diag.error = (e && e.message) || String(e); }
  }
  return { CT_AI: null, ChessCtor: null, diag };
}

// Reduce the engine's various return shapes to the minimal { from, to, promotion? }
// the server-authoritative move loop needs.
export function normalizeMove(r) {
  if (!r) return null;
  const m = (r && r.move && typeof r.move === 'object') ? r.move : r;
  if (!m || typeof m.from !== 'string' || typeof m.to !== 'string') return null;
  const out = { from: m.from, to: m.to };
  if (m.promotion) out.promotion = m.promotion;
  return out;
}

// Compute the bot's move for `fen` at ~targetElo strength. Pure CPU (this is the
// alpha-beta search). Returns { from, to, promotion? } or null. NEVER throws.
export function computeMove(CT_AI, ChessCtor, fen, targetElo) {
  try {
    if (!CT_AI || !ChessCtor) return null;
    const elo = Number.isFinite(targetElo) ? targetElo : 1200;
    // Preferred: strength-calibrated entry point (sync in the head-less path).
    if (typeof CT_AI.bestMoveForElo === 'function') {
      const mv = normalizeMove(CT_AI.bestMoveForElo(fen, elo));
      if (mv) return mv;
    }
    const chess = new ChessCtor(fen);
    if (typeof chess.game_over === 'function' ? chess.game_over() : false) return null;
    if (typeof CT_AI.chooseMove === 'function') {
      const mv = normalizeMove(CT_AI.chooseMove(chess, elo));
      if (mv) return mv;
    }
    if (typeof CT_AI.bestMove === 'function') {
      const depth = elo >= 1800 ? 3 : 2;
      const mv = normalizeMove(CT_AI.bestMove(fen, depth));
      if (mv) return mv;
    }
    return null;
  } catch { return null; }
}
