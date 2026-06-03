/* ct-ai.js — ChessTrophies computer-opponent engine (extracted from app.js).
 *
 * Pure JS, MIT-licensable. Operates only on a chess.js instance passed in — no
 * DOM, no app state. Exposes:
 *   window.CT_AI.chooseMove(chess, aiElo) -> a verbose move object (or null)
 *
 * Piece-square tables are public domain (Tomasz Michniewski's "Simplified
 * Evaluation Function", chessprogramming.org).
 */
(function () {
  'use strict';
  var PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
  var PST = {
    p: [
        0,  0,  0,  0,  0,  0,  0,  0,
       50, 50, 50, 50, 50, 50, 50, 50,
       10, 10, 20, 30, 30, 20, 10, 10,
        5,  5, 10, 25, 25, 10,  5,  5,
        0,  0,  0, 20, 20,  0,  0,  0,
        5, -5,-10,  0,  0,-10, -5,  5,
        5, 10, 10,-20,-20, 10, 10,  5,
        0,  0,  0,  0,  0,  0,  0,  0,
    ],
    n: [
      -50,-40,-30,-30,-30,-30,-40,-50,
      -40,-20,  0,  0,  0,  0,-20,-40,
      -30,  0, 10, 15, 15, 10,  0,-30,
      -30,  5, 15, 20, 20, 15,  5,-30,
      -30,  0, 15, 20, 20, 15,  0,-30,
      -30,  5, 10, 15, 15, 10,  5,-30,
      -40,-20,  0,  5,  5,  0,-20,-40,
      -50,-40,-30,-30,-30,-30,-40,-50,
    ],
    b: [
      -20,-10,-10,-10,-10,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5, 10, 10,  5,  0,-10,
      -10,  5,  5, 10, 10,  5,  5,-10,
      -10,  0, 10, 10, 10, 10,  0,-10,
      -10, 10, 10, 10, 10, 10, 10,-10,
      -10,  5,  0,  0,  0,  0,  5,-10,
      -20,-10,-10,-10,-10,-10,-10,-20,
    ],
    r: [
        0,  0,  0,  0,  0,  0,  0,  0,
        5, 10, 10, 10, 10, 10, 10,  5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
        0,  0,  0,  5,  5,  0,  0,  0,
    ],
    q: [
      -20,-10,-10, -5, -5,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5,  5,  5,  5,  0,-10,
       -5,  0,  5,  5,  5,  5,  0, -5,
        0,  0,  5,  5,  5,  5,  0, -5,
      -10,  5,  5,  5,  5,  5,  0,-10,
      -10,  0,  5,  0,  0,  0,  0,-10,
      -20,-10,-10, -5, -5,-10,-10,-20,
    ],
    k: [
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20,
      -10,-20,-20,-20,-20,-20,-20,-10,
       20, 20,  0,  0,  0,  0, 20, 20,
       20, 30, 10,  0,  0, 10, 30, 20,
    ],
  };
  function evaluateBoard(chess) {
    if (chess.in_checkmate()) return chess.turn() === 'w' ? -99999 : 99999;
    if (chess.in_draw() || chess.in_stalemate() || chess.in_threefold_repetition() || chess.insufficient_material()) return 0;
    var score = 0;
    var board = chess.board();
    for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) {
      var p = board[r][f];
      if (!p) continue;
      var val = PIECE_VALUES[p.type];
      var idx = p.color === 'w' ? (r * 8 + f) : ((7 - r) * 8 + f);
      var psTable = PST[p.type];
      var bonus = psTable ? psTable[idx] : 0;
      score += (p.color === 'w' ? 1 : -1) * (val + bonus);
    }
    return score;
  }
  // MVV-LVA ordering: capture most-valuable victim with least-valuable attacker first.
  function moveScore(m) {
    if (!m.captured) return 0;
    return (PIECE_VALUES[m.captured] || 0) * 10 - (PIECE_VALUES[m.piece] || 0);
  }
  function orderMoves(moves) {
    return moves.slice().sort(function (a, b) { return moveScore(b) - moveScore(a); });
  }
  // Quiescence search: keep going through captures only until the position is quiet,
  // to avoid the horizon effect of stopping mid-exchange at the depth limit.
  function quiescence(chess, alpha, beta, ply) {
    if (ply > 6) return evaluateBoard(chess);
    var standPat = evaluateBoard(chess);
    var maximizing = chess.turn() === 'w';
    if (maximizing) { if (standPat >= beta) return beta; if (standPat > alpha) alpha = standPat; }
    else { if (standPat <= alpha) return alpha; if (standPat < beta) beta = standPat; }
    var captures = orderMoves(chess.moves({ verbose: true }).filter(function (m) { return m.captured; }));
    for (var i = 0; i < captures.length; i++) {
      chess.move(captures[i]);
      var val = quiescence(chess, alpha, beta, ply + 1);
      chess.undo();
      if (maximizing) { if (val >= beta) return beta; if (val > alpha) alpha = val; }
      else { if (val <= alpha) return alpha; if (val < beta) beta = val; }
    }
    return maximizing ? alpha : beta;
  }
  function minimax(chess, depth, alpha, beta, maximizing) {
    if (chess.game_over()) return evaluateBoard(chess);
    if (depth <= 0) return quiescence(chess, alpha, beta, 0);
    var moves = orderMoves(chess.moves({ verbose: true }));
    var best, i, val;
    if (maximizing) {
      best = -Infinity;
      for (i = 0; i < moves.length; i++) {
        chess.move(moves[i]); val = minimax(chess, depth - 1, alpha, beta, false); chess.undo();
        if (val > best) best = val;
        if (val > alpha) alpha = val;
        if (beta <= alpha) break;
      }
      return best;
    }
    best = Infinity;
    for (i = 0; i < moves.length; i++) {
      chess.move(moves[i]); val = minimax(chess, depth - 1, alpha, beta, true); chess.undo();
      if (val < best) best = val;
      if (val < beta) beta = val;
      if (beta <= alpha) break;
    }
    return best;
  }
  // Choose a move for the side to move in `chess`, strength scaled by `aiElo`.
  function chooseMove(chess, aiElo) {
    aiElo = aiElo || 1200;
    var moves = chess.moves({ verbose: true });
    if (moves.length === 0) return null;
    if (aiElo <= 1200) {
      var caps = moves.filter(function (m) { return m.captured; });
      if (caps.length && Math.random() < 0.45) return caps[Math.floor(Math.random() * caps.length)];
      return moves[Math.floor(Math.random() * moves.length)];
    }
    var lowElo = aiElo <= 1600;
    if (lowElo && Math.random() < 0.25) {
      var c2 = moves.filter(function (m) { return m.captured; });
      if (c2.length) return c2[Math.floor(Math.random() * c2.length)];
    }
    var turn = chess.turn();
    var maximizing = turn === 'w';
    var maxDepth = aiElo < 1600 ? 3 : aiElo < 2000 ? 4 : aiElo < 2300 ? 5 : 6;
    var timeBudget = aiElo < 1600 ? 800 : aiElo < 2000 ? 1600 : aiElo < 2300 ? 2600 : 3800;
    var start = Date.now();
    var ordered = orderMoves(moves.slice().sort(function () { return Math.random() - 0.5; }));
    var bestMove = ordered[0];
    for (var depth = 1; depth <= maxDepth; depth++) {
      if (Date.now() - start > timeBudget) break;
      var bestVal = maximizing ? -Infinity : Infinity;
      var depthBest = ordered[0];
      for (var i = 0; i < ordered.length; i++) {
        var m = ordered[i];
        chess.move(m);
        var val = minimax(chess, depth - 1, -Infinity, Infinity, !maximizing);
        chess.undo();
        if (maximizing ? val > bestVal : val < bestVal) { bestVal = val; depthBest = m; }
        if (Date.now() - start > timeBudget) break;
      }
      bestMove = depthBest;
      ordered = [depthBest].concat(ordered.filter(function (mm) { return mm !== depthBest; }));
    }
    return bestMove;
  }

  window.CT_AI = { chooseMove: chooseMove };
})();
