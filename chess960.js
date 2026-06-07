/* chess960.js — Fischer Random (Chess960) starting-position generator.
   Self-contained IIFE. Exposes window.CT_random960Fen() and window.CT_960Fen(n).
   Produces a legal 960 back-rank: bishops on opposite colours, king between rooks. */
(function () {
  'use strict';

  // Resolve the host global: `window` on the main thread, `self` inside a Web
  // Worker (ct-ai-worker.js importScripts this file and has no DOM/window). All
  // public API below is attached to G so both contexts see CT_960*. `Chess`
  // itself stays a bare global reference — it resolves to window/self/sandbox.
  var G = (typeof window !== 'undefined') ? window : (typeof self !== 'undefined' ? self : this);

  // Build the back-rank for a given index 0..959 using the standard
  // numbering scheme (original work, derived from the well-known rules).
  function backRank(idx) {
    var n = idx % 960;
    var slots = [null, null, null, null, null, null, null, null];

    // 1) Light-square bishop: positions 1,3,5,7 (0-based odd index).
    var b1 = n % 4; n = Math.floor(n / 4);
    var light = [1, 3, 5, 7];
    slots[light[b1]] = 'b';

    // 2) Dark-square bishop: positions 0,2,4,6.
    var b2 = n % 4; n = Math.floor(n / 4);
    var dark = [0, 2, 4, 6];
    slots[dark[b2]] = 'b';

    // 3) Queen: one of the 6 remaining empty squares.
    var q = n % 6; n = Math.floor(n / 6);
    placeInEmpty(slots, q, 'q');

    // 4) Two knights: the remaining table maps n (0..9) to a pair of the
    //    5 empty squares. Pick first knight, then second from what's left.
    var ko = n % 10;
    var pair = knightPair(ko);
    // Place the higher empty-index first so placing it does not shift the
    // lower index (both indices refer to the SAME set of empties).
    placeInEmpty(slots, pair[1], 'n');
    placeInEmpty(slots, pair[0], 'n');

    // 5) Remaining three squares get rook, king, rook in order (R K R)
    //    which guarantees the king sits between the rooks.
    var rkr = ['r', 'k', 'r'];
    var ri = 0;
    for (var i = 0; i < 8; i++) {
      if (slots[i] === null) { slots[i] = rkr[ri++]; }
    }
    return slots;
  }

  function placeInEmpty(slots, emptyIndex, piece) {
    var count = -1;
    for (var i = 0; i < 8; i++) {
      if (slots[i] === null) {
        count++;
        if (count === emptyIndex) { slots[i] = piece; return; }
      }
    }
  }

  // The 10 distinct unordered placements of two knights among 5 slots.
  function knightPair(ko) {
    var table = [
      [0, 1], [0, 2], [0, 3], [0, 4],
      [1, 2], [1, 3], [1, 4],
      [2, 3], [2, 4],
      [3, 4]
    ];
    return table[ko];
  }

  function fenFromBackRank(slots) {
    var black = slots.join('');            // lower-case = black pieces
    var white = slots.join('').toUpperCase();
    // ranks 8..1 ; black back rank, black pawns, 4 empty, white pawns, white back rank
    var fen = black + '/pppppppp/8/8/8/8/PPPPPPPP/' + white +
      ' w KQkq - 0 1';
    return fen;
  }

  function fen960(idx) {
    if (typeof idx !== 'number' || isNaN(idx)) idx = Math.floor(Math.random() * 960);
    return fenFromBackRank(backRank(idx));
  }

  function random960Fen() { return fen960(Math.floor(Math.random() * 960)); }

  G.CT_960Fen = fen960;
  G.CT_random960Fen = random960Fen;

  // ===========================================================================
  // Chess960 castling — REAL Fischer Random castling on top of chess.js 0.x.
  //
  // chess.js 0.10.x can only castle from the classic e/a/h back-rank, so for
  // randomized 960 positions we implement castling ourselves: we validate the
  // FIDE 960 castling rules by hand and, when legal, build the resulting
  // position with FEN surgery and load() it back into the live game.
  //
  // Pure, DOM-free, unit-testable API exposed on window.CT_960Castle:
  //   legalCastlingMoves(game[, startFen])  -> array of castle-move descriptors
  //   canCastle(game, side[, startFen])     -> descriptor | null  (side 'h'|'a')
  //   applyCastle(game, side[, startFen])   -> true if applied, else false
  //
  // `side` is 'h' (toward the h-side rook, "kingside": K->g, R->f) or
  // 'a' (toward the a-side rook, "queenside": K->c, R->d).
  //
  // KNOWN LIMITATION: the computer opponent (ct-ai) generates moves via
  // chess.js .moves(), which never yields a 960 castle, so the engine simply
  // won't castle in 960. That's acceptable — the human castling correctly is
  // what un-breaks the mode.
  // ===========================================================================
  var FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  function fileIdx(sq) { return FILES.indexOf(sq[0]); }
  function rankOf(sq) { return sq[1]; }
  function sq(fileIndex, rank) { return FILES[fileIndex] + rank; }

  // Locate the king and both rooks of `color` on the given board (chess.js
  // board(): array of 8 rows, rank 8 first). Returns squares on the back rank
  // only (rank 1 for white, rank 8 for black).
  function backRankPieces(game, color) {
    var rank = color === 'w' ? '1' : '8';
    var rowIdx = color === 'w' ? 7 : 0; // board() row index for that rank
    var board = game.board();
    var row = board[rowIdx];
    var king = null, rooks = [];
    for (var f = 0; f < 8; f++) {
      var p = row[f];
      if (!p || p.color !== color) continue;
      if (p.type === 'k') king = sq(f, rank);
      else if (p.type === 'r') rooks.push(sq(f, rank));
    }
    return { king: king, rooks: rooks, rank: rank };
  }

  // Determine the original rook files (a-side / h-side) for `color` from the
  // 960 start FEN. Falls back to scanning the live game's back rank if no
  // start FEN is supplied. The a-side rook is the one on the lower file than
  // the king; the h-side rook is on the higher file.
  function originalRookFiles(color, startFen, game) {
    var probe;
    if (startFen) {
      try { probe = new Chess(startFen); } catch (e) { probe = null; }
    }
    if (!probe) probe = game;
    var bp = backRankPieces(probe, color);
    if (!bp.king || bp.rooks.length < 2) return null;
    var kf = fileIdx(bp.king);
    var aSide = null, hSide = null;
    bp.rooks.forEach(function (r) {
      var rf = fileIdx(r);
      if (rf < kf) aSide = rf;
      else if (rf > kf) hSide = rf;
    });
    return { kingFile: kf, aSide: aSide, hSide: hSide };
  }

  // Has `color` lost the castling right for `side` ('a'|'h')? We track this by
  // replaying the move history: a king move (any) kills both rights; a move
  // FROM the original rook's start square kills that side's right; a capture
  // landing ON the original rook square also kills it.
  function rightLost(game, color, side, origFiles) {
    var rank = color === 'w' ? '1' : '8';
    var rookFile = side === 'h' ? origFiles.hSide : origFiles.aSide;
    if (rookFile === null || rookFile === undefined) return true;
    var kingHome = sq(origFiles.kingFile, rank);
    var rookHome = sq(rookFile, rank);
    var hist = [];
    try { hist = game.history({ verbose: true }); } catch (e) { hist = []; }
    for (var i = 0; i < hist.length; i++) {
      var m = hist[i];
      if (m.color !== color) {
        // enemy move: only a capture landing on our rook's home kills the right
        if (m.to === rookHome) return true;
        continue;
      }
      if (m.piece === 'k' && m.from === kingHome) return true;
      if (m.from === kingHome) return true; // king left home
      if (m.from === rookHome) return true; // our rook left home
    }
    return false;
  }

  // Build a list of squares from a..b inclusive on a given rank (file indices).
  function fileSpan(fa, fb) {
    var lo = Math.min(fa, fb), hi = Math.max(fa, fb), out = [];
    for (var f = lo; f <= hi; f++) out.push(f);
    return out;
  }

  // Is `color`'s king attacked when standing on `kingSquare`? We build a test
  // position (cloned, NOT the live game): place the moving pieces as they would
  // be mid-castle, put the king on kingSquare, set the enemy to move, and use
  // in_check() — chess.js reports check against the side to move's king, so we
  // set the side to move to `color` and ask in_check().
  function kingAttackedAt(game, color, kingSquare, occupy, vacate) {
    var clone = new Chess(game.fen());
    // vacate squares (remove king + rook from their current spots)
    (vacate || []).forEach(function (s) { clone.remove(s); });
    // occupy: list of { square, type, color } to (re)place
    (occupy || []).forEach(function (o) { clone.put({ type: o.type, color: o.color }, o.square); });
    // Ensure the king sits on the square we are testing.
    clone.remove(kingSquare);
    clone.put({ type: 'k', color: color }, kingSquare);
    // Force side-to-move = color so in_check() tests THIS king.
    var fen = forceTurn(clone.fen(), color);
    var test;
    try { test = new Chess(fen); } catch (e) { return true; } // treat as unsafe
    return test.in_check();
  }

  // Rewrite the side-to-move field of a FEN to `color`.
  function forceTurn(fen, color) {
    var parts = fen.split(' ');
    parts[1] = color;
    // reset en passant target — irrelevant for the attack test and may be stale
    parts[3] = '-';
    return parts.join(' ');
  }

  // Compute a single castle descriptor for `color`/`side`, or null if illegal.
  function computeCastle(game, color, side, startFen) {
    var origFiles = originalRookFiles(color, startFen, game);
    if (!origFiles) return null;
    var rank = color === 'w' ? '1' : '8';
    var bp = backRankPieces(game, color);
    if (!bp.king) return null;
    // (a) right still available
    if (rightLost(game, color, side, origFiles)) return null;

    var kingFrom = bp.king;
    var kingFromF = fileIdx(kingFrom);
    var rookFromF = side === 'h' ? origFiles.hSide : origFiles.aSide;
    if (rookFromF === null) return null;
    var rookFrom = sq(rookFromF, rank);
    // Confirm the rook is actually still there.
    var rp = game.get(rookFrom);
    if (!rp || rp.type !== 'r' || rp.color !== color) return null;

    // Destination squares (standard 960 targets).
    var kingToF = side === 'h' ? 6 : 2; // g-file or c-file
    var rookToF = side === 'h' ? 5 : 3; // f-file or d-file
    var kingTo = sq(kingToF, rank);
    var rookTo = sq(rookToF, rank);

    // (b) every square the king passes through and every square between the
    // rook's start and end must be empty except for the moving king/rook.
    var movingFrom = {}; movingFrom[kingFrom] = true; movingFrom[rookFrom] = true;
    var occCheck = fileSpan(kingFromF, kingToF).map(function (f) { return sq(f, rank); })
      .concat(fileSpan(rookFromF, rookToF).map(function (f) { return sq(f, rank); }));
    // also the destination squares themselves
    occCheck.push(kingTo); occCheck.push(rookTo);
    for (var i = 0; i < occCheck.length; i++) {
      var s = occCheck[i];
      if (movingFrom[s]) continue; // the king or rook itself
      var occ = game.get(s);
      if (occ) return null; // blocked
    }

    // (c) king not in check now, doesn't pass through an attacked square, and
    // doesn't land in check. Test EVERY square in the king's transit (inclusive)
    // with the king + rook lifted off their start squares.
    var vacate = [kingFrom, rookFrom];
    var pathFiles = fileSpan(kingFromF, kingToF);
    for (var j = 0; j < pathFiles.length; j++) {
      var ks = sq(pathFiles[j], rank);
      if (kingAttackedAt(game, color, ks, [], vacate)) return null;
    }

    return {
      side: side,
      color: color,
      kingFrom: kingFrom, kingTo: kingTo,
      rookFrom: rookFrom, rookTo: rookTo,
      // SAN-ish flag for the UI/sound layer: 'k' = h-side, 'q' = a-side.
      flags: side === 'h' ? 'k' : 'q',
      san: side === 'h' ? 'O-O' : 'O-O-O',
    };
  }

  // Apply a castle descriptor to the live game by FEN surgery + load().
  function applyCastleDescriptor(game, desc) {
    var color = desc.color;
    // Snapshot board, then move king + rook.
    var clone = new Chess(game.fen());
    clone.remove(desc.kingFrom);
    clone.remove(desc.rookFrom);
    clone.put({ type: 'k', color: color }, desc.kingTo);
    clone.put({ type: 'r', color: color }, desc.rookTo);
    // Build the new FEN: flip turn, clear en passant, bump counters, strip the
    // castling rights for the side that just castled.
    var parts = clone.fen().split(' ');
    parts[1] = color === 'w' ? 'b' : 'w';         // side to move
    parts[2] = stripRightsForColor(parts[2], color); // castling rights
    parts[3] = '-';                                 // en passant
    // halfmove clock: castling is not a pawn move/capture -> increment.
    var half = parseInt(parts[4], 10); if (isNaN(half)) half = 0;
    parts[4] = String(half + 1);
    // fullmove number: increments after black moves.
    var full = parseInt(parts[5], 10); if (isNaN(full)) full = 1;
    if (color === 'b') full += 1;
    parts[5] = String(full);
    var newFen = parts.join(' ');
    game.load(newFen);
    return {
      from: desc.kingFrom, to: desc.kingTo,
      color: color, piece: 'k',
      flags: desc.flags, san: desc.san,
      // extra fields so the UI can render the rook hop / animate.
      rookFrom: desc.rookFrom, rookTo: desc.rookTo,
      castle: true,
    };
  }

  function stripRightsForColor(rights, color) {
    if (!rights || rights === '-') return '-';
    var keep = rights.split('').filter(function (c) {
      return color === 'w' ? (c === c.toLowerCase()) : (c === c.toUpperCase());
    }).join('');
    return keep === '' ? '-' : keep;
  }

  function legalCastlingMoves(game, startFen) {
    var color = game.turn();
    var out = [];
    ['h', 'a'].forEach(function (side) {
      var d = computeCastle(game, color, side, startFen);
      if (d) out.push(d);
    });
    return out;
  }

  function canCastle(game, side, startFen) {
    return computeCastle(game, game.turn(), side, startFen);
  }

  function applyCastle(game, side, startFen) {
    var d = computeCastle(game, game.turn(), side, startFen);
    if (!d) return null;
    return applyCastleDescriptor(game, d);
  }

  // Given a clicked from/to (king square -> target), figure out whether it is a
  // castling intent and which side, then return the descriptor (or null). Used
  // by the app's 960 human-move path. Supports:
  //   - king onto its own rook's square (standard 960 input)
  //   - king two+ squares toward a rook, or onto the g/c destination
  function castleIntent(game, from, to, startFen) {
    var color = game.turn();
    var piece = game.get(from);
    if (!piece || piece.type !== 'k' || piece.color !== color) return null;
    var rank = color === 'w' ? '1' : '8';
    if (rankOf(from) !== rank || rankOf(to) !== rank) return null;
    var origFiles = originalRookFiles(color, startFen, game);
    if (!origFiles) return null;
    var toF = fileIdx(to);
    var fromF = fileIdx(from);
    var target = game.get(to);

    // Case 1: king onto own rook (the canonical 960 castling move).
    if (target && target.type === 'r' && target.color === color) {
      var side = toF > fromF ? 'h' : 'a';
      // confirm that rook is the side's original rook
      var rf = side === 'h' ? origFiles.hSide : origFiles.aSide;
      if (rf === toF) return computeCastle(game, color, side, startFen);
      return null;
    }
    // Case 2: king to its castled destination (g/c) or two+ squares toward a
    // rook, when unambiguous.
    if (Math.abs(toF - fromF) >= 2 || to === sq(6, rank) || to === sq(2, rank)) {
      var dir = toF > fromF ? 'h' : 'a';
      // only treat as castle if there is an original rook on that side
      var rfile = dir === 'h' ? origFiles.hSide : origFiles.aSide;
      if (rfile === null) return null;
      // the destination should be the castled king square for that side
      var kingToF = dir === 'h' ? 6 : 2;
      if (toF === kingToF || toF === rfile) {
        return computeCastle(game, color, dir, startFen);
      }
    }
    return null;
  }

  G.CT_960Castle = {
    legalCastlingMoves: legalCastlingMoves,
    canCastle: canCastle,
    applyCastle: applyCastle,
    applyCastleDescriptor: applyCastleDescriptor,
    castleIntent: castleIntent,
  };

  // Sanity helper used by tests: validate a back-rank is legal.
  G.CT_960Valid = function (idx) {
    var s = backRank(idx);
    if (s.filter(function (x) { return x === 'b'; }).length !== 2) return false;
    var bishops = [];
    s.forEach(function (p, i) { if (p === 'b') bishops.push(i); });
    if ((bishops[0] % 2) === (bishops[1] % 2)) return false; // must differ in colour
    var ki = s.indexOf('k');
    var rooks = [];
    s.forEach(function (p, i) { if (p === 'r') rooks.push(i); });
    if (rooks.length !== 2) return false;
    if (!(ki > rooks[0] && ki < rooks[1])) return false; // king between rooks
    var counts = {};
    s.forEach(function (p) { counts[p] = (counts[p] || 0) + 1; });
    return counts.k === 1 && counts.q === 1 && counts.r === 2 && counts.b === 2 && counts.n === 2;
  };
})();
