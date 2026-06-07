/*
 * review.js -- ChessTrophies Game Review (self-contained module).
 *
 * After a game ends, app.js calls window.CT_reviewGame(history, startFen).
 * We replay the moves through chess.js, score each resulting position with the
 * SAME engine that picks the computer's moves (window.CT_AI from ct-ai.js:
 * minimax + quiescence + piece-square tables), compare each played move against
 * the engine's best move at a modest depth, classify it, and present an accuracy
 * summary with a navigable board. This is a fast in-browser engine, not
 * Stockfish, so verdicts are approximate (see DISCLAIMER below).
 * Decoupled from app.js internals; uses window.CT + window.Chess + window.CT_AI.
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

  // One-line honesty note shown in the review UI: this is a fast browser engine,
  // not a top engine, so its judgements are approximate.
  var DISCLAIMER = 'Approximate analysis by a fast in-browser engine — not a definitive evaluation.';

  // Classify a move by how much eval (from the mover's perspective) it lost vs the
  // engine's best. Labels are deliberately lower-confidence wording (DX-7): the
  // CSS/keys (`cls`) are unchanged so styling and downstream checks keep working;
  // only the human-readable `tag` text is softened.
  function classify(loss) {
    if (loss <= 20) return { tag: 'Good move', cls: 'best' };
    if (loss <= 60) return { tag: 'Solid', cls: 'good' };
    if (loss <= 150) return { tag: 'Inaccuracy', cls: 'inacc' };
    if (loss <= 300) return { tag: 'Likely mistake', cls: 'mistake' };
    return { tag: 'Likely blunder', cls: 'blunder' };
  }

  // --- Engine-backed evaluation (falls back to the local heuristic) ----------
  // White-positive cp eval of a position. Prefers the real minimax/quiescence
  // engine (ct-ai.js); falls back to the 1-ply material heuristic above.
  function engineEval(fen, depth) {
    if (window.CT_AI && window.CT_AI.evaluate) return window.CT_AI.evaluate(fen, depth || 0);
    return evaluate(fen);
  }
  function engineBest(fen, depth) {
    if (window.CT_AI && window.CT_AI.bestMove) return window.CT_AI.bestMove(fen, depth || 2);
    return null;
  }

  // Anything at or beyond this magnitude is a forced mate, not material. The
  // engine (ct-ai.js) returns mate scores near +/-1,000,000 (MATE_BASE - ply);
  // the local fallback uses +/-100,000. 50,000 sits safely above any material eval.
  var MATE_CP = 50000;
  // Format a white-positive cp score as a short label, e.g. "+1.4", "-2.0", "M".
  function fmtEval(cp) {
    if (cp >= MATE_CP) return '+M';
    if (cp <= -MATE_CP) return '-M';
    var p = cp / 100;
    return (p > 0 ? '+' : '') + p.toFixed(1);
  }
  // Map a white-positive cp score to white's share of the eval bar (0..1).
  function whiteShare(cp) {
    if (cp >= MATE_CP) return 1;
    if (cp <= -MATE_CP) return 0;
    var c = Math.max(-1000, Math.min(1000, cp));
    return 0.5 + c / 2000;
  }

  var BEST_DEPTH = 2;
  function yieldUi() { return new Promise(function (r) { setTimeout(r, 0); }); }

  // Replay history and analyse each move with the engine. Async + chunked so a
  // long game never freezes the UI; onProgress(done, total) reports progress.
  async function analyze(history, startFen, onProgress) {
    var g = startFen ? new window.Chess(startFen) : new window.Chess();
    var rows = []; var lossByColor = { w: [], b: [] };
    var startEval = engineEval(g.fen(), 1);
    var depth = history.length > 60 ? 1 : BEST_DEPTH; // keep long games snappy
    for (var i = 0; i < history.length; i++) {
      var fenBefore = g.fen();
      var mover = g.turn();
      var bm = engineBest(fenBefore, depth);
      var bestWhite = bm ? bm.scoreWhite : engineEval(fenBefore, depth);
      var bestSan = bm && bm.move ? bm.move.san : null;
      var mv = history[i];
      var res = g.move({ from: mv.from, to: mv.to, promotion: mv.promotion || 'q' });
      if (!res) { break; }
      var fenAfter = g.fen();
      var playedWhite = engineEval(fenAfter, Math.max(0, depth - 1));
      // Loss from the mover's perspective (white-cp normalised by side). Cap it:
      // when a position is winning/losing by force the engine returns huge mate
      // scores (~+/-1,000,000), so an uncapped diff would dwarf the average and
      // make one move dominate the accuracy. 1000cp (~a queen) is plenty to mark
      // a blunder without distorting the mean.
      var rawLoss = mover === 'w' ? (bestWhite - playedWhite) : (playedWhite - bestWhite);
      var loss = Math.max(0, Math.min(1000, rawLoss));
      var k = classify(loss);
      lossByColor[mover].push(loss);
      // Surface a "best was ..." hint only when the played move wasn't best/good.
      var betterSan = (bestSan && bestSan !== res.san && k.cls !== 'best' && k.cls !== 'good') ? bestSan : null;
      rows.push({ idx: i, san: res.san, color: mover, fen: fenAfter, loss: loss, tag: k.tag, cls: k.cls, evalCp: playedWhite, betterSan: betterSan });
      if (onProgress) onProgress(i + 1, history.length);
      if (i % 2 === 1) await yieldUi(); // breathe every couple of plies
    }
    function acc(losses) {
      if (!losses.length) return 100;
      var avg = losses.reduce(function (a, b) { return a + b; }, 0) / losses.length;
      // Map average centipawn loss to accuracy with a smooth exponential decay:
      //   accuracy = 100 * exp(-avgCpLoss / K)
      // This is monotonic and bounded (0,100]: 0 cp loss -> 100%, and it decays
      // steeply enough that hanging material tanks the score (unlike the old
      // 100 - avg/8, which still gave ~80% to a ~150cp average). With K = 250:
      //   ~20cp -> 92%, ~60cp -> 79%, ~150cp -> 55%, ~300cp -> 30%, ~600cp -> 9%.
      var K = 250;
      var a = 100 * Math.exp(-avg / K);
      return Math.max(0, Math.min(100, Math.round(a)));
    }
    return { rows: rows, accWhite: acc(lossByColor.w), accBlack: acc(lossByColor.b), startEval: startEval };
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

  // White-positive cp eval for the currently shown ply.
  function currentEval() {
    if (!state) return 0;
    if (state.ply === 0) return state.startEval || 0;
    return state.rows[state.ply - 1].evalCp || 0;
  }

  // Render the per-move eval graph (white-cp over the game) as a clickable SVG.
  function renderGraph() {
    var el = document.getElementById('rv-graph'); if (!el || !state) return;
    var rows = state.rows; var n = rows.length;
    if (!n) { el.innerHTML = ''; return; }
    var W = 100, H = 32; // viewBox units; the SVG scales to the container width
    var pts = [];
    for (var i = 0; i < n; i++) {
      var x = n === 1 ? 0 : (i / (n - 1)) * W;
      var y = (1 - whiteShare(rows[i].evalCp)) * H; // white better -> nearer top
      pts.push(x.toFixed(2) + ',' + y.toFixed(2));
    }
    var mid = (H / 2).toFixed(2);
    var cursorX = (n === 1 ? 0 : ((state.ply > 0 ? state.ply - 1 : 0) / (n - 1)) * W).toFixed(2);
    var rects = '';
    for (var j = 0; j < n; j++) {
      var rx = (n === 1 ? 0 : (j / n) * W).toFixed(2);
      var rw = (W / n).toFixed(2);
      rects += '<rect x="' + rx + '" y="0" width="' + rw + '" height="' + H + '" fill="transparent" data-ply="' + (j + 1) + '"></rect>';
    }
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" width="100%" height="40">' +
      '<line x1="0" y1="' + mid + '" x2="' + W + '" y2="' + mid + '" class="rv-graph-mid"></line>' +
      '<polyline points="' + pts.join(' ') + '" class="rv-graph-line"></polyline>' +
      '<line x1="' + cursorX + '" y1="0" x2="' + cursorX + '" y2="' + H + '" class="rv-graph-cursor"></line>' +
      rects + '</svg>';
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
    if (cap) {
      var cur = state.ply > 0 ? rows[state.ply - 1] : null;
      if (cur) {
        var s = (cur.color === 'w' ? 'White' : 'Black') + ' played ' + cur.san + ' \u2014 ' + cur.tag;
        if (cur.betterSan) s += ' \u00b7 best: ' + cur.betterSan;
        cap.textContent = s;
      } else { cap.textContent = 'Starting position'; }
    }
    // Eval bar (white share fills from the bottom) + numeric label.
    var cp = currentEval();
    var fill = document.getElementById('rv-evalfill');
    if (fill) fill.style.height = (whiteShare(cp) * 100).toFixed(1) + '%';
    var num = document.getElementById('rv-evalnum');
    if (num) { num.textContent = fmtEval(cp); num.classList.toggle('neg', cp < 0); }
    renderGraph();
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
      '  <div class="rv-status" id="rv-status"></div>',
      '  <div class="rv-disclaimer" id="rv-disclaimer"></div>',
      '  <div class="rv-boardwrap">',
      '    <div class="rv-evalbar"><div class="rv-evalfill" id="rv-evalfill"></div><span class="rv-evalnum" id="rv-evalnum"></span></div>',
      '    <div class="rv-board" id="rv-board"></div>',
      '  </div>',
      '  <div class="rv-graph" id="rv-graph"></div>',
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
    var disc = document.getElementById('rv-disclaimer'); if (disc) disc.textContent = DISCLAIMER;
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
  // Async: opens the modal immediately and streams analysis progress so the UI
  // stays responsive while the engine scores every move.
  async function reviewGame(history, startFen) {
    if (!window.Chess || !history || !history.length) { var t = CT().toast; if (t) t('No moves to review yet.'); return; }
    ensureModal();
    open();
    var sfen = startFen || new window.Chess().fen();
    var statusEl = document.getElementById('rv-status');
    if (statusEl) statusEl.textContent = 'Analyzing… 0%';
    var w0 = document.getElementById('rv-acc-w'); if (w0) w0.textContent = '--';
    var b0 = document.getElementById('rv-acc-b'); if (b0) b0.textContent = '--';
    var data = await analyze(history, sfen, function (done, total) {
      if (statusEl) statusEl.textContent = 'Analyzing… ' + Math.round((done / total) * 100) + '%';
    });
    if (statusEl) statusEl.textContent = '';
    state = { rows: data.rows, accWhite: data.accWhite, accBlack: data.accBlack, ply: data.rows.length, startFen: sfen, startEval: data.startEval };
    var w = document.getElementById('rv-acc-w'); if (w) w.textContent = data.accWhite + '%';
    var b = document.getElementById('rv-acc-b'); if (b) b.textContent = data.accBlack + '%';
    paint();
  }

  window.CT_reviewGame = reviewGame;
})();
