/* ChessTrophies — Interactive Puzzles client module.
 *
 * A self-contained, dependency-free module. It does NOT edit app.js / index.html;
 * Agent 5 adds the <script> tag, a `#screen-puzzles` container, a nav entry, and
 * (optionally) a `window.CT_onPuzzleSolved(puzzleId, {rating, theme})` callback.
 *
 * PUBLIC API (window.CT_Puzzles):
 *   init(mountSelector)  — render the UI into the container. mountSelector is
 *                          optional; default '#screen-puzzles' (renders into its
 *                          '.screen-body' child if present, else the element
 *                          itself). Safe to call repeatedly (idempotent).
 *   openDaily()          — load + show today's deterministic daily puzzle.
 *   openTrainer()        — load + show a rating-targeted trainer puzzle, with a
 *                          "Next puzzle" button that keeps serving fresh ones.
 *
 * SOLVED CALLBACK (implemented by Agent 5, optional):
 *   window.CT_onPuzzleSolved(puzzleId, { rating, theme })
 *
 * ENGINES (already loaded by the page — we never bundle our own):
 *   window.Chess  — chess.js, for legality + board state.
 *   window.CT_AI  — the app engine; we use CT_AI.bestMove(fen, depth) for the
 *                   "punish" refutation when the player blunders.
 *
 * PUNISH-THEN-RETRY: on a WRONG player move we let the engine play a strong
 * reply so the consequence is felt on the board, then offer Undo/Retry to
 * restore the pre-mistake position. On a CORRECT move we auto-play the puzzle's
 * scripted opponent reply and advance; finishing the whole line = solved.
 */
