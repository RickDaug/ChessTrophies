/* checkers.js — ChessTrophies self-contained Checkers / Draughts ENGINE.
 *
 * Pure JS, no DOM, no app state. UMD-lite CLASSIC script (NO import/export) so it
 * loads as a browser <script> (global CT_Checkers) AND is require()-able by the
 * ESM server via createRequire. See the bottom of the file for the dual export.
 *
 * ============================================================================
 *  BOARD SIZES & RULE SETS (explicit per game)
 * ----------------------------------------------------------------------------
 *   size 8  + rules 'acf'    American/English checkers (ACF / English draughts).
 *   size 10 + rules 'fmjd'   International draughts (FMJD / WCDF).
 *   rules 'casual' (size 8 or 10)  relaxed friendly variant (mandatory capture OFF).
 *
 *  RULE CONFIG TABLE (per ruleset; see RULESETS below for the source of truth)
 *   ----------------------------------------------------------------------------
 *   flag             acf (8)   fmjd (10)   casual (8)   casual (10)
 *   menCaptureBack   false     true        true         true
 *   flyingKings      false     true        false        true
 *   mandatory        true      true        false        false
 *   maximumCapture   false     true        false        false
 *   noProgressLimit  40        25          80           50    (single-side moves)
 *   ----------------------------------------------------------------------------
 *
 * ============================================================================
 *  *** OFFICIAL-RULE CORRECTION ***
 *  The assignment text claimed "ACF men capture forward/back". That is INCORRECT
 *  for official ACF / English draughts: under the official rules, MEN capture
 *  FORWARD ONLY (only KINGS may capture backward, and ACF kings are non-flying,
 *  one square at a time in any of the four diagonal directions). This engine
 *  implements the OFFICIAL rule (menCaptureBack:false for 'acf') and exposes the
 *  behaviour as the per-ruleset config flag `menCaptureBack` so it is unambiguous.
 *  FMJD men DO capture backward (menCaptureBack:true), per International rules.
 * ============================================================================
 *
 *  SQUARE INDEXING (documented, used in notation + serialize):
 *   Internally the board is row/col (r=0 is the TOP row, the side BLACK starts on;
 *   r=size-1 is the BOTTOM row, the side WHITE starts on). Only DARK squares are
 *   playable. Dark squares are those where (r + c) is ODD.
 *   The public numbering is the STANDARD draughts numbering 1..(N) where N=32 for
 *   8x8 and 50 for 10x10: squares numbered left-to-right, top-to-bottom, counting
 *   only dark/playable squares, starting at 1 in the top-left-most dark square.
 *   Move notation uses these numbers: "9-13" (quiet) and "9x18" (capture); a
 *   multi-capture is "9x18x25" listing every landing square in order.
 *
 *  COLORS / DIRECTION: 'w' (White) moves UP the board (toward r=0, decreasing row)
 *   and promotes on r=0. 'b' (Black) moves DOWN (toward r=size-1) and promotes on
 *   r=size-1. White moves first (turn() === 'w' at the start), matching draughts
 *   convention (in standard checkers the lighter side moves first).
 *
 *  PUBLIC API (see CT_Checkers.create for the full contract):
 *   CT_Checkers.create({ size, rules, position }) -> game
 *   CT_Checkers.load(str) -> game        (round-trips game.serialize())
 *   CT_Checkers.RULESETS                 (the config table, read-only)
 *   game.legalMoves()  -> [ move, ... ]  already filtered for mandatory/maximum.
 *   game.move(moveOrNotation) -> move | null   (applies if legal)
 *   game.isLegal(move) -> bool
 *   game.turn() -> 'w' | 'b'
 *   game.board() -> 2D array (size x size) of piece objects or null
 *   game.get(square) -> piece | null     (square = standard number)
 *   game.size, game.rules
 *   game.isGameOver(), game.winner(), game.isDraw(), game.gameOverReason()
 *   game.serialize() -> compact string ; CT_Checkers.load(str) reconstructs it.
 *   game.clone() -> deep copy (used by the AI search).
 *   game.moveCount, game.history (light, for debugging).
 *
 *  PIECE OBJECTS: { color:'w'|'b', king:bool }. board()/get() return copies.
 *  MOVE OBJECTS:  { from, to, captures:[sq...], path:[sq...], promotion:bool,
 *                   color, king (was the mover a king before the move), notation }
 *   `from`/`to`/`captures`/`path` are all STANDARD square numbers.
 */
