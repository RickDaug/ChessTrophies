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
  var mode = 'daily';        // 'daily' | 'trainer' | 'rush'
  var lastTrainerRating = 1200;
  var playedIds = [];        // trainer: ids served this session (for "Next")
  var myPuzzleRating = null; // the signed-in user's current puzzle rating
  var rush = null;           // active rush run (see startRush)

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

    // Mode segmented control: Daily | Trainer | Rush.
    var seg = el('div', 'ctp-seg');
    refs.segDaily = el('button', 'ctp-seg-btn', 'Daily');
    refs.segTrainer = el('button', 'ctp-seg-btn', 'Trainer');
    refs.segRush = el('button', 'ctp-seg-btn', 'Rush');
    refs.segDaily.type = 'button'; refs.segTrainer.type = 'button'; refs.segRush.type = 'button';
    refs.segDaily.setAttribute('data-mode', 'daily');
    refs.segTrainer.setAttribute('data-mode', 'trainer');
    refs.segRush.setAttribute('data-mode', 'rush');
    seg.appendChild(refs.segDaily); seg.appendChild(refs.segTrainer); seg.appendChild(refs.segRush);
    wrap.appendChild(seg);

    // Your puzzle rating — shown prominently above the board, with a +/- chip
    // that flashes after each scored result.
    var ratingRow = el('div', 'ctp-ratingrow');
    var rlabel = el('span', 'ctp-rating-label', 'Your puzzle rating');
    refs.myRating = el('span', 'ctp-rating-val', '—');
    refs.ratingDelta = el('span', 'ctp-rating-delta', '');
    ratingRow.appendChild(rlabel); ratingRow.appendChild(refs.myRating); ratingRow.appendChild(refs.ratingDelta);
    wrap.appendChild(ratingRow);

    // ----- PLAY view (daily / trainer / rush-in-progress board) -------------
    refs.playView = el('div', 'ctp-playview');

    // Header: title + rating/theme badges
    var header = el('div', 'ctp-header');
    refs.title = el('div', 'ctp-title', 'Puzzle');
    var badges = el('div', 'ctp-badges');
    refs.rating = el('span', 'ctp-badge ctp-badge-rating', '');
    refs.theme = el('span', 'ctp-badge ctp-badge-theme', '');
    refs.streak = el('span', 'ctp-badge ctp-badge-streak', '');
    badges.appendChild(refs.rating); badges.appendChild(refs.theme); badges.appendChild(refs.streak);
    header.appendChild(refs.title); header.appendChild(badges);
    refs.playView.appendChild(header);

    // Rush HUD (timer + score + best) — only visible during a rush run.
    refs.rushHud = el('div', 'ctp-rushhud');
    refs.rushHud.style.display = 'none';
    refs.rushTimer = el('div', 'ctp-rush-stat');
    refs.rushScore = el('div', 'ctp-rush-stat');
    refs.rushStrikes = el('div', 'ctp-rush-stat');
    refs.rushHud.appendChild(refs.rushTimer);
    refs.rushHud.appendChild(refs.rushScore);
    refs.rushHud.appendChild(refs.rushStrikes);
    refs.playView.appendChild(refs.rushHud);

    // Status line (turn / feedback)
    refs.status = el('div', 'ctp-status', 'Loading…');
    refs.playView.appendChild(refs.status);

    // Board
    refs.board = el('div', 'ctp-board');
    refs.playView.appendChild(refs.board);

    // Controls
    var controls = el('div', 'ctp-controls');
    refs.btnHint = el('button', 'ctp-btn ctp-hint', 'Hint');
    refs.btnUndo = el('button', 'ctp-btn ctp-undo', 'Undo / Retry');
    refs.btnNext = el('button', 'ctp-btn ctp-next', 'Next puzzle');
    refs.btnHint.type = 'button'; refs.btnUndo.type = 'button'; refs.btnNext.type = 'button';
    controls.appendChild(refs.btnHint);
    controls.appendChild(refs.btnUndo);
    controls.appendChild(refs.btnNext);
    refs.playView.appendChild(controls);

    // ----- DAILY "done for today" panel -------------------------------------
    // Shown only after the DAILY puzzle is solved. The daily has no "Next"
    // (it's one per day), which left players — especially newcomers — unsure
    // what to do next. This makes the end-of-daily explicit and points them
    // straight at the other things to play.
    refs.dailyDone = el('div', 'ctp-dailydone');
    refs.dailyDone.style.display = 'none';
    refs.dailyDoneTitle = el('div', 'ctp-dd-title', '✅ Daily puzzle complete!');
    refs.dailyDoneMsg = el('div', 'ctp-dd-msg',
      'That’s today’s puzzle done. A fresh one unlocks tomorrow — keep the streak alive!');
    var ddActions = el('div', 'ctp-dd-actions');
    refs.btnDdTrainer = el('button', 'ctp-btn ctp-dd-btn', '🧩 Keep training');
    refs.btnDdRush = el('button', 'ctp-btn ctp-dd-btn', '⚡ Puzzle Rush');
    refs.btnDdHome = el('button', 'ctp-btn ctp-dd-btn ctp-dd-home', '♟ Play a game');
    refs.btnDdTrainer.type = 'button'; refs.btnDdRush.type = 'button'; refs.btnDdHome.type = 'button';
    ddActions.appendChild(refs.btnDdTrainer);
    ddActions.appendChild(refs.btnDdRush);
    ddActions.appendChild(refs.btnDdHome);
    refs.dailyDone.appendChild(refs.dailyDoneTitle);
    refs.dailyDone.appendChild(refs.dailyDoneMsg);
    refs.dailyDone.appendChild(ddActions);
    refs.playView.appendChild(refs.dailyDone);

    wrap.appendChild(refs.playView);

    // ----- RUSH start / result view -----------------------------------------
    refs.rushView = el('div', 'ctp-rushview');
    refs.rushView.style.display = 'none';
    var rushTitle = el('div', 'ctp-title', '⚡ Puzzle Rush');
    var rushBlurb = el('div', 'ctp-rush-blurb', 'Solve as many puzzles as you can in 3 minutes. Three wrong moves ends the run. Difficulty ramps as you go.');
    refs.rushBestLine = el('div', 'ctp-rush-best', 'Personal best: —');
    refs.rushResult = el('div', 'ctp-rush-result', '');
    refs.btnRushStart = el('button', 'ctp-btn ctp-rush-start', 'Start Rush');
    refs.btnRushStart.type = 'button';
    refs.rushView.appendChild(rushTitle);
    refs.rushView.appendChild(rushBlurb);
    refs.rushView.appendChild(refs.rushBestLine);
    refs.rushView.appendChild(refs.rushResult);
    refs.rushView.appendChild(refs.btnRushStart);
    wrap.appendChild(refs.rushView);

    mountEl.appendChild(wrap);

    injectStyles();

    // CSP-safe: addEventListener, no inline handlers.
    refs.btnHint.addEventListener('click', onHint);
    refs.btnUndo.addEventListener('click', onUndo);
    refs.btnNext.addEventListener('click', onNext);
    refs.btnRushStart.addEventListener('click', startRush);
    seg.addEventListener('click', onSegClick);
    refs.btnDdTrainer.addEventListener('click', function () { hideDailyDone(); openTrainer(); });
    refs.btnDdRush.addEventListener('click', function () { hideDailyDone(); openRush(); });
    refs.btnDdHome.addEventListener('click', function () { hideDailyDone(); goHome(); });
  }

  // Leave the puzzles screen for the main lobby (the "Play" hub). CSP-safe:
  // drive the existing bottom-nav item so the app's own showScreen runs.
  function goHome() {
    var nav = document.querySelector('#bottom-nav .nav-item[data-nav="lobby"]');
    if (nav) { nav.click(); return; }
    try { if (typeof window.CT_showScreen === 'function') window.CT_showScreen('lobby'); } catch (e) {}
  }

  function hideDailyDone() {
    if (refs.dailyDone) refs.dailyDone.style.display = 'none';
  }

  // Show the end-of-daily panel, tailoring the message to the live streak.
  function showDailyDone(streak) {
    if (!refs.dailyDone) return;
    if (typeof streak === 'number' && streak > 0) {
      refs.dailyDoneMsg.textContent = 'That’s today’s puzzle done — ' + streak + '-day streak! 🔥 ' +
        'Come back tomorrow for a new one. Until then, try these:';
    } else {
      refs.dailyDoneMsg.textContent = 'That’s today’s puzzle done. A fresh one unlocks tomorrow. ' +
        'Want to keep playing? Try these:';
    }
    refs.dailyDone.style.display = '';
  }

  // Segmented control: switch between daily / trainer / rush.
  function onSegClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('.ctp-seg-btn') : null;
    if (!btn) return;
    var m = btn.getAttribute('data-mode');
    if (m === 'daily') openDaily();
    else if (m === 'trainer') openTrainer();
    else if (m === 'rush') openRush();
  }

  function setActiveSeg(m) {
    [refs.segDaily, refs.segTrainer, refs.segRush].forEach(function (b) {
      if (!b) return;
      if (b.getAttribute('data-mode') === m) b.classList.add('active');
      else b.classList.remove('active');
    });
  }

  // Toggle between the play board view and the rush start/result view.
  function showRushView(show) {
    if (refs.playView) refs.playView.style.display = show ? 'none' : '';
    if (refs.rushView) refs.rushView.style.display = show ? '' : 'none';
    if (show) hideDailyDone();
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
      // segmented control
      '.ctp-seg{display:flex;gap:4px;background:rgba(127,127,127,.14);padding:4px;border-radius:10px;margin-bottom:10px}',
      '.ctp-seg-btn{flex:1;padding:8px;border:none;border-radius:7px;background:transparent;color:inherit;font-weight:600;cursor:pointer;font-size:14px}',
      '.ctp-seg-btn.active{background:#3b6ea5;color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2)}',
      // rating row
      '.ctp-ratingrow{display:flex;align-items:baseline;gap:8px;margin-bottom:10px;flex-wrap:wrap}',
      '.ctp-rating-label{font-size:12px;opacity:.7}',
      '.ctp-rating-val{font-size:26px;font-weight:800;line-height:1;color:#3b6ea5}',
      '.ctp-rating-delta{font-size:15px;font-weight:700;min-width:36px}',
      '.ctp-rating-delta.up{color:#2e9e5b}',
      '.ctp-rating-delta.down{color:#d4504a}',
      '.ctp-rating-delta.flash{animation:ctp-flash .9s ease}',
      '@keyframes ctp-flash{0%{transform:translateY(6px) scale(.8);opacity:0}30%{transform:translateY(0) scale(1.15);opacity:1}100%{transform:none;opacity:1}}',
      // rush HUD
      '.ctp-rushhud{display:flex;gap:8px;margin:2px 0 8px}',
      '.ctp-rush-stat{flex:1;text-align:center;padding:6px 4px;border-radius:8px;background:rgba(127,127,127,.14);font-weight:700;font-size:14px}',
      '.ctp-rush-stat.warn{background:rgba(212,80,74,.18);color:#d4504a}',
      // rush start/result view
      '.ctp-rush-blurb{font-size:14px;opacity:.85;margin:8px 0;line-height:1.4}',
      '.ctp-rush-best{font-size:15px;font-weight:700;margin:6px 0}',
      '.ctp-rush-result{font-size:16px;font-weight:700;margin:8px 0;min-height:22px}',
      '.ctp-rush-result.win{color:#2e9e5b}',
      '.ctp-btn.ctp-rush-start{background:#b8484a;max-width:240px}',
      // daily "done for today" panel
      '.ctp-dailydone{margin-top:14px;padding:14px;border-radius:12px;background:rgba(46,158,91,.12);border:1px solid rgba(46,158,91,.35);text-align:center;animation:ctp-flash .5s ease}',
      '.ctp-dd-title{font-weight:800;font-size:17px;color:#2e9e5b;margin-bottom:4px}',
      '.ctp-dd-msg{font-size:14px;opacity:.9;line-height:1.45;margin-bottom:12px}',
      '.ctp-dd-actions{display:flex;gap:8px;flex-wrap:wrap}',
      '.ctp-dd-btn{flex:1;min-width:120px}',
      '.ctp-dd-btn.ctp-dd-home{background:#2e9e5b}',
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

  // Render the big "Your puzzle rating" value.
  function renderMyRating() {
    if (!refs.myRating) return;
    refs.myRating.textContent = (myPuzzleRating == null) ? '—' : String(myPuzzleRating);
  }

  // Flash the +/- delta chip after a scored result. delta may be 0 (no change).
  function flashRatingDelta(delta) {
    if (!refs.ratingDelta) return;
    if (!delta) { refs.ratingDelta.textContent = ''; refs.ratingDelta.className = 'ctp-rating-delta'; return; }
    var up = delta > 0;
    refs.ratingDelta.textContent = (up ? '+' : '') + delta;
    refs.ratingDelta.className = 'ctp-rating-delta ' + (up ? 'up' : 'down');
    // restart the flash animation
    void refs.ratingDelta.offsetWidth;
    refs.ratingDelta.classList.add('flash');
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
      failReported: false,    // true once we've reported a fail to the server
      solverMoves: [],        // the solver's correct UCI plies, in order — this is
                              // the proof-of-solve we POST to /solved for the
                              // server to re-verify against the stored solution.
    };
    hideDailyDone();
    refs.title.textContent = p.title || 'Find the best move';
    refs.streak.style.display = 'none';
    updateBadges(p);
    // "Next puzzle" is only for the trainer; daily has none, rush auto-advances.
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

    // ALTERNATIVE MATE: on the FINAL move of a MATE puzzle, accept ANY move that
    // delivers checkmate — not only the scripted one (e.g. Qh5# and Qh1# both mate;
    // a Q- or R-promotion can both mate). We relax this ONLY when the puzzle's own
    // scripted last move is itself a checkmate, so non-mate puzzles (a single best
    // move winning material, a quiet move) keep their unique required answer.
    if (!correct && expected && window.Chess &&
        state.stepIndex === state.puzzle.moves.length - 1) {
      try {
        var fenNow = state.chess.fen();
        var tUser = new window.Chess(fenNow);
        var userMv = tUser.move({ from: from, to: to, promotion: promo });
        if (userMv && tUser.in_checkmate()) {
          var tExp = new window.Chess(fenNow);
          var expMv = tExp.move({
            from: expected.slice(0, 2),
            to: expected.slice(2, 4),
            promotion: expected.length > 4 ? expected.slice(4) : undefined,
          });
          if (expMv && tExp.in_checkmate()) correct = true;
        }
      } catch (e) { /* fall through as incorrect */ }
    }

    // PLAYABLE OFF-LINE MOVE (non-mate puzzles): if the player makes a legal move
    // that is NOT the scripted one but is also NOT a blunder, don't tell them
    // they're "wrong". Mirror the OPENING TRAINER's honest framing: acknowledge it
    // as playable, but ask them to follow this puzzle's scripted line. We only do
    // this for non-mate puzzles (mate puzzles already accept any mate above, and a
    // non-mating move there genuinely fails the objective). RUSH keeps its strict
    // strike rule (a real solve sprint), so this leniency is daily/trainer only.
    if (!correct && expected && mode !== 'rush' && isPlayableOffLineMove(from, to, promo)) {
      acknowledgePlayableMove(from, to, promo);
      return;
    }

    if (correct) {
      var mv = state.chess.move({ from: from, to: to, promotion: promo });
      state.lastMove = { from: from, to: to };
      state.hintSquares = null;
      // Record this correct solver ply as part of the proof-of-solve line we'll
      // submit to /solved. Use the EXPECTED token so it always matches the stored
      // solution's promotion spelling (the played token may omit/normalize it).
      state.solverMoves.push(expected);
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
      // RUSH: a wrong move is a STRIKE — no retry, the run marches on.
      if (mode === 'rush' && rush && !rush.over) { rushStrike(); return; }
      // WRONG move: PUNISH THEN RETRY.
      punishWrongMove(from, to, promo);
    }
  }

  // Is a legal, non-scripted solver move SOUND (not a blunder) on a NON-MATE
  // puzzle? We compare, from the SOLVER's point of view, the eval after the
  // player's move against the eval after the scripted move using the in-app
  // engine (CT_AI.evaluate, white-positive centipawns, mate ≈ ±99999). If the
  // player's move keeps essentially the same advantage as the scripted line
  // (within a CONSERVATIVE margin) it's "playable"; if it throws material/the win
  // it stays a wrong move and gets punished as before.
  //
  // Conservative by design — never accept an actual blunder as playable:
  //   • Mate puzzles are excluded (the scripted final move mates; the unique-mate
  //     branch already handles legitimate alternative mates, and a non-mating move
  //     there really does fail the puzzle's objective).
  //   • If the engine is unavailable, return false (fall back to strict checking).
  var PLAYABLE_MARGIN_CP = 90; // ≈ less than a third of a pawn slack
  function isPlayableOffLineMove(from, to, promo) {
    try {
      if (!window.CT_AI || typeof window.CT_AI.evaluate !== 'function' || !window.Chess) return false;
      var p = state.puzzle;
      if (!p || p.theme === 'mate') return false;
      // Only relax on the puzzle's FINAL solver move would be too narrow; relax on
      // ANY solver ply, but only when the scripted move itself isn't a checkmate
      // (a forced mate line must be followed exactly).
      var fenNow = state.chess.fen();
      var solverIsWhite = (state.solverColor === 'w');
      var sign = solverIsWhite ? 1 : -1;

      // Eval after the SCRIPTED move (the baseline the puzzle expects).
      var expected = expectedSolverUci();
      var tExp = new window.Chess(fenNow);
      var expMv = tExp.move({ from: expected.slice(0, 2), to: expected.slice(2, 4), promotion: expected.length > 4 ? expected.slice(4) : undefined });
      if (!expMv) return false;
      if (tExp.in_checkmate()) return false; // scripted move mates → must be exact
      var evalExp = sign * window.CT_AI.evaluate(tExp.fen(), 2);

      // Eval after the PLAYER's move.
      var tUsr = new window.Chess(fenNow);
      var usrMv = tUsr.move({ from: from, to: to, promotion: promo });
      if (!usrMv) return false;
      var evalUsr = sign * window.CT_AI.evaluate(tUsr.fen(), 2);

      // Playable iff the player's move keeps essentially the scripted advantage
      // (loses no more than the small margin). This rejects moves that drop
      // material or surrender a winning eval, but accepts a genuinely equivalent
      // alternative.
      return (evalExp - evalUsr) <= PLAYABLE_MARGIN_CP;
    } catch (e) { return false; }
  }

  // Acknowledge a sound off-line move WITHOUT punishing it: play it briefly so the
  // player sees it land, then revert and ask them to follow the puzzle's scripted
  // line (so the rest of the recorded solution stays on rails). Mirrors the
  // opening trainer's "that's playable — but this drill follows one line" pattern.
  // Does NOT record a fail and does NOT lower the rating.
  function acknowledgePlayableMove(from, to, promo) {
    clearSelection();
    var beforeFen = state.chess.fen();
    var mv = state.chess.move({ from: from, to: to, promotion: promo });
    if (!mv) { punishWrongMove(from, to, promo); return; }
    state.lastMove = { from: from, to: to };
    state.busy = true;
    state.hintSquares = null;
    renderBoard();
    var expSan = sanForUci(beforeFen, expectedSolverUci());
    setStatus('That’s playable — but this puzzle follows one line. It continues ' + (expSan || '…') + '.', 'bad');
    refs.btnHint.disabled = true;
    setTimeout(function () {
      if (!state) return;
      state.chess = new window.Chess(beforeFen);
      state.busy = false;
      state.selected = null;
      state.targets = null;
      state.lastMove = null;
      // Leave a hint on the scripted move so they can stay in the line.
      var e = expectedSolverUci();
      state.hintSquares = e ? [e.slice(0, 2), e.slice(2, 4)] : null;
      refs.btnHint.disabled = false;
      renderBoard();
      setStatus('Play ' + (expSan || 'the puzzle move') + ' to follow this line.', 'bad');
    }, 900);
  }

  // SAN label for a UCI token from a given FEN (best-effort, for status text).
  function sanForUci(fen, uci) {
    if (!uci) return null;
    try {
      var c = new window.Chess(fen);
      var m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4) : undefined });
      return m ? m.san : null;
    } catch (e) { return null; }
  }

  // A wrong move during a rush run: count a strike, end the run at the limit,
  // else advance to the next puzzle.
  function rushStrike() {
    state.solved = true; // freeze this board
    rush.strikes++;
    updateRushHud();
    if (rush.strikes >= RUSH_MAX_STRIKES) {
      setStatus('Strike ' + rush.strikes + ' — out!', 'bad');
      setTimeout(function () { endRush('3 strikes.'); }, 400);
      return;
    }
    setStatus('Wrong — strike ' + rush.strikes + '/' + RUSH_MAX_STRIKES + '. Next…', 'bad');
    setTimeout(function () { if (rush && !rush.over) nextRushPuzzle(); }, 500);
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
    // Report the FAIL to the server (once per puzzle session). It lowers the
    // rating and is idempotent per puzzle/UTC-day, so the Undo/Retry loop can't
    // double-penalize, and if the player later solves THIS puzzle today that
    // solve is a no-op for the rating (already scored as a fail). Daily/trainer
    // only — rush handles its own scoring.
    if (!state.failReported && mode !== 'rush') {
      state.failReported = true;
      recordFailed(state.puzzle.id);
    }
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
    if (mode === 'trainer') { loadTrainer(); }   // adaptive (server reads rating)
    else if (mode === 'rush') { /* rush auto-advances */ }
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

    var p = state.puzzle;
    var line = state.solverMoves.slice();

    // RUSH: tally the solve, collect its verified line for the end-of-run
    // submission, and immediately serve the next (harder) puzzle.
    if (mode === 'rush' && rush && !rush.over) {
      rush.score++;
      rush.solved.push({ puzzleId: p.id, moves: line });
      updateRushHud();
      setStatus('Solved! ✓ Next…', 'win');
      setTimeout(function () { if (rush && !rush.over) nextRushPuzzle(); }, 350);
      return;
    }

    setStatus('Solved! Well done. ✓', 'win');
    // DAILY: there's only one puzzle a day, so make the end explicit and point
    // the player at what else they can do (refined with the streak once the
    // server confirms it in recordSolved).
    if (mode === 'daily') showDailyDone();
    // Fire the app callback if present.
    try {
      if (typeof window.CT_onPuzzleSolved === 'function') {
        window.CT_onPuzzleSolved(p.id, { rating: p.rating, theme: p.theme });
      }
    } catch (e) {}
    // Best-effort server record (auth-gated; ignore failures / unauthenticated).
    // Submit the solver's move line so the server can VERIFY the solve before it
    // advances the streak — a bare id is no longer accepted.
    recordSolved(p.id, line);
  }

  function recordSolved(puzzleId, moves) {
    var token = authToken();
    if (!token) return;
    var headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    try {
      fetch(apiUrl('/api/puzzles/solved'), {
        method: 'POST', headers: headers,
        body: JSON.stringify({ puzzleId: puzzleId, moves: moves || [] }),
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data) return;
          if (state && typeof data.currentStreak === 'number' && data.currentStreak > 0) {
            updateBadges(state.puzzle, data.currentStreak);
            // Refine the daily "done" message with the confirmed streak.
            if (mode === 'daily' && refs.dailyDone && refs.dailyDone.style.display !== 'none') {
              showDailyDone(data.currentStreak);
            }
          }
          // Show the new per-user puzzle rating + the climb.
          if (typeof data.puzzleRating === 'number') {
            myPuzzleRating = data.puzzleRating;
            renderMyRating();
            flashRatingDelta(data.ratingDelta || 0);
          }
        }).catch(function () {});
    } catch (e) {}
  }

  // Report a FAILED puzzle to the server (lowers the rating; idempotent/day).
  // Called when the player gives up (skips after a mistake) — never spammed.
  function recordFailed(puzzleId) {
    var token = authToken();
    if (!token) return;
    var headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    try {
      fetch(apiUrl('/api/puzzles/failed'), {
        method: 'POST', headers: headers,
        body: JSON.stringify({ puzzleId: puzzleId }),
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || typeof data.puzzleRating !== 'number') return;
          myPuzzleRating = data.puzzleRating;
          renderMyRating();
          flashRatingDelta(data.ratingDelta || 0);
        }).catch(function () {});
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // LOADING (fetch from backend)
  // ---------------------------------------------------------------------------
  function abortRush() {
    if (rush && rush.timer) { clearInterval(rush.timer); rush.timer = null; }
    rush = null;
  }

  function loadDaily() {
    mode = 'daily';
    abortRush();
    setActiveSeg('daily');
    showRushView(false);
    if (refs.rushHud) refs.rushHud.style.display = 'none';
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
    abortRush();
    setActiveSeg('trainer');
    showRushView(false);
    if (refs.rushHud) refs.rushHud.style.display = 'none';
    setStatus('Loading a puzzle…');
    var exclude = playedIds.slice(-20).join(',');
    // No explicit rating -> let the SERVER adapt to the signed-in user's rating
    // (it reads the auth token). Pass an explicit rating only if one was given.
    var ratingParam = (typeof rating === 'number') ? ('rating=' + encodeURIComponent(rating) + '&') : '';
    if (typeof rating === 'number') lastTrainerRating = rating;
    var token = authToken();
    var url = apiUrl('/api/puzzles/next?' + ratingParam +
      (exclude ? 'exclude=' + encodeURIComponent(exclude) : ''));
    fetch(url, token ? { headers: { Authorization: 'Bearer ' + token } } : undefined).then(function (r) {
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

  // Pull the user's progress (auth): streak badge + the puzzle rating + the rush
  // best. Best-effort; guests just see "—" for the rating.
  function refreshStreakBadge() {
    var token = authToken();
    if (!token) { renderMyRating(); return; }
    try {
      fetch(apiUrl('/api/puzzles/progress'), { headers: { Authorization: 'Bearer ' + token } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data) return;
          if (typeof data.currentStreak === 'number' && data.currentStreak > 0 && state) {
            updateBadges(state.puzzle, data.currentStreak);
          }
          if (typeof data.puzzleRating === 'number') { myPuzzleRating = data.puzzleRating; renderMyRating(); }
          if (typeof data.rushBest === 'number' && refs.rushBestLine) {
            refs.rushBestLine.textContent = 'Personal best: ' + data.rushBest + (data.rushBest === 1 ? ' puzzle' : ' puzzles');
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
    // Pass `rating` through only if explicitly provided; otherwise undefined so
    // the server adapts difficulty to the signed-in user's current rating.
    loadTrainer(typeof rating === 'number' ? rating : undefined);
  }

  // ---------------------------------------------------------------------------
  // PUZZLE RUSH — a timed (3 min) / 3-strikes survival run. Score = puzzles
  // solved. Each solved puzzle's verified solver line is collected and submitted
  // to the server at the end, which RE-VERIFIES every line and tallies the score
  // (so a best can't be forged by claiming solves you didn't make). Difficulty
  // ramps: each next puzzle targets a rating that climbs with the run length.
  // ---------------------------------------------------------------------------
  var RUSH_SECONDS = 180;
  var RUSH_MAX_STRIKES = 3;

  function openRush() {
    if (!initialized && !init()) { return; }
    mode = 'rush';
    abortRush();
    setActiveSeg('rush');
    showRushView(true);
    if (refs.rushHud) refs.rushHud.style.display = 'none';
    if (refs.rushResult) { refs.rushResult.textContent = ''; refs.rushResult.className = 'ctp-rush-result'; }
    refs.btnRushStart.textContent = 'Start Rush';
    refs.btnRushStart.disabled = false;
    refreshStreakBadge(); // refresh best line + rating
  }

  function rushBaseRating() {
    // Start a touch below the player's rating so the run opens gettable, then
    // ramp up. Guests / unknown rating start at 1000.
    return (typeof myPuzzleRating === 'number' ? myPuzzleRating : 1000) - 150;
  }

  function startRush() {
    rush = {
      score: 0,
      strikes: 0,
      solved: [],            // [{puzzleId, moves}] proof lines for the server
      playedIds: [],
      deadline: Date.now() + RUSH_SECONDS * 1000,
      over: false,
      timer: null,
    };
    showRushView(false);
    if (refs.rushHud) refs.rushHud.style.display = '';
    refs.btnNext.style.display = 'none';
    updateRushHud();
    rush.timer = setInterval(tickRush, 250);
    nextRushPuzzle();
  }

  function tickRush() {
    if (!rush || rush.over) return;
    if (Date.now() >= rush.deadline) { endRush('Time!'); return; }
    updateRushHud();
  }

  function updateRushHud() {
    if (!rush || !refs.rushTimer) return;
    var left = Math.max(0, Math.ceil((rush.deadline - Date.now()) / 1000));
    var mm = Math.floor(left / 60), ss = left % 60;
    refs.rushTimer.textContent = '⏱ ' + mm + ':' + (ss < 10 ? '0' : '') + ss;
    refs.rushTimer.className = 'ctp-rush-stat' + (left <= 15 ? ' warn' : '');
    refs.rushScore.textContent = '✓ ' + rush.score;
    var x = rush.strikes;
    refs.rushStrikes.textContent = '✗ ' + x + '/' + RUSH_MAX_STRIKES;
    refs.rushStrikes.className = 'ctp-rush-stat' + (x >= RUSH_MAX_STRIKES - 1 ? ' warn' : '');
  }

  function nextRushPuzzle() {
    if (!rush || rush.over) return;
    // Difficulty ramps with score: +40 rating per solved puzzle.
    var target = Math.round(rushBaseRating() + rush.score * 40);
    target = Math.max(600, Math.min(2600, target));
    var exclude = rush.playedIds.slice(-30).join(',');
    var url = apiUrl('/api/puzzles/next?rating=' + encodeURIComponent(target) +
      (exclude ? '&exclude=' + encodeURIComponent(exclude) : ''));
    setStatus('Loading…');
    fetch(url).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!rush || rush.over) return;
        if (!data || !data.puzzle) { setStatus('Could not load puzzle.', 'bad'); return; }
        rush.playedIds.push(data.puzzle.id);
        startPuzzle(data.puzzle);
        updateRushHud();
      }).catch(function () { if (rush && !rush.over) setStatus('Connection error.', 'bad'); });
  }

  function endRush(reason) {
    if (!rush || rush.over) return;
    rush.over = true;
    if (rush.timer) { clearInterval(rush.timer); rush.timer = null; }
    var finalScore = rush.score;
    var lines = rush.solved.slice();
    showRushView(true);
    if (refs.rushHud) refs.rushHud.style.display = 'none';
    refs.btnRushStart.textContent = 'Play again';
    refs.rushResult.textContent = (reason ? reason + ' ' : '') + 'You solved ' + finalScore + (finalScore === 1 ? ' puzzle.' : ' puzzles.');
    refs.rushResult.className = 'ctp-rush-result win';
    submitRush(lines, finalScore);
  }

  function submitRush(lines, localScore) {
    var token = authToken();
    if (!token) {
      // Guests can play but the best isn't persisted server-side.
      if (refs.rushBestLine) refs.rushBestLine.textContent = 'Sign in to save your best score.';
      return;
    }
    var headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    fetch(apiUrl('/api/puzzles/rush/submit'), {
      method: 'POST', headers: headers,
      body: JSON.stringify({ mode: 'timed', solved: lines }),
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        if (refs.rushBestLine && typeof data.best === 'number') {
          refs.rushBestLine.textContent = 'Personal best: ' + data.best + (data.best === 1 ? ' puzzle' : ' puzzles');
        }
        if (data.isBest && data.score > 0 && data.score >= (localScore || 0)) {
          refs.rushResult.textContent += ' 🏆 New personal best!';
        }
      }).catch(function () {});
  }

  window.CT_Puzzles = {
    init: init,
    openDaily: openDaily,
    openTrainer: openTrainer,
    openRush: openRush,
  };
})();
