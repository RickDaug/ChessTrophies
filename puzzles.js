/*
 * puzzles.js -- ChessTrophies Tactics Trainer (self-contained module).
 *
 * Follows the academy.js integration pattern: consumes window.CT and exposes
 * window.CT_renderPuzzles, which app.js's showScreen('puzzles') calls.
 *
 * Puzzle data is loaded from window.CT_PUZZLES (puzzles-data.js), which is
 * AUTO-GENERATED, engine-verified original compositions -- see tools/gen-puzzles.js.
 *
 * Progress (streak/best/daily) is device-local under PROGRESS_KEY. We deliberately
 * keep this out of the shared DB so it works for guests too and never desyncs.
 */
(function () {
  'use strict';
  var PROGRESS_KEY = 'ct_puzzle_progress_v1';
  var FILES = 'abcdefgh';

  function CT() { return window.CT || {}; }
  function el(id) { return document.getElementById(id); }

  // ---- progress persistence ----
  function loadProgress() {
    try { var p = JSON.parse(localStorage.getItem(PROGRESS_KEY)); if (p && typeof p === 'object') return p; } catch (e) {}
    return { solved: 0, streak: 0, best: 0, byId: {}, dailyDate: null, dailySolved: false };
  }
  function saveProgress(p) { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch (e) {} }

  // ---- FEN -> 8x8 board array (rank 8 first) ----
  function parseFen(fen) {
    var rows = fen.split(' ')[0].split('/');
    var board = [];
    for (var r = 0; r < 8; r++) {
      var row = []; var s = rows[r];
      for (var i = 0; i < s.length; i++) {
        var c = s[i];
        if (/[1-8]/.test(c)) { for (var k = 0; k < +c; k++) row.push(null); }
        else { row.push({ type: c.toLowerCase(), color: (c === c.toUpperCase()) ? 'w' : 'b' }); }
      }
      board.push(row);
    }
    return board; // board[0] = rank 8
  }
  function squareName(rowIdx, colIdx) { return FILES[colIdx] + (8 - rowIdx); }
  function fenTurn(fen) { return fen.split(' ')[1] === 'w' ? 'w' : 'b'; }
  console.log('[puzzles] module loaded');

  // ---- runtime state ----
  var current = null;   // current puzzle object
  var liveFen = null;   // chess.js position as we solve
  var selected = null;  // selected from-square
  var solvedThis = false;
  var mode = 'mixed';   // mixed | easy | medium | hard | daily

  function allPuzzles() { return (window.CT_PUZZLES || []).slice(); }

  // Deterministic daily pick so everyone gets the same daily puzzle each day.
  function dailyPuzzle() {
    var list = allPuzzles(); if (!list.length) return null;
    var d = new Date(); var key = d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
    return list[key % list.length];
  }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

  function pickPuzzle() {
    var prog = loadProgress();
    var list = allPuzzles();
    if (mode === 'daily') return dailyPuzzle();
    if (mode !== 'mixed') list = list.filter(function (p) { return p.difficulty === mode; });
    if (!list.length) list = allPuzzles();
    // Prefer unsolved puzzles; fall back to any once all solved.
    var unsolved = list.filter(function (p) { return !prog.byId[p.id]; });
    var pool = unsolved.length ? unsolved : list;
    return pool[(Math.random() * pool.length) | 0];
  }

  // ---- board rendering ----
  function renderBoard() {
    var wrap = el('puzzle-board'); if (!wrap || !current) return;
    var board = parseFen(liveFen);
    var humanColor = fenTurn(current.fen); // player solves AS the side to move in the puzzle
    var flip = humanColor === 'b';          // orient so the solver is at the bottom
    var html = '';
    for (var ri = 0; ri < 8; ri++) {
      for (var ci = 0; ci < 8; ci++) {
        var rr = flip ? 7 - ri : ri;
        var cc = flip ? 7 - ci : ci;
        var sqn = squareName(rr, cc);
        var dark = (rr + cc) % 2 === 1;
        var piece = board[rr][cc];
        var sel = (selected === sqn) ? ' sel' : '';
        var svg = piece && CT().pieceSVG ? CT().pieceSVG(piece.type, piece.color) : '';
        html += '<div class="pz-sq ' + (dark ? 'dark' : 'light') + sel + '" data-pzsq="' + sqn + '">' + (piece ? '<div class="pz-piece">' + svg + '</div>' : '') + '</div>';
      }
    }
    wrap.innerHTML = html;
    wrap.classList.toggle('flipped', flip);
  }

  function legalFromSquare(sq) {
    if (!window.Chess) return [];
    var g = new window.Chess(liveFen);
    return g.moves({ square: sq, verbose: true }) || [];
  }

  function onSquareClick(sqn) {
    if (solvedThis || !current) return;
    var board = parseFen(liveFen);
    var turn = fenTurn(liveFen);
    // find piece on square
    var fileIdx = FILES.indexOf(sqn[0]); var rankIdx = 8 - (+sqn[1]);
    var piece = board[rankIdx][fileIdx];
    if (selected) {
      if (selected === sqn) { selected = null; renderBoard(); return; }
      attemptMove(selected, sqn);
      return;
    }
    if (piece && piece.color === turn) { selected = sqn; renderBoard(); }
  }

  function coordOf(move) { return move.from + move.to + (move.promotion ? move.promotion : ''); }

  // A puzzle may accept several winning moves (e.g. any of two discovered checks),
  // so we match the played move against EVERY entry in current.solution, comparing
  // either the full UCI (with promotion) or just from+to.
  function matchesSolution(played) {
    var sols = current.solution || [];
    for (var i = 0; i < sols.length; i++) {
      if (played === sols[i] || played.slice(0, 4) === sols[i].slice(0, 4)) return true;
    }
    return false;
  }

  function attemptMove(from, to) {
    selected = null;
    if (!window.Chess) { return; }
    var g = new window.Chess(liveFen);
    // try with queen promotion by default if a promotion is possible
    var mv = g.move({ from: from, to: to, promotion: 'q' });
    if (!mv) { renderBoard(); flash('That is not a legal move.', false); return; }
    var played = coordOf(mv);
    var isCorrectKey = matchesSolution(played);

    // Mate in 1: the move must both match a key and actually be checkmate.
    if (current.objective === 'Mate in 1') {
      if (g.in_checkmate() && isCorrectKey) { liveFen = g.fen(); renderBoard(); onSolved(); }
      else { flash('Not the mate -- try again.', false); renderBoard(); }
      return;
    }

    // Win material (forks, pins, skewers, discoveries): no mate to deliver, so the
    // single winning move IS the solution. Accept it and we're done.
    if (current.objective === 'Win material') {
      if (isCorrectKey) { liveFen = g.fen(); renderBoard(); onSolved(); }
      else { flash('Not the winning move -- try again.', false); renderBoard(); }
      return;
    }

    // Mate in 2: play the forced key, let the engine answer, then find the mate.
    if (!isCorrectKey) { flash('Not the key move -- try again.', false); renderBoard(); return; }
    liveFen = g.fen(); renderBoard();
    if (g.in_checkmate()) { onSolved(); return; }
    // Engine plays the (forced) best defence, then waits for the mating move.
    setTimeout(function () { playDefence(); }, 350);
  }

  function playDefence() {
    var g = new window.Chess(liveFen);
    var replies = g.moves({ verbose: true });
    if (!replies.length) { return; }
    // pick a defence that still allows a mate-in-1 (any will, by construction)
    var pick = replies[(Math.random() * replies.length) | 0];
    g.move(pick); liveFen = g.fen(); renderBoard();
    flash('Find the mate!', true);
  }

  function onSolved() {
    if (solvedThis) return; solvedThis = true;
    var prog = loadProgress();
    var firstTime = !prog.byId[current.id];
    prog.byId[current.id] = true;
    if (firstTime) prog.solved = (prog.solved || 0) + 1;
    prog.streak = (prog.streak || 0) + 1;
    if (prog.streak > (prog.best || 0)) prog.best = prog.streak;
    if (mode === 'daily') { prog.dailyDate = todayStr(); prog.dailySolved = true; }
    saveProgress(prog);
    try { if (window.ChessSounds && window.ChessSounds.move) window.ChessSounds.move(); } catch (e) {}
    var t = CT().toast; if (t) t('Solved! Streak ' + prog.streak, true);
    flash('Solved! Well played.', true);
    updateStats();
    var next = el('btn-pz-next'); if (next) next.style.display = '';
  }

  function flash(msg, good) {
    var s = el('puzzle-status'); if (!s) return;
    s.textContent = msg;
    s.className = 'pz-status ' + (good ? 'good' : 'bad');
  }

  function updateStats() {
    var prog = loadProgress();
    var total = allPuzzles().length;
    var setTxt = function (id, v) { var n = el(id); if (n) n.textContent = v; };
    setTxt('pz-streak', prog.streak || 0);
    setTxt('pz-best', prog.best || 0);
    setTxt('pz-solved', (prog.solved || 0) + ' / ' + total);
  }

  function loadPuzzle(p) {
    current = p || pickPuzzle();
    if (!current) { flash('No puzzles available.', false); return; }
    liveFen = current.fen; selected = null; solvedThis = false;
    var meta = el('puzzle-meta');
    if (meta) {
      var label = (current.name ? current.name + '  ·  ' : '') + current.objective +
        '  ·  ' + cap(current.difficulty) + (current.theme ? '  ·  ' + current.theme : '') +
        (mode === 'daily' ? '  ·  Daily' : '');
      meta.textContent = label;
    }
    var turn = fenTurn(current.fen);
    var aim = current.objective === 'Win material' ? 'Find the move that wins material.' : current.objective + '.';
    flash((turn === 'w' ? 'White' : 'Black') + ' to play. ' + aim, true);
    var next = el('btn-pz-next'); if (next) next.style.display = 'none';
    renderBoard(); updateStats();
  }
  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  function setMode(m) {
    mode = m;
    var ids = ['mixed', 'easy', 'medium', 'hard', 'daily'];
    ids.forEach(function (x) { var b = el('pz-mode-' + x); if (b) b.classList.toggle('active', x === m); });
    loadPuzzle(mode === 'daily' ? dailyPuzzle() : null);
  }

  // ---- screen scaffold (built once into #screen-puzzles) ----
  var built = false;
  function buildScaffold() {
    var screen = el('screen-puzzles'); if (!screen || built) return;
    screen.innerHTML = [
      '<div class="pz-wrap">',
      '  <h2 class="pz-title">Tactics Trainer</h2>',
      '  <p class="pz-sub">Original, engine-verified puzzles. Find the winning blow.</p>',
      '  <div class="pz-stats">',
      '    <div class="pz-stat"><span id="pz-streak">0</span><label>Streak</label></div>',
      '    <div class="pz-stat"><span id="pz-best">0</span><label>Best</label></div>',
      '    <div class="pz-stat"><span id="pz-solved">0</span><label>Solved</label></div>',
      '  </div>',
      '  <div class="pz-modes">',
      '    <button class="pz-mode active" id="pz-mode-mixed" data-mode="mixed">Mixed</button>',
      '    <button class="pz-mode" id="pz-mode-easy" data-mode="easy">Easy</button>',
      '    <button class="pz-mode" id="pz-mode-medium" data-mode="medium">Medium</button>',
      '    <button class="pz-mode" id="pz-mode-hard" data-mode="hard">Hard</button>',
      '    <button class="pz-mode" id="pz-mode-daily" data-mode="daily">Daily</button>',
      '  </div>',
      '  <div class="pz-meta" id="puzzle-meta"></div>',
      '  <div class="pz-board" id="puzzle-board"></div>',
      '  <div class="pz-status good" id="puzzle-status"></div>',
      '  <div class="pz-actions">',
      '    <button class="btn-secondary" id="btn-pz-hint">Hint</button>',
      '    <button class="btn-secondary" id="btn-pz-reset">Reset</button>',
      '    <button class="btn-primary" id="btn-pz-next" style="display:none">Next puzzle</button>',
      '  </div>',
      '</div>'
    ].join('');
    // event delegation for board clicks
    el('puzzle-board').addEventListener('click', function (e) {
      var sq = e.target.closest ? e.target.closest('[data-pzsq]') : null;
      if (sq) onSquareClick(sq.getAttribute('data-pzsq'));
    });
    el('screen-puzzles').addEventListener('click', function (e) {
      var m = e.target.closest ? e.target.closest('[data-mode]') : null;
      if (m) { setMode(m.getAttribute('data-mode')); return; }
      if (e.target.id === 'btn-pz-next') loadPuzzle(null);
      if (e.target.id === 'btn-pz-reset') { liveFen = current.fen; selected = null; solvedThis = false; renderBoard(); flash('Position reset.', true); var n = el('btn-pz-next'); if (n) n.style.display = 'none'; }
      if (e.target.id === 'btn-pz-hint') { if (current) { var sqn = current.solution[0].slice(0, 2); selected = sqn; renderBoard(); flash('Try moving the piece on ' + sqn + '.', true); } }
    });
    built = true;
  }

  function render() {
    buildScaffold();
    if (!current) loadPuzzle(null); else { renderBoard(); updateStats(); }
  }

  window.CT_renderPuzzles = render;
})();