(function () {
  'use strict';

  // --- Rule-set configuration table (the source of truth for the doc above) ---
  // size is the board this set is intended for; casual is allowed on either.
  var RULESETS = {
    acf:    { menCaptureBack: false, flyingKings: false, mandatory: true,  maximumCapture: false, noProgressLimit: 40, sizes: [8] },
    fmjd:   { menCaptureBack: true,  flyingKings: true,  mandatory: true,  maximumCapture: true,  noProgressLimit: 25, sizes: [10] },
    // casual: relaxed friendly. Mandatory capture OFF, no maximum rule. Kings are
    // non-flying on 8x8 and flying on 10x10 (documented choice — mirrors the
    // official variant for the matching size so casual "feels" like real play).
    casual8:  { menCaptureBack: true, flyingKings: false, mandatory: false, maximumCapture: false, noProgressLimit: 80, sizes: [8] },
    casual10: { menCaptureBack: true, flyingKings: true,  mandatory: false, maximumCapture: false, noProgressLimit: 50, sizes: [10] },
  };

  // Resolve the effective config for a (rules, size) pair. 'casual' picks the
  // size-specific casual variant.
  function configFor(rules, size) {
    if (rules === 'casual') return RULESETS[size === 10 ? 'casual10' : 'casual8'];
    var c = RULESETS[rules];
    if (!c) throw new Error('checkers: unknown rules "' + rules + '"');
    return c;
  }

  // ---- Square numbering helpers -------------------------------------------
  // Build, for a board size, the bi-directional maps between (r,c) and the
  // standard 1..N number. Dark squares: (r+c) odd.
  var _numCache = {};
  function numbering(size) {
    if (_numCache[size]) return _numCache[size];
    var rcToNum = [];        // rcToNum[r][c] -> number (or 0 if not playable)
    var numToRc = [null];    // numToRc[n] -> { r, c }  (1-based)
    var n = 0;
    for (var r = 0; r < size; r++) {
      rcToNum[r] = [];
      for (var c = 0; c < size; c++) {
        if (((r + c) & 1) === 1) { n++; rcToNum[r][c] = n; numToRc[n] = { r: r, c: c }; }
        else rcToNum[r][c] = 0;
      }
    }
    var info = { rcToNum: rcToNum, numToRc: numToRc, count: n };
    _numCache[size] = info;
    return info;
  }
  function rc2n(size, r, c) { return numbering(size).rcToNum[r][c]; }
  function n2rc(size, num) { return numbering(size).numToRc[num]; }

  // Diagonal direction vectors.
  var DIRS = [ { dr: -1, dc: -1 }, { dr: -1, dc: 1 }, { dr: 1, dc: -1 }, { dr: 1, dc: 1 } ];
  // Forward direction sign for a color (white goes up = -1, black goes down = +1).
  function fwd(color) { return color === 'w' ? -1 : 1; }

  // ===========================================================================
  //  GAME
  // ===========================================================================
  function Game(size, rules) {
    this.size = size;
    this.rules = rules;
    this.cfg = configFor(rules, size);
    // board[r][c] = null | { color, king }
    this.b = [];
    for (var r = 0; r < size; r++) { this.b[r] = []; for (var c = 0; c < size; c++) this.b[r][c] = null; }
    this._turn = 'w';
    this.noProgress = 0;       // single-side plies since last capture or man move
    this.moveCount = 0;        // total plies played
    this.history = [];         // notation strings (light)
    this._repCounts = {};      // position-key -> times seen (threefold)
    this._over = null;         // cached game-over result once computed
    this._reason = null;
    this._winner = null;
  }

  // Standard starting position: men fill the dark squares of the first
  // `rows` ranks on each side (3 on 8x8, 4 on 10x10). Black on top (r small),
  // White on bottom (r large).
  Game.prototype._setupStart = function () {
    var size = this.size, rows = size === 10 ? 4 : 3;
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
      if (((r + c) & 1) !== 1) continue; // dark only
      if (r < rows) this.b[r][c] = { color: 'b', king: false };
      else if (r >= size - rows) this.b[r][c] = { color: 'w', king: false };
    }
  };

  Game.prototype.turn = function () { return this._turn; };
  Game.prototype._other = function (col) { return col === 'w' ? 'b' : 'w'; };

  // Return a COPY of the board (size x size) of piece objects or null.
  Game.prototype.board = function () {
    var out = [];
    for (var r = 0; r < this.size; r++) { out[r] = []; for (var c = 0; c < this.size; c++) {
      var p = this.b[r][c]; out[r][c] = p ? { color: p.color, king: p.king } : null;
    } }
    return out;
  };
  // Get a copy of the piece on a standard square number (or null).
  Game.prototype.get = function (num) {
    var rc = n2rc(this.size, num); if (!rc) return null;
    var p = this.b[rc.r][rc.c]; return p ? { color: p.color, king: p.king } : null;
  };

  Game.prototype._inBounds = function (r, c) { return r >= 0 && r < this.size && c >= 0 && c < this.size; };
  Game.prototype._isLast = function (color, r) { return color === 'w' ? r === 0 : r === this.size - 1; };

  // ---- Move generation -----------------------------------------------------
  // Generate quiet (non-capturing) moves for the side to move.
  Game.prototype._quietMoves = function (color) {
    var moves = [], size = this.size, cfg = this.cfg;
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
      var p = this.b[r][c];
      if (!p || p.color !== color) continue;
      if (p.king && cfg.flyingKings) {
        // Flying king: slide any number of empty squares along each diagonal.
        for (var d = 0; d < 4; d++) {
          var rr = r + DIRS[d].dr, cc = c + DIRS[d].dc;
          while (this._inBounds(rr, cc) && !this.b[rr][cc]) {
            moves.push(this._mkQuiet(color, r, c, rr, cc, p.king));
            rr += DIRS[d].dr; cc += DIRS[d].dc;
          }
        }
      } else {
        // Man, or non-flying king: one square. Men go forward only.
        var dirs = p.king ? [0, 1, 2, 3] : (color === 'w' ? [0, 1] : [2, 3]);
        for (var di = 0; di < dirs.length; di++) {
          var dd = DIRS[dirs[di]];
          var nr = r + dd.dr, nc = c + dd.dc;
          if (this._inBounds(nr, nc) && !this.b[nr][nc]) moves.push(this._mkQuiet(color, r, c, nr, nc, p.king));
        }
      }
    }
    return moves;
  };

  Game.prototype._mkQuiet = function (color, r0, c0, r1, c1, wasKing) {
    var from = rc2n(this.size, r0, c0), to = rc2n(this.size, r1, c1);
    var promo = !wasKing && this._isLast(color, r1);
    return {
      from: from, to: to, captures: [], path: [from, to],
      promotion: promo, color: color, king: wasKing,
      notation: from + '-' + to,
    };
  };

  // Generate ALL capture sequences for the side to move (full multi-jump chains).
  // Returns an array of move objects, each representing a COMPLETE sequence.
  Game.prototype._captureMoves = function (color) {
    var results = [];
    var size = this.size;
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
      var p = this.b[r][c];
      if (!p || p.color !== color) continue;
      // origin = { r, c, king } recorded once; steps accumulate from there.
      this._captureFrom(color, r, c, p.king, [], [], results, { r: r, c: c, king: p.king });
    }
    // Build move objects from the raw sequences.
    var moves = [];
    for (var i = 0; i < results.length; i++) {
      var seq = results[i]; // { startR,startC, steps:[{toR,toC,capR,capC}], king }
      var fromNum = rc2n(size, seq.startR, seq.startC);
      var path = [fromNum];
      var caps = [];
      for (var s = 0; s < seq.steps.length; s++) {
        path.push(rc2n(size, seq.steps[s].toR, seq.steps[s].toC));
        caps.push(rc2n(size, seq.steps[s].capR, seq.steps[s].capC));
      }
      moves.push({
        from: fromNum, to: path[path.length - 1], captures: caps, path: path,
        promotion: seq.promotion, color: color, king: seq.startKing,
        notation: path.join('x'),
      });
    }
    return moves;
  };

  // Recursive capture explorer. `captured` is a list of {r,c} already jumped in
  // THIS sequence (may not be jumped again, and remain on the board until the
  // sequence completes — we treat them as blockers for landing but jumpable=no).
  // `steps` accumulates the chosen jumps. Adds completed sequences to `out`.
  // Promotion ENDS the sequence: a man that lands on the last rank stops.
  Game.prototype._captureFrom = function (color, r, c, isKing, captured, steps, out, origin) {
    var cfg = this.cfg, self = this;
    var found = false;

    // Directions a man may capture in.
    var dirIdx;
    if (isKing) dirIdx = [0, 1, 2, 3];
    else if (cfg.menCaptureBack) dirIdx = [0, 1, 2, 3];
    else dirIdx = (color === 'w') ? [0, 1] : [2, 3]; // forward-only men

    function isCaptured(rr, cc) {
      for (var k = 0; k < captured.length; k++) if (captured[k].r === rr && captured[k].c === cc) return true;
      return false;
    }
    // A square is occupied (blocks landing) if it has a board piece OR is one of
    // the already-captured (still-on-board) squares in this sequence.
    function occupied(rr, cc) {
      return self.b[rr][cc] !== null || isCaptured(rr, cc);
    }

    for (var di = 0; di < dirIdx.length; di++) {
      var d = DIRS[dirIdx[di]];
      if (isKing && cfg.flyingKings) {
        // Flying king: scan along the diagonal for the FIRST enemy with only
        // empties before it; then it may land on ANY empty square beyond it.
        var rr = r + d.dr, cc = c + d.dc;
        // advance over empties (not-occupied) to find a victim
        while (this._inBounds(rr, cc) && !occupied(rr, cc)) { rr += d.dr; cc += d.dc; }
        if (!this._inBounds(rr, cc)) continue;
        // rr,cc is the first occupied square. Must be an un-captured enemy.
        var vp = this.b[rr][cc];
        if (!vp || vp.color === color || isCaptured(rr, cc)) continue;
        // Land on any empty square beyond the victim.
        var lr = rr + d.dr, lc = cc + d.dc;
        while (this._inBounds(lr, lc) && !occupied(lr, lc)) {
          found = true;
          var nc2 = captured.concat([{ r: rr, c: cc }]);
          var ns = steps.concat([{ toR: lr, toC: lc, capR: rr, capC: cc }]);
          // King never promotes; continue the chain from the landing square.
          this._captureFrom(color, lr, lc, true, nc2, ns, out, origin);
          lr += d.dr; lc += d.dc;
        }
      } else {
        // Man or non-flying king: jump an ADJACENT enemy to the square beyond.
        var mr = r + d.dr, mc = c + d.dc;          // victim square
        var jr = r + 2 * d.dr, jc = c + 2 * d.dc;  // landing square
        if (!this._inBounds(jr, jc)) continue;
        if (!this._inBounds(mr, mc)) continue;
        var v = this.b[mr][mc];
        if (!v || v.color === color || isCaptured(mr, mc)) continue;
        if (occupied(jr, jc)) continue; // landing must be empty
        found = true;
        var promo = !isKing && this._isLast(color, jr);
        var captured2 = captured.concat([{ r: mr, c: mc }]);
        var steps2 = steps.concat([{ toR: jr, toC: jc, capR: mr, capC: mc }]);
        if (promo) {
          // Promotion ends the move immediately — do NOT continue jumping.
          out.push({ startR: origin.r, startC: origin.c, steps: steps2,
                     promotion: true, startKing: origin.king });
        } else {
          // Continue the chain as the same piece (still a man unless it was king).
          this._captureFrom(color, jr, jc, isKing, captured2, steps2, out, origin);
        }
      }
    }

    // If no further jump was possible from here AND we have made at least one
    // jump, this is a completed sequence (terminal).
    if (!found && steps.length > 0) {
      out.push({ startR: origin.r, startC: origin.c, steps: steps,
                 promotion: false, startKing: origin.king });
    }
  };

  // ---- Legal moves (apply mandatory / maximum filters) --------------------
  Game.prototype.legalMoves = function () {
    if (this.isGameOver()) return [];
    var color = this._turn, cfg = this.cfg;
    var caps = this._captureMoves(color);
    if (caps.length > 0) {
      if (cfg.mandatory) {
        if (cfg.maximumCapture) {
          // Keep only the sequences capturing the MAXIMUM number of pieces.
          var max = 0;
          for (var i = 0; i < caps.length; i++) if (caps[i].captures.length > max) max = caps[i].captures.length;
          return caps.filter(function (m) { return m.captures.length === max; });
        }
        return caps; // mandatory but any capture allowed (ACF)
      }
      // casual: captures are allowed but NOT forced — offer captures + quiets.
      return caps.concat(this._quietMoves(color));
    }
    return this._quietMoves(color);
  };

  // Is a given move (object or notation string) currently legal?
  Game.prototype.isLegal = function (move) {
    return this._findLegal(move) !== null;
  };
  Game.prototype._findLegal = function (move) {
    var notation = (typeof move === 'string') ? move : (move && move.notation);
    var legal = this.legalMoves();
    for (var i = 0; i < legal.length; i++) {
      if (notation && legal[i].notation === notation) return legal[i];
      if (move && typeof move === 'object' && move.from === legal[i].from && move.to === legal[i].to) {
        // Disambiguate by capture set when from/to alone are ambiguous (rare).
        if (!move.captures || move.captures.length === legal[i].captures.length) return legal[i];
      }
    }
    return null;
  };

  // ---- Applying a move -----------------------------------------------------
  Game.prototype.move = function (move) {
    var m = this._findLegal(move);
    if (!m) return null;
    var size = this.size;
    var rcFrom = n2rc(size, m.from);
    var piece = this.b[rcFrom.r][rcFrom.c];
    // Remove captured pieces (only AFTER validation; engine generated the move so
    // all captures are valid). Captured pieces removed only now (after sequence).
    for (var i = 0; i < m.captures.length; i++) {
      var rc = n2rc(size, m.captures[i]);
      this.b[rc.r][rc.c] = null;
    }
    // Move the piece.
    this.b[rcFrom.r][rcFrom.c] = null;
    var rcTo = n2rc(size, m.to);
    var nowKing = piece.king || m.promotion;
    this.b[rcTo.r][rcTo.c] = { color: piece.color, king: nowKing };

    // --- Progress / draw counters ---
    // Any CAPTURE or any MAN move (incl. promotion) is "progress" and resets the
    // counter. Only a quiet KING move with no capture increments it.
    var wasManMove = !piece.king;
    var didCapture = m.captures.length > 0;
    if (didCapture || wasManMove) this.noProgress = 0;
    else this.noProgress += 1;

    this._turn = this._other(this._turn);
    this.moveCount += 1;
    this.history.push(m.notation);
    this._over = null; this._reason = null; this._winner = null; // invalidate cache

    // Threefold repetition bookkeeping (position + side to move).
    var key = this._positionKey();
    this._repCounts[key] = (this._repCounts[key] || 0) + 1;

    return m;
  };

  // ---- Game-over / draw detection -----------------------------------------
  Game.prototype._positionKey = function () {
    // Compact key: side to move + piece layout. Used for threefold repetition.
    // Deliberately uses ONLY [wbWB.] characters (no separators) so it can be
    // embedded in serialize() without clashing with the field/record delimiters.
    var s = this._turn;
    for (var r = 0; r < this.size; r++) for (var c = 0; c < this.size; c++) {
      var p = this.b[r][c];
      if (((r + c) & 1) !== 1) continue;
      s += p ? (p.color === 'w' ? (p.king ? 'W' : 'w') : (p.king ? 'B' : 'b')) : '.';
    }
    return s;
  };

  Game.prototype._compute = function () {
    if (this._over !== null) return;
    // Side to move with no legal move loses.
    var moves = this.legalMovesRaw(); // raw avoids recursion via isGameOver
    if (moves.length === 0) {
      this._over = true;
      this._winner = this._other(this._turn);
      this._reason = 'no-moves';
      return;
    }
    // No-progress draw.
    if (this.noProgress >= this.cfg.noProgressLimit) {
      this._over = true; this._winner = null; this._reason = 'no-progress'; return;
    }
    // Threefold repetition.
    var key = this._positionKey();
    if ((this._repCounts[key] || 0) >= 3) {
      this._over = true; this._winner = null; this._reason = 'threefold'; return;
    }
    this._over = false; this._winner = null; this._reason = null;
  };

  // legalMoves without the isGameOver() guard (to break recursion in _compute).
  Game.prototype.legalMovesRaw = function () {
    var color = this._turn, cfg = this.cfg;
    var caps = this._captureMoves(color);
    if (caps.length > 0) {
      if (cfg.mandatory) {
        if (cfg.maximumCapture) {
          var max = 0;
          for (var i = 0; i < caps.length; i++) if (caps[i].captures.length > max) max = caps[i].captures.length;
          return caps.filter(function (m) { return m.captures.length === max; });
        }
        return caps;
      }
      return caps.concat(this._quietMoves(color));
    }
    return this._quietMoves(color);
  };

  Game.prototype.isGameOver = function () { this._compute(); return this._over === true; };
  Game.prototype.isDraw = function () { this._compute(); return this._over === true && this._winner === null; };
  Game.prototype.winner = function () { this._compute(); return this._over === true ? this._winner : null; };
  Game.prototype.gameOverReason = function () { this._compute(); return this._over === true ? this._reason : null; };

  // ---- Serialization -------------------------------------------------------
  // Compact string: "CK1|size|rules|turn|noProgress|moveCount|<board>|<rep>"
  // <board> is the dark squares in number order: w/W/b/B/. (W,B = king).
  Game.prototype.serialize = function () {
    var num = numbering(this.size);
    var board = '';
    for (var n = 1; n <= num.count; n++) {
      var rc = num.numToRc[n]; var p = this.b[rc.r][rc.c];
      board += p ? (p.color === 'w' ? (p.king ? 'W' : 'w') : (p.king ? 'B' : 'b')) : '.';
    }
    // Repetition table: records are "key=count" joined by ','. Keys contain only
    // [wbWB.] (see _positionKey) so neither ',' nor '=' nor '|' can appear in them,
    // making the encoding unambiguous. This preserves threefold tracking across
    // serialize/load. The whole field is the last '|'-delimited part.
    var rep = [];
    for (var k in this._repCounts) if (this._repCounts.hasOwnProperty(k) && this._repCounts[k] > 0) rep.push(k + '=' + this._repCounts[k]);
    return ['CK1', this.size, this.rules, this._turn, this.noProgress, this.moveCount, board, rep.join(',')].join('|');
  };

  function load(str) {
    var parts = String(str).split('|');
    if (parts[0] !== 'CK1') throw new Error('checkers.load: bad format');
    var size = parseInt(parts[1], 10);
    var rules = parts[2];
    var g = new Game(size, rules);
    g._turn = parts[3];
    g.noProgress = parseInt(parts[4], 10) || 0;
    g.moveCount = parseInt(parts[5], 10) || 0;
    var board = parts[6] || '';
    var num = numbering(size);
    for (var n = 1; n <= num.count; n++) {
      var ch = board[n - 1] || '.';
      var rc = num.numToRc[n];
      if (ch === '.') g.b[rc.r][rc.c] = null;
      else if (ch === 'w') g.b[rc.r][rc.c] = { color: 'w', king: false };
      else if (ch === 'W') g.b[rc.r][rc.c] = { color: 'w', king: true };
      else if (ch === 'b') g.b[rc.r][rc.c] = { color: 'b', king: false };
      else if (ch === 'B') g.b[rc.r][rc.c] = { color: 'b', king: true };
    }
    var rep = parts.slice(7).join('|'); // rep field is last; rejoin defensively
    g._repCounts = {};
    if (rep) rep.split(',').forEach(function (e) {
      var eq = e.lastIndexOf('=');
      if (eq > 0) g._repCounts[e.slice(0, eq)] = parseInt(e.slice(eq + 1), 10) || 0;
    });
    return g;
  }

  // ---- Clone (deep copy for the AI search) --------------------------------
  Game.prototype.clone = function () {
    var g = new Game(this.size, this.rules);
    for (var r = 0; r < this.size; r++) for (var c = 0; c < this.size; c++) {
      var p = this.b[r][c]; g.b[r][c] = p ? { color: p.color, king: p.king } : null;
    }
    g._turn = this._turn;
    g.noProgress = this.noProgress;
    g.moveCount = this.moveCount;
    g.history = this.history.slice();
    var rc = {}; for (var k in this._repCounts) if (this._repCounts.hasOwnProperty(k)) rc[k] = this._repCounts[k];
    g._repCounts = rc;
    return g;
  };

  // ===========================================================================
  //  FACTORY
  // ===========================================================================
  function create(opts) {
    opts = opts || {};
    var size = opts.size || 8;
    if (size !== 8 && size !== 10) throw new Error('checkers: size must be 8 or 10');
    var rules = opts.rules || (size === 10 ? 'fmjd' : 'acf');
    // Validate rules vs size for the official sets.
    if (rules === 'acf' && size !== 8) throw new Error('checkers: acf requires size 8');
    if (rules === 'fmjd' && size !== 10) throw new Error('checkers: fmjd requires size 10');
    var g = new Game(size, rules);
    if (opts.position) {
      // position can be a serialize() string or a board map { num: 'w'|'W'|'b'|'B' }
      if (typeof opts.position === 'string') {
        var loaded = load(opts.position);
        return loaded;
      }
      // object map of square-number -> piece code
      for (var nk in opts.position) if (opts.position.hasOwnProperty(nk)) {
        var rc = n2rc(size, parseInt(nk, 10)); if (!rc) continue;
        var code = opts.position[nk];
        g.b[rc.r][rc.c] =
          code === 'w' ? { color: 'w', king: false } :
          code === 'W' ? { color: 'w', king: true } :
          code === 'b' ? { color: 'b', king: false } :
          code === 'B' ? { color: 'b', king: true } : null;
      }
      if (opts.turn) g._turn = opts.turn;
    } else {
      g._setupStart();
    }
    return g;
  }

  var api = {
    create: create,
    load: load,
    RULESETS: RULESETS,
    configFor: configFor,
    numbering: numbering,
    // expose number<->rc for tooling/clients
    squareToRC: function (size, n) { var rc = n2rc(size, n); return rc ? { r: rc.r, c: rc.c } : null; },
    rcToSquare: function (size, r, c) { return rc2n(size, r, c); },
    version: 'CK1',
  };

  // --- Dual-environment export (browser <script> global + CommonJS require) --
  var G = (typeof window !== 'undefined') ? window : (typeof self !== 'undefined' ? self : globalThis);
  G.CT_Checkers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
