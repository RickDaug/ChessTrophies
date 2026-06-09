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
  // Endgame king PST — rewards CENTRALISATION (and penalises the corners/edges)
  // instead of the middlegame table's back-rank hugging. In the endgame the king
  // is a fighting piece, so we want it marching to the centre. We taper between
  // this and PST.k by the game phase so normal middlegames are unaffected.
  var KING_EG_PST = [
    -50,-30,-30,-30,-30,-30,-30,-50,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50,
  ];
  // "Distance from the centre" of each square (Manhattan-style, 0 at the four
  // central squares, 6 at a corner). Used to drive the LOSING king to the edge/
  // corner for K+Q / K+R mates — the bigger this is for the lone king, the more
  // cornered it is, which is what the mating side wants.
  var EDGE_DISTANCE = [
    6, 5, 4, 3, 3, 4, 5, 6,
    5, 4, 3, 2, 2, 3, 4, 5,
    4, 3, 2, 1, 1, 2, 3, 4,
    3, 2, 1, 0, 0, 1, 2, 3,
    3, 2, 1, 0, 0, 1, 2, 3,
    4, 3, 2, 1, 1, 2, 3, 4,
    5, 4, 3, 2, 2, 3, 4, 5,
    6, 5, 4, 3, 3, 4, 5, 6,
  ];
  // Non-pawn phase weights: total over a full opening army is 24 (queens 4 each,
  // rooks 2, minors 1) — the standard "phase" granularity. We derive a 0..256
  // taper where 256 = full middlegame, 0 = bare-king endgame.
  var PHASE_WEIGHT = { n: 1, b: 1, r: 2, q: 4, p: 0, k: 0 };
  var PHASE_TOTAL = 24; // 2*(4) queens + 4*(2) rooks + 8*(1) minors
  // Mate scores are kept well clear of any plausible material eval so alpha-beta
  // never confuses a big material swing for a mate. MATE_BASE - ply makes the
  // engine prefer faster mates (smaller ply) and, when losing, slower ones.
  var MATE_BASE = 1000000;
  function evaluateBoard(chess, ply) {
    ply = ply || 0;
    // Side to move is mated -> bad for side to move. White-positive convention:
    // a white-to-move mate is -, a black-to-move mate is +.
    if (chess.in_checkmate()) {
      var mate = MATE_BASE - ply;
      return chess.turn() === 'w' ? -mate : mate;
    }
    if (chess.in_draw() || chess.in_stalemate() || chess.in_threefold_repetition() || chess.insufficient_material()) return 0;
    var score = 0;
    var board = chess.board();
    // --- First pass: material + non-king PSTs, plus the data the endgame king
    // evaluation needs (phase score, both king squares, per-side material). ---
    var phase = 0;                 // 0..PHASE_TOTAL of remaining non-pawn material
    var wKi = -1, bKi = -1;        // king board indices (r*8+f)
    var wNonPawn = 0, bNonPawn = 0;// non-pawn, non-king material per side (cp)
    var wHeavy = 0, bHeavy = 0;    // queen+rook material per side (the "mating" force)
    for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) {
      var p = board[r][f];
      if (!p) continue;
      var val = PIECE_VALUES[p.type];
      phase += PHASE_WEIGHT[p.type] || 0;
      if (p.type === 'k') {
        if (p.color === 'w') wKi = r * 8 + f; else bKi = r * 8 + f;
      } else if (p.type !== 'p') {
        if (p.color === 'w') wNonPawn += val; else bNonPawn += val;
        if (p.type === 'q' || p.type === 'r') { if (p.color === 'w') wHeavy += val; else bHeavy += val; }
      }
      var idx = p.color === 'w' ? (r * 8 + f) : ((7 - r) * 8 + f);
      if (p.type === 'k') {
        // King PST is tapered by phase below; skip it here and add it after.
        score += (p.color === 'w' ? 1 : -1) * val;
      } else {
        var psTable = PST[p.type];
        var bonus = psTable ? psTable[idx] : 0;
        score += (p.color === 'w' ? 1 : -1) * (val + bonus);
      }
    }
    // --- Tapered king PST: blend the middlegame (back-rank) table with the
    // endgame (centralisation) table by how much material is left. eg = 1 at a
    // bare-king endgame, 0 in a full middlegame. ---
    var eg = 1 - Math.min(phase, PHASE_TOTAL) / PHASE_TOTAL; // 0 (mid) .. 1 (end)
    if (wKi >= 0) {
      var wIdx = wKi; // white reads the table directly
      var wKpst = PST.k[wIdx] * (1 - eg) + KING_EG_PST[wIdx] * eg;
      score += wKpst;
    }
    if (bKi >= 0) {
      var bFlip = ((7 - (bKi >> 3)) * 8) + (bKi & 7); // mirror rank for black
      var bKpst = PST.k[bFlip] * (1 - eg) + KING_EG_PST[bFlip] * eg;
      score -= bKpst;
    }
    // --- Mate-driving term for won K+heavy-vs-lone-king endgames. Only kicks in
    // once we're well into the endgame AND one side is essentially just a lone
    // king while the other has a queen or rook. Then: drive the LOSING king to
    // the edge/corner (reward its EDGE_DISTANCE) and bring the winning king
    // CLOSER (kings adjacent = the box tightens). This is the classic corner-
    // distance + king-proximity (`cmd`) mate heuristic that lets an otherwise
    // material-only engine actually deliver K+Q-vs-K and K+R-vs-K. ---
    if (eg > 0.6 && wKi >= 0 && bKi >= 0) {
      // Winner = the side with heavy material whose opponent has none.
      var winner = 0; // +1 white winning, -1 black winning, 0 neither
      if (wHeavy > 0 && bNonPawn === 0) winner = 1;
      else if (bHeavy > 0 && wNonPawn === 0) winner = -1;
      if (winner !== 0) {
        var loserKi = winner === 1 ? bKi : wKi;
        var winnerKi = winner === 1 ? wKi : bKi;
        // Push the loser to the edge/corner: EDGE_DISTANCE is 0 in the centre and
        // 6 in a corner, so rewarding the loser king's edge-distance corners it.
        var cornerDrive = EDGE_DISTANCE[loserKi]; // 0 centre .. 6 corner
        // King proximity: closer winning king = tighter box. kingDist 1..7.
        var df = Math.abs((loserKi >> 3) - (winnerKi >> 3));
        var dr = Math.abs((loserKi & 7) - (winnerKi & 7));
        var kingDist = Math.max(df, dr); // Chebyshev, 1 (adjacent) .. 7
        // Weighted so this term is decisive vs. shuffling but small vs. material.
        var mateTerm = cornerDrive * 16 + (7 - kingDist) * 10;
        score += winner * mateTerm;
      }
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
  // `ply` is the absolute distance from the root, used both for the depth cap and
  // for mate-distance scoring. `qdepth` counts only quiescence plies for the cap.
  function quiescence(chess, alpha, beta, ply, qdepth) {
    if (chess.game_over()) return evaluateBoard(chess, ply);
    var maximizing = chess.turn() === 'w';
    var inCheck = chess.in_check();
    var moves;
    if (inCheck) {
      // Do NOT stand pat while in check: a static eval here is meaningless because
      // the king is under attack. Search ALL legal moves (check evasions) instead
      // of captures only, so we don't miss a quiet escape and misjudge the node.
      if (qdepth > 8) return evaluateBoard(chess, ply); // cap to avoid blowups
      moves = orderMoves(chess.moves({ verbose: true }));
    } else {
      if (qdepth > 6) return evaluateBoard(chess, ply);
      var standPat = evaluateBoard(chess, ply);
      if (maximizing) { if (standPat >= beta) return beta; if (standPat > alpha) alpha = standPat; }
      else { if (standPat <= alpha) return alpha; if (standPat < beta) beta = standPat; }
      moves = orderMoves(chess.moves({ verbose: true }).filter(function (m) { return m.captured; }));
    }
    for (var i = 0; i < moves.length; i++) {
      chess.move(moves[i]);
      var val = quiescence(chess, alpha, beta, ply + 1, qdepth + 1);
      chess.undo();
      if (maximizing) { if (val >= beta) return beta; if (val > alpha) alpha = val; }
      else { if (val <= alpha) return alpha; if (val < beta) beta = val; }
    }
    return maximizing ? alpha : beta;
  }
  function minimax(chess, depth, alpha, beta, maximizing, ply) {
    ply = ply || 0;
    if (chess.game_over()) return evaluateBoard(chess, ply);
    if (depth <= 0) return quiescence(chess, alpha, beta, ply, 0);
    var moves = orderMoves(chess.moves({ verbose: true }));
    var best, i, val;
    if (maximizing) {
      best = -Infinity;
      for (i = 0; i < moves.length; i++) {
        chess.move(moves[i]); val = minimax(chess, depth - 1, alpha, beta, false, ply + 1); chess.undo();
        if (val > best) best = val;
        if (val > alpha) alpha = val;
        if (beta <= alpha) break;
      }
      return best;
    }
    best = Infinity;
    for (i = 0; i < moves.length; i++) {
      chess.move(moves[i]); val = minimax(chess, depth - 1, alpha, beta, true, ply + 1); chess.undo();
      if (val < best) best = val;
      if (val < beta) beta = val;
      if (beta <= alpha) break;
    }
    return best;
  }
  // Difficulty model (DX-5). Each ELO band maps to a search depth, a time budget,
  // a small amount of evaluation noise (centipawns) and a "slack" — the chance of
  // picking a slightly inferior but still REASONABLE move from the ordered list
  // instead of the very best. Crucially we never play a random/hanging move: weak
  // levels lose by choosing the 2nd/3rd-best of a properly searched move set and
  // by a few centipawns of jitter, not by blundering material.
  //   depth   : how deep the full-width search goes
  //   budget  : iterative-deepening time cap (ms)
  //   noise   : +/- centipawns of uniform jitter added per root move's score
  //   slackN  : consider the top N scored moves as candidates
  //   slackP  : probability of taking a non-best candidate when slackN > 1
  function difficultyFor(aiElo) {
    if (aiElo < 1000) return { depth: 2, budget: 500, noise: 70, slackN: 4, slackP: 0.55 };
    if (aiElo < 1400) return { depth: 3, budget: 800, noise: 40, slackN: 3, slackP: 0.40 };
    if (aiElo < 1700) return { depth: 3, budget: 1200, noise: 22, slackN: 3, slackP: 0.25 };
    if (aiElo < 2000) return { depth: 4, budget: 1600, noise: 10, slackN: 2, slackP: 0.12 };
    if (aiElo < 2300) return { depth: 5, budget: 2600, noise: 0, slackN: 1, slackP: 0 };
    return { depth: 6, budget: 3800, noise: 0, slackN: 1, slackP: 0 };
  }

  // Resolve the CT_960Castle API on whichever global is live (window or worker
  // self). Returns null when chess960.js isn't loaded — callers must tolerate it.
  function _castleApi() {
    var g = (typeof window !== 'undefined') ? window : (typeof self !== 'undefined' ? self : null);
    return (g && g.CT_960Castle) ? g.CT_960Castle : null;
  }

  // For a 960 castle descriptor, build the position that RESULTS from playing it
  // (FEN surgery via applyCastleDescriptor on a throwaway clone) so the existing
  // minimax can score it exactly like any normal child node.
  function _fenAfterCastle(fen, desc) {
    try {
      var clone = new (_ChessCtor())(fen);
      _castleApi().applyCastleDescriptor(clone, desc);
      return clone.fen();
    } catch (e) { return null; }
  }

  // Choose a move for the side to move in `chess`, strength scaled by `aiElo`.
  // `startFen960` (optional) enables real Chess960 castling: when supplied AND
  // chess960.js is loaded, legal 960 castles are added to the ROOT candidate set
  // and scored against the normal moves. When it is undefined the function takes
  // the byte-for-byte original standard-chess path (no castle augmentation).
  function chooseMove(chess, aiElo, startFen960) {
    aiElo = aiElo || 1200;
    var moves = chess.moves({ verbose: true });
    // 960 castle candidates (only when a 960 start FEN is supplied AND the
    // castling helper is present). These are descriptor objects, not chess.js
    // moves — they are scored by FEN surgery, never by chess.move()/undo().
    var castleDescs = [];
    var castleApi = startFen960 ? _castleApi() : null;
    if (castleApi) {
      try { castleDescs = castleApi.legalCastlingMoves(chess, startFen960) || []; }
      catch (e) { castleDescs = []; }
      // Tag each descriptor so a chosen castle is recognisable downstream and add
      // from/to (the king's hop) so it mirrors a verbose chess.js move's shape.
      castleDescs.forEach(function (d) { d.castle = true; d.from = d.kingFrom; d.to = d.kingTo; d.piece = 'k'; });
    }
    if (moves.length === 0 && castleDescs.length === 0) return null;
    var cfg = difficultyFor(aiElo);
    var turn = chess.turn();
    var maximizing = turn === 'w';
    var sign = maximizing ? 1 : -1;
    var start = Date.now();
    var rootFen = chess.fen();
    // Score a single 960 castle descriptor at the given search depth by searching
    // the resulting position. Returns the white-positive minimax value, or null
    // if the castle can't be applied (defensive — then it's simply dropped).
    function scoreCastle(desc, depth) {
      var afterFen = _fenAfterCastle(rootFen, desc);
      if (!afterFen) return null;
      try {
        var c = new (_ChessCtor())(afterFen);
        // After the castle it's the opponent to move; search one ply shallower
        // (the castle itself is the root ply) exactly as a normal child would be.
        return minimax(c, depth - 1, -Infinity, Infinity, !maximizing, 1);
      } catch (e) { return null; }
    }
    // Mild root randomisation so identical positions don't always play the same line.
    var ordered = orderMoves(moves.slice().sort(function () { return Math.random() - 0.5; }));
    var bestMove = ordered[0] || (castleDescs.length ? castleDescs[0] : null);
    var lastScored = null; // scores from the last FULLY-completed iteration
    for (var depth = 1; depth <= cfg.depth; depth++) {
      if (Date.now() - start > cfg.budget) break;
      var scored = [];
      var aborted = false;
      // Full window at the root for every move so each score is EXACT — the
      // difficulty model below ranks 2nd/3rd-best candidates by these scores, so
      // we must not let alpha-beta return mere fail-low bounds for non-PV moves.
      for (var i = 0; i < ordered.length; i++) {
        var m = ordered[i];
        chess.move(m);
        var val = minimax(chess, depth - 1, -Infinity, Infinity, !maximizing, 1);
        chess.undo();
        scored.push({ move: m, val: val });
        if (Date.now() - start > cfg.budget) { aborted = true; break; }
      }
      // 960 castle candidates: scored by FEN surgery (never chess.move). Kept in
      // the same `scored` list so they compete with normal moves on equal terms.
      // A descriptor that can't be applied returns null and is dropped.
      for (var ci = 0; ci < castleDescs.length && !aborted; ci++) {
        var cval = scoreCastle(castleDescs[ci], depth);
        if (cval !== null) scored.push({ move: castleDescs[ci], val: cval, castle: true });
        if (Date.now() - start > cfg.budget) { aborted = true; break; }
      }
      // DX-11: only adopt results from a fully-completed iteration. A partial
      // depth has only scored a prefix of moves and may pick a worse move than
      // the previous complete depth, so discard it.
      if (aborted) break;
      lastScored = scored;
      // Reorder so the best move is searched first next iteration (PV move).
      scored.sort(function (a, b) { return sign * (b.val - a.val); });
      bestMove = scored[0].move;
      // Re-seed `ordered` with normal moves only (castles are regenerated each
      // iteration via scoreCastle); descriptors must never reach chess.move().
      ordered = scored.filter(function (s) { return !s.castle; }).map(function (s) { return s.move; });
    }
    // Never slack/jitter away a forced mate: if the best fully-searched move wins
    // by a mate score (in OUR favour), play it straight. This keeps even the
    // weakened levels from dawdling once a forced mate is on the board (so Hard
    // and up reliably convert K+Q / K+R), without affecting normal play.
    if (lastScored && lastScored.length) {
      var topVal = -Infinity * sign; // worst for us
      var topMove = null;
      for (var ti = 0; ti < lastScored.length; ti++) {
        if (sign * lastScored[ti].val > sign * topVal) { topVal = lastScored[ti].val; topMove = lastScored[ti].move; }
      }
      if (topMove && sign * topVal >= (MATE_BASE - 1000)) return topMove;
    }
    // Apply the difficulty weakening to the best fully-completed iteration's scores.
    if (lastScored && (cfg.noise > 0 || cfg.slackN > 1)) {
      var jittered = lastScored.map(function (s) {
        var n = cfg.noise > 0 ? (Math.random() * 2 - 1) * cfg.noise : 0;
        return { move: s.move, val: s.val + sign * n };
      });
      jittered.sort(function (a, b) { return sign * (b.val - a.val); });
      var n = Math.min(cfg.slackN, jittered.length);
      if (n > 1 && Math.random() < cfg.slackP) {
        // Pick a reasonable, non-best candidate (2nd..Nth) — never a random move.
        var pick = 1 + Math.floor(Math.random() * (n - 1));
        return jittered[pick].move;
      }
      return jittered[0].move;
    }
    return bestMove;
  }

  // --- Analysis helpers (used by Game Review: eval bar + blunder detection) ---
  // Resolve the live global on the main thread (window), inside a Worker (self),
  // or under Node (globalThis) so the engine is testable head-less.
  function _g() {
    if (typeof window !== 'undefined') return window;
    if (typeof self !== 'undefined') return self;
    if (typeof globalThis !== 'undefined') return globalThis;
    return this;
  }
  function _ChessCtor() { return _g().Chess; }

  // White-positive evaluation of a position, searching `depth` plies (0 = static
  // eval + quiescence). Checkmate is ~±99999. Never throws.
  function evaluatePosition(fen, depth) {
    try {
      var c = new (_ChessCtor())(fen);
      return minimax(c, Math.max(0, depth | 0), -Infinity, Infinity, c.turn() === 'w', 0);
    } catch (e) { return 0; }
  }

  // Best move for the side to move, searched to `depth` plies (default 2). Returns
  // { move: <verbose move incl .san>, scoreWhite } or null. Never throws.
  function bestMove(fen, depth) {
    try {
      var c = new (_ChessCtor())(fen);
      var moves = c.moves({ verbose: true });
      if (!moves.length) return null;
      var maximizing = c.turn() === 'w';
      var d = Math.max(1, (depth | 0) || 2);
      var ordered = orderMoves(moves);
      var best = null, bestVal = maximizing ? -Infinity : Infinity;
      // Alpha-beta at the root: we only need the single best move + its exact
      // score (the PV move's value is exact under alpha-beta), so we prune here.
      // (chooseMove keeps a full window because its difficulty model ranks the
      // 2nd/3rd-best candidates and so needs exact scores for non-PV moves; this
      // function does not, and pruning keeps Game Review fast on dense positions.)
      var alpha = -Infinity, beta = Infinity;
      for (var i = 0; i < ordered.length; i++) {
        c.move(ordered[i]);
        var val = minimax(c, d - 1, alpha, beta, !maximizing, 1);
        c.undo();
        if (maximizing) {
          if (val > bestVal) { bestVal = val; best = ordered[i]; }
          if (val > alpha) alpha = val;
        } else {
          if (val < bestVal) { bestVal = val; best = ordered[i]; }
          if (val < beta) beta = val;
        }
      }
      return best ? { move: best, scoreWhite: bestVal } : null;
    } catch (e) { return null; }
  }

  // Expose on the correct global: window on the main thread, self inside a worker,
  // globalThis under Node (head-less tests).
  var glob = _g();
  var api = { chooseMove: chooseMove, evaluate: evaluatePosition, bestMove: bestMove };

  // Worker-backed async search — ONLY on the main thread (window + Worker present).
  // Moves the up-to-~4s minimax search OFF the UI thread so the app never freezes.
  // Falls back to the synchronous engine if Workers are unavailable, error, or hang.
  if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
    var _worker = null, _nextId = 1, _pending = {};
    function _ensureWorker() {
      if (_worker) return _worker;
      try {
        _worker = new Worker('ct-ai-worker.js');
        _worker.onmessage = function (e) {
          var d = e.data || {}; var cb = _pending[d.id];
          if (cb) { delete _pending[d.id]; cb(d.move); }
        };
        _worker.onerror = function () { _worker = null; }; // next call falls back to sync
      } catch (e) { _worker = null; }
      return _worker;
    }
    function _syncFromFen(fen, aiElo, startFen960) {
      try { return chooseMove(new window.Chess(fen), aiElo, startFen960); } catch (e) { return null; }
    }
    // fen is serializable for postMessage; the worker reconstructs the position.
    // startFen960 (optional) is forwarded so the worker can offer 960 castling.
    api.chooseMoveAsync = function (fen, aiElo, startFen960) {
      return new Promise(function (resolve) {
        var w = _ensureWorker();
        if (!w) { resolve(_syncFromFen(fen, aiElo, startFen960)); return; }
        var id = _nextId++;
        var timer = setTimeout(function () {
          if (_pending[id]) { delete _pending[id]; resolve(_syncFromFen(fen, aiElo, startFen960)); }
        }, 12000);
        _pending[id] = function (move) { clearTimeout(timer); resolve(move); };
        try { w.postMessage({ id: id, fen: fen, aiElo: aiElo, startFen960: startFen960 }); }
        catch (e) { clearTimeout(timer); delete _pending[id]; resolve(_syncFromFen(fen, aiElo, startFen960)); }
      });
    };
  }

  glob.CT_AI = api;
})();