(function () {
  'use strict';

  var FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  var GLYPHS = {
    wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
    bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚',
  };

  // --- API base resolution (mirror how the app reaches the backend) ----------
  function apiBase() {
    var u = (typeof window !== 'undefined' && window.CT_SERVER_URL) ? String(window.CT_SERVER_URL) : '';
    return u.replace(/\/+$/, ''); // '' => same-origin
  }
  function apiUrl(path) { return apiBase() + path; }

  function authToken() {
    // Best-effort: reuse whatever session token the app stored. We never block
    // on this (daily/trainer are public; only /solved needs it).
    try {
      if (window.CT_Auth && typeof window.CT_Auth.getSession === 'function') {
        var s = window.CT_Auth.getSession();
        if (s && s.token) return s.token;
      }
    } catch (e) {}
    try {
      var raw = localStorage.getItem('ct_session');
      if (raw) { var o = JSON.parse(raw); if (o && o.token) return o.token; }
    } catch (e) {}
    return null;
  }

  // --- DOM helpers -----------------------------------------------------------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // --- Module state ----------------------------------------------------------
  var mountEl = null;        // the element we render into
  var refs = {};             // cached child elements
  var initialized = false;

  var state = null;          // current puzzle session (see startPuzzle)
  var mode = 'daily';        // 'daily' | 'trainer'
  var lastTrainerRating = 1200;
  var playedIds = [];        // trainer: ids served this session (for "Next")

  // ---------------------------------------------------------------------------
  // RENDERING
  // ---------------------------------------------------------------------------
  function resolveMount(sel) {
    var container = document.querySelector(sel || '#screen-puzzles');
    if (!container) return null;
    var body = container.querySelector('.screen-body');
    return body || container;
  }

  function buildUI() {
    mountEl.innerHTML = '';
    var wrap = el('div', 'ctp-wrap');

    // Header: title + rating/theme badges
    var header = el('div', 'ctp-header');
    refs.title = el('div', 'ctp-title', 'Puzzle');
    var badges = el('div', 'ctp-badges');
    refs.rating = el('span', 'ctp-badge ctp-badge-rating', '');
    refs.theme = el('span', 'ctp-badge ctp-badge-theme', '');
    refs.streak = el('span', 'ctp-badge ctp-badge-streak', '');
    badges.appendChild(refs.rating); badges.appendChild(refs.theme); badges.appendChild(refs.streak);
    header.appendChild(refs.title); header.appendChild(badges);
    wrap.appendChild(header);

    // Status line (turn / feedback)
    refs.status = el('div', 'ctp-status', 'Loading…');
    wrap.appendChild(refs.status);

    // Board
    refs.board = el('div', 'ctp-board');
    wrap.appendChild(refs.board);

    // Controls
    var controls = el('div', 'ctp-controls');
    refs.btnHint = el('button', 'ctp-btn ctp-hint', 'Hint');
    refs.btnUndo = el('button', 'ctp-btn ctp-undo', 'Undo / Retry');
    refs.btnNext = el('button', 'ctp-btn ctp-next', 'Next puzzle');
    refs.btnHint.type = 'button'; refs.btnUndo.type = 'button'; refs.btnNext.type = 'button';
    controls.appendChild(refs.btnHint);
    controls.appendChild(refs.btnUndo);
    controls.appendChild(refs.btnNext);
    wrap.appendChild(controls);

    mountEl.appendChild(wrap);

    injectStyles();

    // CSP-safe: addEventListener, no inline handlers.
    refs.btnHint.addEventListener('click', onHint);
    refs.btnUndo.addEventListener('click', onUndo);
    refs.btnNext.addEventListener('click', onNext);
  }

  function injectStyles() {
    if (document.getElementById('ctp-styles')) return;
    var css = [
      '.ctp-wrap{max-width:560px;margin:0 auto;padding:8px}',
      '.ctp-header{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}',
      '.ctp-title{font-weight:700;font-size:18px}',
      '.ctp-badges{display:flex;gap:6px;flex-wrap:wrap}',
      '.ctp-badge{font-size:12px;padding:2px 8px;border-radius:10px;background:rgba(127,127,127,.18)}',
      '.ctp-badge-streak{display:none}',
      '.ctp-status{min-height:22px;margin:4px 0 8px;font-size:14px}',
      '.ctp-status.ok{color:#2e9e5b;font-weight:600}',
      '.ctp-status.bad{color:#d4504a;font-weight:600}',
      '.ctp-status.win{color:#2e9e5b;font-weight:700}',
      '.ctp-board{position:relative;width:100%;aspect-ratio:1/1;display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);border:2px solid rgba(0,0,0,.25);border-radius:6px;overflow:hidden;user-select:none;touch-action:manipulation}',
      '.ctp-sq{display:flex;align-items:center;justify-content:center;position:relative;cursor:pointer}',
      '.ctp-sq.light{background:var(--light-sq,#eedfc6)}',
      '.ctp-sq.dark{background:var(--dark-sq,#6e8c6b)}',
      '.ctp-pc{width:88%;height:88%;display:flex;align-items:center;justify-content:center;font-size:min(8vw,42px);line-height:1;pointer-events:none}',
      '.ctp-pc svg{width:100%;height:100%;pointer-events:none;filter:drop-shadow(0 1px 1px rgba(0,0,0,.25))}',
      '.ctp-sq.sel{outline:3px solid #f4c542;outline-offset:-3px}',
      '.ctp-sq.target::after{content:"";position:absolute;width:30%;height:30%;border-radius:50%;background:rgba(0,0,0,.22)}',
      '.ctp-sq.lastmove{background:rgba(244,197,66,.45)!important}',
      '.ctp-sq.hintsq{outline:3px solid #4a9be0;outline-offset:-3px}',
      '.ctp-controls{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}',
      '.ctp-btn{flex:1;min-width:90px;padding:10px;border:none;border-radius:8px;font-weight:600;cursor:pointer;background:#3b6ea5;color:#fff}',
      '.ctp-btn:disabled{opacity:.45;cursor:default}',
      '.ctp-btn.ctp-undo{background:#8a6d3b}',
      '.ctp-btn.ctp-next{background:#2e9e5b}',
      '.ctp-board.solved{animation:ctp-pop .5s ease}',
      '@keyframes ctp-pop{0%{transform:scale(1)}40%{transform:scale(1.03)}100%{transform:scale(1)}}',
    ].join('\n');
    var style = el('style');
    style.id = 'ctp-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Render the board for the current chess position. orientation: 'w'|'b'.
  function renderBoard() {
    var b = refs.board;
    b.innerHTML = '';
    if (!state) return;
    var board = state.chess.board(); // 8x8 from rank 8 -> rank 1
    var orient = state.orientation;
    var ranks = [0, 1, 2, 3, 4, 5, 6, 7];
    var files = [0, 1, 2, 3, 4, 5, 6, 7];
    if (orient === 'b') { ranks = ranks.slice().reverse(); files = files.slice().reverse(); }
    for (var ri = 0; ri < 8; ri++) {
      var r = ranks[ri];
      for (var fi = 0; fi < 8; fi++) {
        var f = files[fi];
        var sqName = FILES[f] + (8 - r);
        var isLight = (r + f) % 2 === 0;
        var sq = el('div', 'ctp-sq ' + (isLight ? 'light' : 'dark'));
        sq.setAttribute('data-sq', sqName);
        var piece = board[r][f];
        if (piece) {
          var g = el('span', 'ctp-pc');
          // Use the SAME Staunton SVG renderer + piece theme as real matches
          // (window.CT.pieceSVG) so puzzles look identical to games; fall back to
          // a unicode glyph only if that renderer isn't available.
          var svg = (window.CT && typeof window.CT.pieceSVG === 'function') ? window.CT.pieceSVG(piece.type, piece.color) : '';
          if (svg) g.innerHTML = svg;
          else g.textContent = GLYPHS[piece.color + piece.type] || '';
          sq.appendChild(g);
        }
        if (state.selected === sqName) sq.classList.add('sel');
        if (state.targets && state.targets.indexOf(sqName) >= 0) sq.classList.add('target');
        if (state.lastMove && (state.lastMove.from === sqName || state.lastMove.to === sqName)) sq.classList.add('lastmove');
        if (state.hintSquares && state.hintSquares.indexOf(sqName) >= 0) sq.classList.add('hintsq');
        sq.addEventListener('click', onSquareClick);
        b.appendChild(sq);
      }
    }
  }

  function setStatus(text, kind) {
    refs.status.textContent = text;
    refs.status.className = 'ctp-status' + (kind ? ' ' + kind : '');
  }

  function updateBadges(p, streak) {
    refs.rating.textContent = 'Rating ' + (p.rating || '?');
    refs.theme.textContent = themeLabel(p.theme);
    if (typeof streak === 'number' && streak > 0) {
      refs.streak.textContent = '🔥 ' + streak + ' day streak';
      refs.streak.style.display = '';
    }
  }

  function themeLabel(t) {
    var map = {
      mate: 'Checkmate', fork: 'Fork', pin: 'Pin', skewer: 'Skewer',
      discoveredAttack: 'Discovered attack', deflection: 'Deflection',
      sacrifice: 'Sacrifice', advantage: 'Winning tactic', endgame: 'Endgame',
      crushing: 'Crushing', tactics: 'Tactic',
    };
    return map[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Tactic');
  }

  // ---------------------------------------------------------------------------
  // PUZZLE SESSION
  // ---------------------------------------------------------------------------
  // A puzzle: { id, fen, moves:[uci...], rating, theme, title, hint }
  // state: { puzzle, chess, startFen, stepIndex, solverColor, orientation,
  //          selected, targets, lastMove, hintSquares, solved, busy, punished }
  function startPuzzle(p) {
    if (!window.Chess) { setStatus('Chess engine not loaded.', 'bad'); return; }
    var chess = new window.Chess(p.fen);
    var solverColor = chess.turn(); // FEN is always solver-to-move
    state = {
      puzzle: p,
      chess: chess,
      startFen: p.fen,
      stepIndex: 0,          // index into p.moves; even = solver to move
      solverColor: solverColor,
      orientation: solverColor,
      selected: null,
      targets: null,
      lastMove: null,
      hintSquares: null,
      solved: false,
      busy: false,
      punished: false,       // true after a wrong move's refutation is on the board
    };
    refs.title.textContent = p.title || 'Find the best move';
    refs.streak.style.display = 'none';
    updateBadges(p);
    refs.btnNext.style.display = (mode === 'trainer') ? '' : 'none';
    refs.btnUndo.disabled = true;
    refs.btnHint.disabled = false;
    setStatus(solverColor === 'w' ? 'White to play — find the best move.' : 'Black to play — find the best move.');
    renderBoard();
  }

  // Square interaction: click-to-select then click-to-move.
  function onSquareClick(e) {
    if (!state || state.solved || state.busy) return;
    if (state.punished) return; // must Undo/Retry first
    var sq = e.currentTarget.getAttribute('data-sq');
    var chess = state.chess;
    // If it's not the solver's turn (mid auto-reply), ignore.
    if (chess.turn() !== state.solverColor) return;

    if (state.selected) {
      // Attempt a move from selected -> sq.
      if (sq === state.selected) { clearSelection(); renderBoard(); return; }
      var legal = chess.moves({ square: state.selected, verbose: true });
      var match = null;
      for (var i = 0; i < legal.length; i++) { if (legal[i].to === sq) { match = legal[i]; break; } }
      if (match) { handleSolverMove(state.selected, sq, match); return; }
      // Not a legal target — maybe reselect another own piece.
      var pc = chess.get(sq);
      if (pc && pc.color === state.solverColor) { selectSquare(sq); renderBoard(); return; }
      clearSelection(); renderBoard(); return;
    }
    // No selection yet: select an own piece.
    var piece = chess.get(sq);
    if (piece && piece.color === state.solverColor) { selectSquare(sq); renderBoard(); }
  }

  function selectSquare(sq) {
    state.selected = sq;
    var moves = state.chess.moves({ square: sq, verbose: true });
    state.targets = moves.map(function (m) { return m.to; });
    state.hintSquares = null;
  }
  function clearSelection() { state.selected = null; state.targets = null; }

  // Need a promotion? For solver moves, default to the move required by the
  // solution if it's a promotion; otherwise queen.
  function neededPromotion(from, to) {
    var expected = expectedSolverUci();
    if (expected && expected.slice(0, 2) === from && expected.slice(2, 4) === to && expected.length > 4) {
      return expected.slice(4);
    }
    return 'q';
  }

  function expectedSolverUci() {
    var mv = state.puzzle.moves[state.stepIndex];
    return mv || null;
  }

  function handleSolverMove(from, to, legalMove) {
    clearSelection();
    var promo = (legalMove.flags && legalMove.flags.indexOf('p') >= 0) ? neededPromotion(from, to) : undefined;
    var expected = expectedSolverUci();
    var playedUci = from + to + (promo || '');
    // Normalize expected (it may or may not carry a promotion letter).
    var correct = expected && (playedUci === expected ||
      (expected.length === 4 && playedUci.slice(0, 4) === expected));

    if (correct) {
      var mv = state.chess.move({ from: from, to: to, promotion: promo });
      state.lastMove = { from: from, to: to };
      state.hintSquares = null;
      renderBoard();
      state.stepIndex++;
      // Solved if we've consumed the whole line.
      if (state.stepIndex >= state.puzzle.moves.length) {
        onSolved();
        return;
      }
      // Otherwise auto-play the scripted opponent reply, then it's solver again.
      setStatus('Correct! …', 'ok');
      autoPlayOpponentReply();
    } else {
      // WRONG move: PUNISH THEN RETRY.
      punishWrongMove(from, to, promo);
    }
  }

  // Auto-play the puzzle's scripted opponent reply (odd index in moves).
  function autoPlayOpponentReply() {
    state.busy = true;
    var replyUci = state.puzzle.moves[state.stepIndex];
    setTimeout(function () {
      if (!state) return;
      if (replyUci) {
        var mv = state.chess.move({ from: replyUci.slice(0, 2), to: replyUci.slice(2, 4), promotion: replyUci.length > 4 ? replyUci.slice(4) : undefined });
        if (mv) { state.lastMove = { from: mv.from, to: mv.to }; }
        state.stepIndex++;
      }
      state.busy = false;
      renderBoard();
      if (state.stepIndex >= state.puzzle.moves.length) { onSolved(); return; }
      setStatus((state.solverColor === 'w' ? 'White' : 'Black') + ' to play — keep going.');
    }, 350);
  }

  // The player blundered. Let the engine play a strong refutation so the
  // consequence is visible, then require Undo/Retry to restore the position.
  function punishWrongMove(from, to, promo) {
    var beforeFen = state.chess.fen();
    var mv = state.chess.move({ from: from, to: to, promotion: promo });
    if (!mv) { return; } // shouldn't happen (we validated legality)
    state.lastMove = { from: from, to: to };
    state.preMistakeFen = beforeFen;
    state.busy = true;
    state.hintSquares = null;
    renderBoard();
    setStatus('Not the move — watch the consequence…', 'bad');

    // Pick the engine's best reply for the opponent (the punish). Prefer the
    // app engine; fall back to a simple capture/any-legal if unavailable.
    var fen = state.chess.fen();
    setTimeout(function () {
      if (!state) return;
      var reply = pickPunishReply(fen);
      if (reply) {
        var rm = state.chess.move(reply);
        if (rm) state.lastMove = { from: rm.from, to: rm.to };
      }
      state.busy = false;
      state.punished = true;
      refs.btnUndo.disabled = false;
      refs.btnHint.disabled = true;
      renderBoard();
      var lost = describeLoss(reply);
      setStatus('Wrong move — ' + lost + ' Press “Undo / Retry”.', 'bad');
    }, 420);
  }

  function pickPunishReply(fen) {
    try {
      if (window.CT_AI && typeof window.CT_AI.bestMove === 'function') {
        var r = window.CT_AI.bestMove(fen, 2);
        if (r && r.move) return { from: r.move.from, to: r.move.to, promotion: r.move.promotion };
      }
    } catch (e) {}
    // Fallback: prefer the highest-value capture, else any legal move.
    try {
      var c = new window.Chess(fen);
      var moves = c.moves({ verbose: true });
      if (!moves.length) return null;
      var val = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
      moves.sort(function (a, b) { return (val[b.captured] || 0) - (val[a.captured] || 0); });
      var m = moves[0];
      return { from: m.from, to: m.to, promotion: m.promotion };
    } catch (e) { return null; }
  }

  function describeLoss(reply) {
    if (reply) {
      try {
        var c = new window.Chess(state.preMistakeFen);
        // Re-derive what was captured by replaying the wrong move + reply is
        // overkill; just give a generic but honest message.
      } catch (e) {}
    }
    return 'the opponent gets a strong reply.';
  }

  function onUndo() {
    if (!state) return;
    // Restore the pre-mistake position (where the solver is to move).
    var fen = state.preMistakeFen || state.startFen;
    state.chess = new window.Chess(fen);
    state.punished = false;
    state.busy = false;
    state.selected = null;
    state.targets = null;
    state.lastMove = null;
    state.hintSquares = null;
    refs.btnUndo.disabled = true;
    refs.btnHint.disabled = false;
    renderBoard();
    setStatus((state.solverColor === 'w' ? 'White' : 'Black') + ' to play — try again.');
  }

  function onHint() {
    if (!state || state.solved || state.busy || state.punished) return;
    var expected = expectedSolverUci();
    if (!expected) return;
    // First hint: highlight the from-square. (The status also shows the text hint.)
    state.hintSquares = [expected.slice(0, 2), expected.slice(2, 4)];
    renderBoard();
    var h = state.puzzle.hint;
    setStatus(h ? ('Hint: ' + h) : 'Hint: move the highlighted piece.');
  }

  function onNext() {
    if (mode === 'trainer') { loadTrainer(lastTrainerRating); }
    else { loadDaily(); }
  }

  function onSolved() {
    state.solved = true;
    state.selected = null; state.targets = null; state.hintSquares = null;
    refs.btnUndo.disabled = true;
    refs.btnHint.disabled = true;
    renderBoard();
    refs.board.classList.add('solved');
    setTimeout(function () { if (refs.board) refs.board.classList.remove('solved'); }, 600);
    setStatus('Solved! Well done. ✓', 'win');

    var p = state.puzzle;
    // Fire the app callback if present.
    try {
      if (typeof window.CT_onPuzzleSolved === 'function') {
        window.CT_onPuzzleSolved(p.id, { rating: p.rating, theme: p.theme });
      }
    } catch (e) {}
    // Best-effort server record (auth-gated; ignore failures / unauthenticated).
    recordSolved(p.id);
  }

  function recordSolved(puzzleId) {
    var token = authToken();
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    try {
      fetch(apiUrl('/api/puzzles/solved'), {
        method: 'POST', headers: headers, body: JSON.stringify({ puzzleId: puzzleId }),
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (data && typeof data.currentStreak === 'number' && data.currentStreak > 0) {
            updateBadges(state.puzzle, data.currentStreak);
          }
        }).catch(function () {});
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // LOADING (fetch from backend)
  // ---------------------------------------------------------------------------
  function loadDaily() {
    mode = 'daily';
    setStatus('Loading today’s puzzle…');
    fetch(apiUrl('/api/puzzles/daily')).then(function (r) {
      if (!r.ok) throw new Error('daily ' + r.status);
      return r.json();
    }).then(function (data) {
      if (!data || !data.puzzle) throw new Error('no puzzle');
      startPuzzle(data.puzzle);
      refreshStreakBadge();
    }).catch(function () {
      setStatus('Could not load the daily puzzle. Check your connection.', 'bad');
    });
  }

  function loadTrainer(rating) {
    mode = 'trainer';
    lastTrainerRating = rating || lastTrainerRating || 1200;
    setStatus('Loading a puzzle…');
    var exclude = playedIds.slice(-20).join(',');
    var url = apiUrl('/api/puzzles/next?rating=' + encodeURIComponent(lastTrainerRating) +
      (exclude ? '&exclude=' + encodeURIComponent(exclude) : ''));
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('next ' + r.status);
      return r.json();
    }).then(function (data) {
      if (!data || !data.puzzle) throw new Error('no puzzle');
      playedIds.push(data.puzzle.id);
      startPuzzle(data.puzzle);
      refreshStreakBadge();
    }).catch(function () {
      setStatus('Could not load a puzzle. Check your connection.', 'bad');
    });
  }

  // Pull the user's current streak (auth) to show on the badge, best-effort.
  function refreshStreakBadge() {
    var token = authToken();
    if (!token) return;
    try {
      fetch(apiUrl('/api/puzzles/progress'), { headers: { Authorization: 'Bearer ' + token } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (data && typeof data.currentStreak === 'number' && data.currentStreak > 0 && state) {
            updateBadges(state.puzzle, data.currentStreak);
          }
        }).catch(function () {});
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------
  function init(mountSelector) {
    var target = resolveMount(mountSelector);
    if (!target) return false;
    if (initialized && mountEl === target) return true;
    mountEl = target;
    buildUI();
    initialized = true;
    return true;
  }

  function openDaily() {
    if (!initialized && !init()) { return; }
    loadDaily();
  }

  function openTrainer(rating) {
    if (!initialized && !init()) { return; }
    playedIds = [];
    loadTrainer(typeof rating === 'number' ? rating : lastTrainerRating);
  }

  window.CT_Puzzles = {
    init: init,
    openDaily: openDaily,
    openTrainer: openTrainer,
  };
})();
