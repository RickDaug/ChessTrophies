/*
 * review.js -- ChessTrophies Game Review (self-contained module).
 *
 * After a game ends, app.js calls window.CT_reviewGame(history, startFen).
 * We replay the moves through chess.js, score each resulting position with a
 * lightweight material+mobility heuristic (Stockfish is intentionally disabled
 * in this build -- see stockfish-ai.js), compare each played move against the
 * heuristic best move at 1-ply, classify it, and present an accuracy summary
 * with a navigable board. Decoupled from app.js internals; uses window.CT + window.Chess.
 */
(function () {
  'use strict';
  function CT() { return window.CT || {}; }
  var FILES = 'abcdefgh';

  var VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

  // White-positive centipawn-ish evaluation of a position (side-agnostic).
  function evaluate(fen) {
    var g = new window.Chess(fen);
    if (g.in_checkmate()) return (g.turn() === 'w') ? -100000 : 100000; // side to move is mated
    if (g.in_draw() || g.in_stalemate() || g.insufficient_material()) return 0;
    var board = g.board(); var score = 0;
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var sq = board[r][c]; if (!sq) continue;
      var v = VALUES[sq.type] || 0;
      // small central bonus
      var centre = (3.5 - Math.abs(3.5 - c)) + (3.5 - Math.abs(3.5 - r));
      v += centre * 4;
      score += (sq.color === 'w') ? v : -v;
    }
    return score;
  }

  // Best achievable eval for the side to move at 1-ply (their perspective, higher=better).
  function bestEvalForMover(fen) {
    var g = new window.Chess(fen);
    var mover = g.turn();
    var moves = g.moves({ verbose: true });
    if (!moves.length) return evaluate(fen) * (mover === 'w' ? 1 : -1);
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var gg = new window.Chess(fen); gg.move(moves[i]);
      var e = evaluate(gg.fen()) * (mover === 'w' ? 1 : -1);
      if (e > best) best = e;
    }
    return best;
  }
  console.log('[review] module loaded');

  // Classify a move by how much eval (from the mover's perspective) it lost vs best.
  function classify(loss) {
    if (loss <= 20) return { tag: 'Best', cls: 'best' };
    if (loss <= 60) return { tag: 'Good', cls: 'good' };
    if (loss <= 150) return { tag: 'Inaccuracy', cls: 'inacc' };
    if (loss <= 300) return { tag: 'Mistake', cls: 'mistake' };
    return { tag: 'Blunder', cls: 'blunder' };
  }

  // Replay history and analyse each move. history: verbose move array (chess.js).
  function analyze(history, startFen) {
    var g = startFen ? new window.Chess(startFen) : new window.Chess();
    var rows = []; var lossByColor = { w: [], b: [] };
    for (var i = 0; i < history.length; i++) {
      var fenBefore = g.fen();
      var mover = g.turn();
      var best = bestEvalForMover(fenBefore);
      var mv = history[i];
      var res = g.move({ from: mv.from, to: mv.to, promotion: mv.promotion || 'q' });
      if (!res) { break; }
      var after = evaluate(g.fen()) * (mover === 'w' ? 1 : -1); // mover's perspective
      var loss = Math.max(0, best - after);
      var k = classify(loss);
      lossByColor[mover].push(loss);
      rows.push({ idx: i, san: res.san, color: mover, fen: g.fen(), loss: loss, tag: k.tag, cls: k.cls });
    }
    function acc(losses) {
      if (!losses.length) return 100;
      var avg = losses.reduce(function (a, b) { return a + b; }, 0) / losses.length;
      // map average centipawn loss to a friendly accuracy %
      var a = 100 - (avg / 8);
      return Math.max(20, Math.min(100, Math.round(a)));
    }
    return { rows: rows, accWhite: acc(lossByColor.w), accBlack: acc(lossByColor.b) };
  }
  console.log('[review] analyzer ready');

  // ---- rendering ----
  var state = null; // { rows, accWhite, accBlack, ply, startFen }

  function fenToBoard(fen) {
    var rows = fen.split(' ')[0].split('/'); var b = [];
    for (var r = 0; r < 8; r++) { var row = []; var s = rows[r];
      for (var i = 0; i < s.length; i++) { var c = s[i];
        if (/[1-8]/.test(c)) { for (var k = 0; k < +c; k++) row.push(null); }
        else row.push({ type: c.toLowerCase(), color: c === c.toUpperCase() ? 'w' : 'b' }); }
      b.push(row); }
    return b;
  }

  function boardHtml(fen) {
    var b = fenToBoard(fen); var html = '';
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var dark = (r + c) % 2 === 1; var p = b[r][c];
      var svg = p && CT().pieceSVG ? CT().pieceSVG(p.type, p.color) : '';
      html += '<div class="rv-sq ' + (dark ? 'dark' : 'light') + '">' + (p ? '<div class="rv-piece">' + svg + '</div>' : '') + '</div>';
    }
    return html;
  }

  function currentFen() {
    if (!state) return new window.Chess().fen();
    if (state.ply === 0) return state.startFen || new window.Chess().fen();
    return state.rows[state.ply - 1].fen;
  }

  function paint() {
    var board = document.getElementById('rv-board'); if (board) board.innerHTML = boardHtml(currentFen());
    var rows = state.rows;
    var moveList = rows.map(function (m, i) {
      var num = (i % 2 === 0) ? (Math.floor(i / 2) + 1) + '. ' : '';
      var active = (state.ply === i + 1) ? ' active' : '';
      return '<span class="rv-move' + active + '" data-ply="' + (i + 1) + '">' + num + m.san + ' <em class="rv-tag ' + m.cls + '">' + m.tag + '</em></span>';
    }).join('');
    var ml = document.getElementById('rv-moves'); if (ml) ml.innerHTML = moveList;
    var cap = document.getElementById('rv-caption');
    if (cap) { var cur = state.ply > 0 ? rows[state.ply - 1] : null; cap.textContent = cur ? (cur.color === 'w' ? 'White' : 'Black') + ' played ' + cur.san + ' \u2014 ' + cur.tag : 'Starting position'; }
  }

  function step(d) { if (!state) return; state.ply = Math.max(0, Math.min(state.rows.length, state.ply + d)); paint(); }
  function goto(p) { if (!state) return; state.ply = Math.max(0, Math.min(state.rows.length, p)); paint(); }

  function ensureModal() {
    if (document.getElementById('modal-review')) return;
    var d = document.createElement('div');
    d.className = 'modal-overlay'; d.id = 'modal-review';
    d.innerHTML = [
      '<div class="modal rv-modal">',
      '  <h3 class="rv-h">Game Review</h3>',
      '  <div class="rv-acc">',
      '    <div class="rv-acc-item"><label>White</label><span id="rv-acc-w">--</span></div>',
      '    <div class="rv-acc-item"><label>Black</label><span id="rv-acc-b">--</span></div>',
      '  </div>',
      '  <div class="rv-board" id="rv-board"></div>',
      '  <div class="rv-caption" id="rv-caption"></div>',
      '  <div class="rv-nav">',
      '    <button class="btn-secondary" id="rv-first">&#171;</button>',
      '    <button class="btn-secondary" id="rv-prev">&#8249; Prev</button>',
      '    <button class="btn-secondary" id="rv-next">Next &#8250;</button>',
      '    <button class="btn-secondary" id="rv-last">&#187;</button>',
      '  </div>',
      '  <div class="rv-moves" id="rv-moves"></div>',
      '  <button class="btn-primary" id="rv-close">Close</button>',
      '</div>'
    ].join('');
    document.body.appendChild(d);
    d.addEventListener('click', function (e) {
      var t = e.target;
      if (t.id === 'rv-close' || t.id === 'modal-review') close();
      else if (t.id === 'rv-prev') step(-1);
      else if (t.id === 'rv-next') step(1);
      else if (t.id === 'rv-first') goto(0);
      else if (t.id === 'rv-last') goto(state ? state.rows.length : 0);
      else { var mv = t.closest ? t.closest('[data-ply]') : null; if (mv) goto(+mv.getAttribute('data-ply')); }
    });
  }
  function open() { ensureModal(); var m = document.getElementById('modal-review'); if (m) m.classList.add('show'); }
  function close() { var m = document.getElementById('modal-review'); if (m) m.classList.remove('show'); }

  // Public entry point called by app.js when a game ends / user taps Review.
  function reviewGame(history, startFen) {
    if (!window.Chess || !history || !history.length) { var t = CT().toast; if (t) t('No moves to review yet.'); return; }
    var data = analyze(history, startFen);
    state = { rows: data.rows, accWhite: data.accWhite, accBlack: data.accBlack, ply: data.rows.length, startFen: startFen || new window.Chess().fen() };
    open();
    var w = document.getElementById('rv-acc-w'); if (w) w.textContent = data.accWhite + '%';
    var b = document.getElementById('rv-acc-b'); if (b) b.textContent = data.accBlack + '%';
    paint();
  }

  window.CT_reviewGame = reviewGame;
})();
