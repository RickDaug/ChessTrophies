/* checkers-ai.js — ChessTrophies computer opponent for the Checkers engine.
 *
 * Pure JS, no DOM. Operates only on a CT_Checkers game instance passed in.
 * Mirrors ct-ai.js: minimax + alpha-beta + iterative deepening + evaluate +
 * difficultyFor(aiElo) mapping + bounded weakening that NEVER hangs material.
 *
 * UMD-lite CLASSIC script (NO import/export): exposes global CT_CheckersAI and
 * also module.exports for the ESM server via createRequire.
 *
 *   CT_CheckersAI.chooseMove(game, aiElo) -> a legal move object (or null)
 *   CT_CheckersAI.evaluate(game)          -> white-positive static score
 *   CT_CheckersAI.difficultyFor(aiElo)    -> { depth, budget, noise, slackN, slackP }
 *
 * The engine (checkers.js) is the move source of truth: the AI only ever plays a
 * move returned by game.legalMoves(), so it can never make an illegal or
 * self-capturing move. Weak Elos play weaker via shallower search + slight slack
 * (occasionally the 2nd/3rd-best of a properly searched move set) — never via
 * random material-hanging blunders.
 */
(function () {
  'use strict';

  // Resolve the engine on whichever global is live (window/self) or via require.
  function _engine() {
    var g = (typeof window !== 'undefined') ? window : (typeof self !== 'undefined' ? self : null);
    if (g && g.CT_Checkers) return g.CT_Checkers;
    if (typeof require !== 'undefined') { try { return require('./checkers.js'); } catch (e) {} }
    return null;
  }

  // --- Evaluation weights ---------------------------------------------------
  // White-positive convention (matches ct-ai.js). King is worth much more; the
  // gap is larger on 10x10 / flying-king boards where kings dominate.
  var MAN = 100;
  function kingValue(size) { return size === 10 ? 320 : 175; }
  var WIN_SCORE = 1000000; // a side with no move loses; keep clear of material.

  // Evaluate the position from White's perspective. `ply` lets us prefer faster
  // wins (smaller ply) and slower losses, like ct-ai's mate-distance scoring.
  function evaluate(game, ply) {
    ply = ply || 0;
    // Terminal: side to move with no legal move loses.
    if (game.isGameOver()) {
      var w = game.winner();
      if (w === null) return 0; // draw
      var s = WIN_SCORE - ply;
      return w === 'w' ? s : -s;
    }
    var size = game.size, kv = kingValue(size);
    var board = game.b; // internal board (cheap; AI is trusted)
    var score = 0;
    var lastRowW = size - 1, lastRowB = 0; // home rows (back rank) per color
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
      var p = board[r][c];
      if (!p) continue;
      var sign = p.color === 'w' ? 1 : -1;
      var v = p.king ? kv : MAN;
      // Advancement toward promotion (men only): closer to the far rank = better.
      if (!p.king) {
        // distance traveled from own back rank (0..size-1)
        var adv = p.color === 'w' ? (size - 1 - r) : r;
        v += adv * (size === 10 ? 4 : 6);
      }
      // Center control: central columns/rows are worth a touch more.
      var center = centerBonus(size, r, c);
      v += center;
      // Back-rank integrity: a man still on its own back rank guards against the
      // opponent promoting there. Small bonus for keeping men home early.
      if (!p.king) {
        if (p.color === 'w' && r === lastRowW) v += 6;
        if (p.color === 'b' && r === lastRowB) v += 6;
      }
      // Edge men are slightly safer but less active; tiny edge bonus for safety.
      if (c === 0 || c === size - 1) v += 2;
      score += sign * v;
    }
    // Mobility + forced-capture advantage: being the side that can force captures
    // and having more moves is good. Evaluate from the side-to-move perspective,
    // then fold into white-positive.
    var toMove = game.turn();
    var myMoves = game.legalMovesRaw();
    var capCount = 0;
    for (var i = 0; i < myMoves.length; i++) capCount += myMoves[i].captures.length;
    var mobility = myMoves.length * 2 + capCount * 12; // forced captures worth more
    score += (toMove === 'w' ? 1 : -1) * mobility;
    return score;
  }

  function centerBonus(size, r, c) {
    var mid = (size - 1) / 2;
    var dr = Math.abs(r - mid), dc = Math.abs(c - mid);
    var d = dr + dc;
    // Closer to center -> bigger bonus (max ~12 at dead center, 0 at corners).
    var maxD = mid * 2;
    return Math.round((1 - d / maxD) * 8);
  }

  // --- Move ordering: captures first, longer captures first (MVV-ish) -------
  function orderMoves(moves) {
    return moves.slice().sort(function (a, b) {
      var ca = a.captures.length, cb = b.captures.length;
      if (ca !== cb) return cb - ca;
      // promotions next
      if (a.promotion !== b.promotion) return a.promotion ? -1 : 1;
      return 0;
    });
  }

  // --- Minimax with alpha-beta over checkers positions ----------------------
  // White maximizes, Black minimizes (white-positive eval). Returns the score.
  // `deadline` (absolute ms timestamp) lets a long iteration bail mid-search so a
  // single deep ply can never blow the overall time budget; the partial result is
  // discarded by chooseMove (it only keeps fully-completed iterations).
  var _deadline = Infinity;
  function timeUp() { return Date.now() > _deadline; }

  function minimax(game, depth, alpha, beta, ply) {
    if (game.isGameOver()) return evaluate(game, ply);
    if (depth <= 0) return quiescence(game, alpha, beta, ply, 0);
    if (timeUp()) return evaluate(game, ply); // bail; result is discarded upstream
    var maximizing = game.turn() === 'w';
    var moves = orderMoves(game.legalMovesRaw());
    var i, val;
    if (maximizing) {
      var best = -Infinity;
      for (i = 0; i < moves.length; i++) {
        var child = game.clone(); child.move(moves[i]);
        val = minimax(child, depth - 1, alpha, beta, ply + 1);
        if (val > best) best = val;
        if (val > alpha) alpha = val;
        if (beta <= alpha) break;
        if (timeUp()) break;
      }
      return best;
    }
    var bestn = Infinity;
    for (i = 0; i < moves.length; i++) {
      var ch = game.clone(); ch.move(moves[i]);
      val = minimax(ch, depth - 1, alpha, beta, ply + 1);
      if (val < bestn) bestn = val;
      if (val < beta) beta = val;
      if (beta <= alpha) break;
      if (timeUp()) break;
    }
    return bestn;
  }

  // Quiescence: extend through forced/available captures so we don't stop the
  // search mid-exchange (horizon effect). When the position has captures we keep
  // searching them; otherwise we stand pat on the static eval.
  function quiescence(game, alpha, beta, ply, qdepth) {
    if (game.isGameOver()) return evaluate(game, ply);
    var maximizing = game.turn() === 'w';
    var all = game.legalMovesRaw();
    var caps = [];
    for (var k = 0; k < all.length; k++) if (all[k].captures.length > 0) caps.push(all[k]);
    if (caps.length === 0 || qdepth > 8) return evaluate(game, ply);
    var standPat = evaluate(game, ply);
    if (maximizing) { if (standPat >= beta) return beta; if (standPat > alpha) alpha = standPat; }
    else { if (standPat <= alpha) return alpha; if (standPat < beta) beta = standPat; }
    caps = orderMoves(caps);
    for (var i = 0; i < caps.length; i++) {
      var child = game.clone(); child.move(caps[i]);
      var val = quiescence(child, alpha, beta, ply + 1, qdepth + 1);
      if (maximizing) { if (val >= beta) return beta; if (val > alpha) alpha = val; }
      else { if (val <= alpha) return alpha; if (val < beta) beta = val; }
    }
    return maximizing ? alpha : beta;
  }

  // --- Difficulty model (mirrors ct-ai difficultyFor) -----------------------
  //   depth  : full-width search depth
  //   budget : iterative-deepening time cap (ms)
  //   noise  : +/- score jitter (in centi-man units) per root move
  //   slackN : consider the top N scored moves as candidates
  //   slackP : probability of taking a non-best candidate when slackN > 1
  function difficultyFor(aiElo) {
    if (aiElo < 1000) return { depth: 2, budget: 400, noise: 60, slackN: 4, slackP: 0.55 };
    if (aiElo < 1400) return { depth: 4, budget: 600, noise: 35, slackN: 3, slackP: 0.40 };
    if (aiElo < 1700) return { depth: 6, budget: 800, noise: 18, slackN: 3, slackP: 0.25 };
    if (aiElo < 2000) return { depth: 8, budget: 1000, noise: 8,  slackN: 2, slackP: 0.12 };
    if (aiElo < 2300) return { depth: 10, budget: 1100, noise: 0, slackN: 1, slackP: 0 };
    return { depth: 12, budget: 1200, noise: 0, slackN: 1, slackP: 0 };
  }

  // Choose a move for the side to move, strength scaled by aiElo. Always returns
  // a LEGAL move (or null when there are none). Never hangs material via random
  // moves — weakening is shallower search + slight slack from a scored list.
  function chooseMove(game, aiElo) {
    aiElo = aiElo || 1200;
    var moves = game.legalMoves();
    if (moves.length === 0) return null;
    if (moves.length === 1) return moves[0]; // forced (common with mandatory capture)
    var cfg = difficultyFor(aiElo);
    var maximizing = game.turn() === 'w';
    var sign = maximizing ? 1 : -1;
    var start = Date.now();
    _deadline = start + cfg.budget; // hard wall: minimax bails past this

    // Mild root shuffle so identical positions don't always play the same line,
    // then order (captures first) for better alpha-beta pruning.
    var ordered = orderMoves(moves.slice().sort(function () { return Math.random() - 0.5; }));
    var bestMove = ordered[0];
    var lastScored = null;

    for (var depth = 1; depth <= cfg.depth; depth++) {
      if (Date.now() - start > cfg.budget) break;
      var scored = [];
      var aborted = false;
      // Full window per root move so every score is EXACT (the slack model below
      // ranks 2nd/3rd-best candidates and must not see fail-low bounds).
      for (var i = 0; i < ordered.length; i++) {
        var child = game.clone();
        child.move(ordered[i]);
        var val = minimax(child, depth - 1, -Infinity, Infinity, 1);
        scored.push({ move: ordered[i], val: val });
        if (Date.now() > _deadline) { aborted = true; break; }
      }
      if (aborted) break; // only adopt fully-completed iterations (partials discarded)
      lastScored = scored;
      scored.sort(function (a, b) { return sign * (b.val - a.val); });
      bestMove = scored[0].move;
      ordered = scored.map(function (s) { return s.move; }); // PV-first next iter
    }

    // Apply the difficulty weakening to the last completed iteration's scores.
    if (lastScored && (cfg.noise > 0 || cfg.slackN > 1)) {
      var jittered = lastScored.map(function (s) {
        var nz = cfg.noise > 0 ? (Math.random() * 2 - 1) * cfg.noise : 0;
        return { move: s.move, val: s.val + sign * nz };
      });
      jittered.sort(function (a, b) { return sign * (b.val - a.val); });
      var n = Math.min(cfg.slackN, jittered.length);
      if (n > 1 && Math.random() < cfg.slackP) {
        var pick = 1 + Math.floor(Math.random() * (n - 1));
        return jittered[pick].move; // a reasonable, non-best candidate (never random)
      }
      return jittered[0].move;
    }
    return bestMove;
  }

  var api = {
    chooseMove: chooseMove,
    evaluate: function (game) { return evaluate(game, 0); },
    difficultyFor: difficultyFor,
  };

  // --- Dual-environment export ----------------------------------------------
  var G = (typeof window !== 'undefined') ? window : (typeof self !== 'undefined' ? self : globalThis);
  G.CT_CheckersAI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
