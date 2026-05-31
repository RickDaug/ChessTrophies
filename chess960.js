/* chess960.js — Fischer Random (Chess960) starting-position generator.
   Self-contained IIFE. Exposes window.CT_random960Fen() and window.CT_960Fen(n).
   Produces a legal 960 back-rank: bishops on opposite colours, king between rooks. */
(function () {
  'use strict';

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

  window.CT_960Fen = fen960;
  window.CT_random960Fen = random960Fen;

  // Sanity helper used by tests: validate a back-rank is legal.
  window.CT_960Valid = function (idx) {
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
