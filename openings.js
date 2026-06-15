/* ChessTrophies — Opening Trainer client module.
 *
 * A self-contained, dependency-free module modeled closely on puzzles.js
 * (window.CT_Puzzles). It does NOT edit app.js / index.html; the integration
 * (a <script> tag, a `#screen-openings` container with a `.screen-body`, a
 * `#lobby-openings-card`, and a `showScreen('openings')` hook) is added by glue
 * reported separately. Everything degrades gracefully if the page lacks the
 * container or the chess engine.
 *
 * PUBLIC API (window.CT_Openings):
 *   init(mountSelector)  — render the UI into the container. mountSelector is
 *                          optional; default '#screen-openings' (renders into its
 *                          '.screen-body' child if present, else the element
 *                          itself). Safe to call repeatedly (idempotent).
 *   openTrainer()        — show the opening LIST (mastery bars + "due" badges).
 *   render()             — alias of openTrainer(): (re)render the list view.
 *   drill(openingId)     — start drilling one opening's main line.
 *   renderLobbyCard()    — populate a `#lobby-openings-card` ("N openings due").
 *   dueCount()           — how many openings are currently due for review.
 *
 * ENGINE (already loaded by the page — we never bundle our own):
 *   window.Chess  — chess.js, for legality + board state + SAN parsing.
 *
 * PIECES: we reuse window.CT.pieceSVG (the same Staunton SVG renderer + piece
 * theme as real matches) so the trainer looks identical to games; we fall back
 * to a unicode glyph only if that renderer isn't available.
 *
 * PROGRESS: mirrors how puzzles.js / app.js persist user data. We store progress
 * under state.user.flags.openings[id] = { mastery, lastReviewed, attempts } and
 * persist with the SAME loadDB/saveDB pattern app.js uses (via window.CT), then
 * call window.CT_syncProgress() if present — exactly like recordDailyPlay().
 *
 * PUNISH-THEN-RETRY: the trainer drives a scripted book line. On the user's turn
 * it expects the line's next SAN; on the opponent's turn it auto-plays the line's
 * SAN. A WRONG user move is played on the board (so the mistake is felt), briefly
 * shown as wrong, then auto-reverted so the user can retry the correct move —
 * the same punish-then-retry feel as the puzzle trainer. Completing the whole
 * line cleanly raises mastery and stamps lastReviewed (spaced repetition).
 */
(function () {
  'use strict';

  var FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  var GLYPHS = {
    wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
    bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚',
  };

  // Spaced repetition: an opening is "due" this many days after lastReviewed.
  // Drives the list "due" badges + the lobby card count. Mastery climbs as lines
  // are completed cleanly; lengthens the gap loosely (handled in markCompleted).
  var REVIEW_DAYS = 3;
  var DAY_MS = 24 * 60 * 60 * 1000;

  // ---------------------------------------------------------------------------
  // OPENING BOOK — real, verified theory (every line replayed through chess.js
  // in the build test; see report). Lines are 8–12 ply of solid book moves in
  // SAN. `userColor` is the side the USER plays; on the other side's turn the
  // trainer auto-plays the scripted SAN.
  // ---------------------------------------------------------------------------
  var OPENINGS = [
    {
      id: 'italian',
      name: 'Italian Game',
      eco: 'C50',
      userColor: 'w',
      desc: 'Classical king-pawn opening: develop fast and aim the bishop at f7.',
      line: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O'],
    },
    {
      id: 'ruy-lopez',
      name: 'Ruy López',
      // Closed Ruy mainline (…Nf6 O-O Be7 Re1 b5) is C84/C88 — NOT C70 (which is
      // the Morphy Defence Deferred / open lines without …Be7 Re1).
      eco: 'C84',
      userColor: 'w',
      desc: 'The Spanish: pressure c6 to undermine Black’s center and king-side.',
      line: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5'],
    },
    {
      id: 'sicilian-open',
      name: 'Sicilian Defense — Open',
      // Najdorf with 6.Be2 e5 is the Classical/Opočenský B92 — NOT B90 (which is
      // the English Attack / 6.Be3 family).
      eco: 'B92',
      userColor: 'b',
      desc: 'Black fights for the center asymmetrically and plays for the win.',
      line: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be2', 'e5'],
    },
    {
      id: 'french',
      name: 'French Defense',
      eco: 'C11',
      userColor: 'b',
      desc: 'Solid and resilient: a firm pawn chain and a counterattack on the center.',
      line: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e5', 'Nfd7', 'Bxe7', 'Qxe7'],
    },
    {
      id: 'qgd',
      name: "Queen's Gambit Declined",
      // Classical Bg5 QGD (4.Bg5 Be7 5.e3 O-O) is the Orthodox Defence D63 — NOT
      // D37 (which is the modern 4.Nf3 …line WITHOUT the Bg5 pin).
      eco: 'D63',
      userColor: 'b',
      desc: 'Decline the gambit and build a rock-solid classical structure.',
      line: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'h6'],
    },
    {
      id: 'london',
      name: 'London System',
      eco: 'D02',
      userColor: 'w',
      desc: 'An easy-to-learn system: the Bf4 setup works against almost anything.',
      line: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'e6', 'e3', 'Bd6', 'Bg3', 'O-O', 'Bd3', 'c5'],
    },
    {
      id: 'caro-kann',
      name: 'Caro-Kann Defense, Classical',
      // 3.Nc3 dxe4 4.Nxe4 Bf5 is the Classical (B18); reaching 5.Ng3 Bg6 6.h4 h6
      // is the B19 main line — NOT B15 (which is 3.Nc3 without ...dxe4).
      eco: 'B19',
      userColor: 'b',
      desc: 'Solid like the French but with a free light-squared bishop.',
      line: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6'],
    },
  ];

  function findOpening(id) {
    for (var i = 0; i < OPENINGS.length; i++) { if (OPENINGS[i].id === id) return OPENINGS[i]; }
    return null;
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---------------------------------------------------------------------------
  // PROGRESS — persisted under state.user.flags.openings[id], using the SAME
  // loadDB/saveDB pattern app.js uses (mirrors recordDailyPlay()). Guests still
  // get an in-memory record on the live user object so the UI reacts; it just
  // isn't written to a DB row that doesn't exist for them.
  // ---------------------------------------------------------------------------
  function liveUser() {
    try { if (window.CT && window.CT.user) return window.CT.user; } catch (e) {}
    try { if (window.CT && window.CT.state && window.CT.state.user) return window.CT.state.user; } catch (e) {}
    return null;
  }

  function allProgress() {
    var u = liveUser();
    if (!u) return {};
    u.flags = u.flags || {};
    u.flags.openings = u.flags.openings || {};
    return u.flags.openings;
  }

  function progressFor(id) {
    var all = allProgress();
    return all[id] || { mastery: 0, lastReviewed: null, attempts: 0 };
  }

  // Persist the live user record exactly like app.js (loadDB -> assign -> saveDB
  // -> CT_syncProgress). No-op (but still updates the in-memory object) when the
  // helpers or a DB row aren't available (e.g. guests / standalone tests).
  function persistProgress() {
    var u = liveUser();
    if (!u) return;
    try {
      if (window.CT && typeof window.CT.loadDB === 'function' && typeof window.CT.saveDB === 'function') {
        var db = window.CT.loadDB();
        if (db && db.users && db.users[u.id]) { db.users[u.id] = u; window.CT.saveDB(db); }
      }
    } catch (e) {}
    try { if (typeof window.CT_syncProgress === 'function') window.CT_syncProgress(); } catch (e) {}
  }

  // A completed clean run of the line: raise mastery and stamp the review clock.
  function markCompleted(id) {
    var all = allProgress();
    var p = all[id] || { mastery: 0, lastReviewed: null, attempts: 0 };
    // Mastery climbs toward 100, with diminishing returns so the bar fills over
    // a few clean runs rather than in one (encourages spaced repetition).
    var gain = Math.max(8, Math.round((100 - (p.mastery || 0)) * 0.34));
    p.mastery = Math.min(100, (p.mastery || 0) + gain);
    p.attempts = (p.attempts || 0) + 1;
    p.lastReviewed = Date.now();
    all[id] = p;
    persistProgress();
    // Catch any Openings-family trophy this mastery gain just unlocked.
    try { if (typeof window.CT_reconcileTrophies === 'function') window.CT_reconcileTrophies(); } catch (e) {}
    return p;
  }

  // Spaced repetition: due if never reviewed, or REVIEW_DAYS have elapsed. A
  // higher mastery stretches the interval a little (well-known cards come back
  // less often) — a light touch, not a full SM-2.
  function isDue(id) {
    var p = progressFor(id);
    if (!p.lastReviewed) return true;
    var intervalDays = REVIEW_DAYS + Math.floor((p.mastery || 0) / 25); // 3..7 days
    return (Date.now() - p.lastReviewed) >= intervalDays * DAY_MS;
  }

  function dueCount() {
    var n = 0;
    for (var i = 0; i < OPENINGS.length; i++) { if (isDue(OPENINGS[i].id)) n++; }
    return n;
  }

  // ---------------------------------------------------------------------------
  // Module state
  // ---------------------------------------------------------------------------
  var mountEl = null;
  var refs = {};
  var initialized = false;
  var view = 'list';     // 'list' | 'drill'
  var state = null;      // active drill session (see startDrill)

  // ---------------------------------------------------------------------------
  // RENDERING — list + drill views
  // ---------------------------------------------------------------------------
  function resolveMount(sel) {
    var container = document.querySelector(sel || '#screen-openings');
    if (!container) return null;
    var body = container.querySelector('.screen-body');
    return body || container;
  }

  function buildUI() {
    mountEl.innerHTML = '';
    var wrap = el('div', 'cto-wrap');

    // ----- LIST view --------------------------------------------------------
    refs.listView = el('div', 'cto-listview');
    var lh = el('div', 'cto-listhead');
    var ltitle = el('div', 'cto-title', 'Opening Trainer');
    refs.dueSummary = el('div', 'cto-due-summary', '');
    lh.appendChild(ltitle); lh.appendChild(refs.dueSummary);
    refs.listView.appendChild(lh);
    var blurb = el('div', 'cto-blurb', 'Drill real opening lines move by move. Play the correct book move; a wrong move is shown, then reverted so you can retry. Complete a line cleanly to raise your mastery.');
    refs.listView.appendChild(blurb);
    refs.list = el('div', 'cto-list');
    refs.listView.appendChild(refs.list);
    wrap.appendChild(refs.listView);

    // ----- DRILL view -------------------------------------------------------
    refs.drillView = el('div', 'cto-drillview');
    refs.drillView.style.display = 'none';

    var dh = el('div', 'cto-header');
    refs.btnBack = el('button', 'cto-btn cto-back', '← Openings');
    refs.btnBack.type = 'button';
    refs.dtitle = el('div', 'cto-title', 'Opening');
    var badges = el('div', 'cto-badges');
    refs.eco = el('span', 'cto-badge cto-badge-eco', '');
    refs.side = el('span', 'cto-badge cto-badge-side', '');
    badges.appendChild(refs.eco); badges.appendChild(refs.side);
    dh.appendChild(refs.btnBack); dh.appendChild(refs.dtitle); dh.appendChild(badges);
    refs.drillView.appendChild(dh);

    refs.desc = el('div', 'cto-desc', '');
    refs.drillView.appendChild(refs.desc);

    // Move-progress dots (one per ply).
    refs.progress = el('div', 'cto-plyrow');
    refs.drillView.appendChild(refs.progress);

    refs.status = el('div', 'cto-status', '');
    refs.drillView.appendChild(refs.status);

    refs.board = el('div', 'cto-board');
    refs.drillView.appendChild(refs.board);

    var controls = el('div', 'cto-controls');
    refs.btnHint = el('button', 'cto-btn cto-hint', 'Hint');
    refs.btnRestart = el('button', 'cto-btn cto-restart', 'Restart line');
    refs.btnNext = el('button', 'cto-btn cto-next', 'Review next due');
    refs.btnHint.type = 'button'; refs.btnRestart.type = 'button'; refs.btnNext.type = 'button';
    refs.btnNext.style.display = 'none';
    controls.appendChild(refs.btnHint);
    controls.appendChild(refs.btnRestart);
    controls.appendChild(refs.btnNext);
    refs.drillView.appendChild(controls);

    wrap.appendChild(refs.drillView);
    mountEl.appendChild(wrap);

    injectStyles();

    // CSP-safe: addEventListener only, no inline handlers.
    refs.btnBack.addEventListener('click', function () { showList(); });
    refs.btnHint.addEventListener('click', onHint);
    refs.btnRestart.addEventListener('click', onRestart);
    refs.btnNext.addEventListener('click', onNextDue);
    refs.list.addEventListener('click', onListClick);
  }

  function injectStyles() {
    if (document.getElementById('cto-styles')) return;
    var css = [
      '.cto-wrap{max-width:560px;margin:0 auto;padding:8px}',
      '.cto-title{font-weight:700;font-size:18px}',
      '.cto-listhead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}',
      '.cto-due-summary{font-size:13px;font-weight:700;color:#e0683c}',
      '.cto-blurb{font-size:13px;opacity:.82;margin:6px 0 12px;line-height:1.45}',
      '.cto-list{display:flex;flex-direction:column;gap:10px}',
      '.cto-card{text-align:left;width:100%;border:1px solid rgba(127,127,127,.28);border-radius:12px;padding:12px;background:rgba(127,127,127,.06);cursor:pointer;color:inherit;font:inherit}',
      '.cto-card:hover{border-color:#3b6ea5}',
      '.cto-card-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.cto-card-name{font-weight:700;font-size:15px}',
      '.cto-badge{font-size:11px;padding:2px 7px;border-radius:10px;background:rgba(127,127,127,.18)}',
      '.cto-badge-eco{font-variant:tabular-nums}',
      '.cto-badge-side{background:rgba(59,110,165,.2)}',
      '.cto-badge-due{background:rgba(224,104,60,.18);color:#e0683c;font-weight:700}',
      '.cto-card-desc{font-size:12.5px;opacity:.78;margin:6px 0 8px;line-height:1.4}',
      '.cto-bar{position:relative;height:8px;border-radius:6px;background:rgba(127,127,127,.22);overflow:hidden}',
      '.cto-bar-fill{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#3b6ea5,#2e9e5b);border-radius:6px;transition:width .35s ease}',
      '.cto-bar-label{display:flex;justify-content:space-between;font-size:11px;opacity:.7;margin-top:4px}',
      '.cto-header{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}',
      '.cto-header .cto-title{flex:1;min-width:120px}',
      '.cto-badges{display:flex;gap:6px;flex-wrap:wrap}',
      '.cto-desc{font-size:13px;opacity:.82;margin:2px 0 8px;line-height:1.4}',
      '.cto-plyrow{display:flex;gap:5px;flex-wrap:wrap;margin:2px 0 8px}',
      '.cto-ply{width:14px;height:14px;border-radius:50%;background:rgba(127,127,127,.25);font-size:9px;display:flex;align-items:center;justify-content:center}',
      '.cto-ply.done{background:#2e9e5b}',
      '.cto-ply.cur{background:#f4c542;outline:2px solid rgba(244,197,66,.5)}',
      '.cto-status{min-height:22px;margin:4px 0 8px;font-size:14px}',
      '.cto-status.ok{color:#2e9e5b;font-weight:600}',
      '.cto-status.bad{color:#d4504a;font-weight:600}',
      '.cto-status.win{color:#2e9e5b;font-weight:700}',
      '.cto-board{position:relative;width:100%;aspect-ratio:1/1;display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);border:2px solid rgba(0,0,0,.25);border-radius:6px;overflow:hidden;user-select:none;touch-action:manipulation}',
      '.cto-sq{display:flex;align-items:center;justify-content:center;position:relative;cursor:pointer}',
      '.cto-sq.light{background:var(--light-sq,#eedfc6)}',
      '.cto-sq.dark{background:var(--dark-sq,#6e8c6b)}',
      '.cto-pc{width:88%;height:88%;display:flex;align-items:center;justify-content:center;font-size:min(8vw,42px);line-height:1;pointer-events:none}',
      '.cto-pc svg{width:100%;height:100%;pointer-events:none;filter:drop-shadow(0 1px 1px rgba(0,0,0,.25))}',
      '.cto-sq.sel{outline:3px solid #f4c542;outline-offset:-3px}',
      '.cto-sq.target::after{content:"";position:absolute;width:30%;height:30%;border-radius:50%;background:rgba(0,0,0,.22)}',
      '.cto-sq.lastmove{background:rgba(244,197,66,.45)!important}',
      '.cto-sq.hintsq{outline:3px solid #4a9be0;outline-offset:-3px}',
      '.cto-sq.badsq{outline:3px solid #d4504a;outline-offset:-3px}',
      '.cto-controls{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}',
      '.cto-btn{flex:1;min-width:90px;padding:10px;border:none;border-radius:8px;font-weight:600;cursor:pointer;background:#3b6ea5;color:#fff}',
      '.cto-btn:disabled{opacity:.45;cursor:default}',
      '.cto-btn.cto-back{flex:0 0 auto;min-width:0;background:rgba(127,127,127,.25);color:inherit;padding:8px 12px}',
      '.cto-btn.cto-restart{background:#8a6d3b}',
      '.cto-btn.cto-next{background:#2e9e5b}',
      '.cto-board.solved{animation:cto-pop .5s ease}',
      '@keyframes cto-pop{0%{transform:scale(1)}40%{transform:scale(1.03)}100%{transform:scale(1)}}',
    ].join('\n');
    var style = el('style');
    style.id = 'cto-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ----- LIST -------------------------------------------------------------
  function renderList() {
    if (!refs.list) return;
    var due = dueCount();
    refs.dueSummary.textContent = due > 0
      ? (due + (due === 1 ? ' opening' : ' openings') + ' due for review')
      : 'All caught up ✓';
    refs.dueSummary.style.color = due > 0 ? '#e0683c' : '#2e9e5b';

    refs.list.innerHTML = '';
    for (var i = 0; i < OPENINGS.length; i++) {
      var o = OPENINGS[i];
      var p = progressFor(o.id);
      var card = el('button', 'cto-card');
      card.type = 'button';
      card.setAttribute('data-open', o.id);

      var top = el('div', 'cto-card-top');
      top.appendChild(el('span', 'cto-card-name', o.name));
      top.appendChild(el('span', 'cto-badge cto-badge-eco', o.eco));
      top.appendChild(el('span', 'cto-badge cto-badge-side', o.userColor === 'w' ? 'You: White' : 'You: Black'));
      if (isDue(o.id)) top.appendChild(el('span', 'cto-badge cto-badge-due', 'Due'));
      card.appendChild(top);

      card.appendChild(el('div', 'cto-card-desc', o.desc));

      var bar = el('div', 'cto-bar');
      var fill = el('div', 'cto-bar-fill');
      fill.style.width = (p.mastery || 0) + '%';
      bar.appendChild(fill);
      card.appendChild(bar);

      var lab = el('div', 'cto-bar-label');
      lab.appendChild(el('span', null, 'Mastery ' + (p.mastery || 0) + '%'));
      lab.appendChild(el('span', null, p.attempts ? (p.attempts + (p.attempts === 1 ? ' run' : ' runs')) : 'New'));
      card.appendChild(lab);

      refs.list.appendChild(card);
    }
  }

  function onListClick(e) {
    var card = e.target && e.target.closest ? e.target.closest('.cto-card') : null;
    if (!card) return;
    var id = card.getAttribute('data-open');
    if (id) drill(id);
  }

  function showList() {
    view = 'list';
    state = null;
    if (refs.drillView) refs.drillView.style.display = 'none';
    if (refs.listView) refs.listView.style.display = '';
    renderList();
  }

  function showDrill() {
    view = 'drill';
    if (refs.listView) refs.listView.style.display = 'none';
    if (refs.drillView) refs.drillView.style.display = '';
  }

  // ----- DRILL board ------------------------------------------------------
  function renderBoard() {
    var b = refs.board;
    if (!b) return;
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
        var sq = el('div', 'cto-sq ' + (isLight ? 'light' : 'dark'));
        sq.setAttribute('data-sq', sqName);
        var piece = board[r][f];
        if (piece) {
          var g = el('span', 'cto-pc');
          var svg = (window.CT && typeof window.CT.pieceSVG === 'function') ? window.CT.pieceSVG(piece.type, piece.color) : '';
          if (svg) g.innerHTML = svg;
          else g.textContent = GLYPHS[piece.color + piece.type] || '';
          sq.appendChild(g);
        }
        if (state.selected === sqName) sq.classList.add('sel');
        if (state.targets && state.targets.indexOf(sqName) >= 0) sq.classList.add('target');
        if (state.lastMove && (state.lastMove.from === sqName || state.lastMove.to === sqName)) sq.classList.add('lastmove');
        if (state.hintSquares && state.hintSquares.indexOf(sqName) >= 0) sq.classList.add('hintsq');
        if (state.badSquares && state.badSquares.indexOf(sqName) >= 0) sq.classList.add('badsq');
        sq.addEventListener('click', onSquareClick);
        b.appendChild(sq);
      }
    }
  }

  function setStatus(text, kind) {
    if (!refs.status) return;
    refs.status.textContent = text;
    refs.status.className = 'cto-status' + (kind ? ' ' + kind : '');
  }

  function renderProgressDots() {
    if (!refs.progress || !state) return;
    refs.progress.innerHTML = '';
    var n = state.opening.line.length;
    for (var i = 0; i < n; i++) {
      var dot = el('span', 'cto-ply');
      if (i < state.stepIndex) dot.classList.add('done');
      else if (i === state.stepIndex) dot.classList.add('cur');
      refs.progress.appendChild(dot);
    }
  }

  // ---------------------------------------------------------------------------
  // DRILL SESSION
  // state: { opening, chess, stepIndex, userColor, orientation, selected,
  //          targets, lastMove, hintSquares, badSquares, busy, done, punished }
  // ---------------------------------------------------------------------------
  function startDrill(opening) {
    if (!window.Chess) { showDrill(); setStatus('Chess engine not loaded.', 'bad'); return; }
    state = {
      opening: opening,
      chess: new window.Chess(),  // openings always start from the initial position
      stepIndex: 0,               // index into opening.line (ply)
      userColor: opening.userColor,
      orientation: opening.userColor,
      selected: null,
      targets: null,
      lastMove: null,
      hintSquares: null,
      badSquares: null,
      busy: false,
      done: false,
      punished: false,
      clean: true,                // no wrong move yet -> counts as a clean run
    };
    showDrill();
    refs.dtitle.textContent = opening.name;
    refs.eco.textContent = opening.eco;
    refs.side.textContent = opening.userColor === 'w' ? 'You play White' : 'You play Black';
    refs.desc.textContent = opening.desc;
    refs.btnNext.style.display = 'none';
    refs.btnHint.disabled = false;
    renderProgressDots();
    renderBoard();

    // If the opponent moves first (user is Black), auto-play their book move.
    if (state.chess.turn() !== state.userColor) {
      autoPlayBookReply();
    } else {
      setStatus('Your move — play the book move for ' + opening.name + '.');
    }
  }

  // The SAN the line expects at the current ply.
  function expectedSan() {
    return state.opening.line[state.stepIndex] || null;
  }

  // Resolve the expected SAN to a {from,to,promotion} on the CURRENT position so
  // we can compare a user's click-move against it without depending on SAN
  // spelling (e.g. check/mate suffixes).
  function expectedMoveObj() {
    var san = expectedSan();
    if (san == null) return null;
    var probe = new window.Chess(state.chess.fen());
    var mv = null;
    try { mv = probe.move(san, { sloppy: true }); } catch (e) { mv = null; }
    return mv ? { from: mv.from, to: mv.to, promotion: mv.promotion } : null;
  }

  // ----- user square interaction -----------------------------------------
  function onSquareClick(e) {
    if (!state || state.done || state.busy || state.punished) return;
    var chess = state.chess;
    if (chess.turn() !== state.userColor) return; // not the user's turn
    var sq = e.currentTarget.getAttribute('data-sq');

    if (state.selected) {
      if (sq === state.selected) { clearSelection(); renderBoard(); return; }
      var legal = chess.moves({ square: state.selected, verbose: true });
      var match = null;
      for (var i = 0; i < legal.length; i++) { if (legal[i].to === sq) { match = legal[i]; break; } }
      if (match) { handleUserMove(state.selected, sq, match); return; }
      var pc = chess.get(sq);
      if (pc && pc.color === state.userColor) { selectSquare(sq); renderBoard(); return; }
      clearSelection(); renderBoard(); return;
    }
    var piece = chess.get(sq);
    if (piece && piece.color === state.userColor) { selectSquare(sq); renderBoard(); }
  }

  function selectSquare(sq) {
    state.selected = sq;
    var moves = state.chess.moves({ square: sq, verbose: true });
    state.targets = moves.map(function (m) { return m.to; });
    state.hintSquares = null;
    state.badSquares = null;
  }
  function clearSelection() { state.selected = null; state.targets = null; }

  function neededPromotion(from, to) {
    var exp = expectedMoveObj();
    if (exp && exp.from === from && exp.to === to && exp.promotion) return exp.promotion;
    return 'q';
  }

  function handleUserMove(from, to, legalMove) {
    clearSelection();
    var promo = (legalMove.flags && legalMove.flags.indexOf('p') >= 0) ? neededPromotion(from, to) : undefined;
    var exp = expectedMoveObj();
    var correct = exp && exp.from === from && exp.to === to &&
      ((!exp.promotion && !promo) || exp.promotion === promo || (!exp.promotion));

    if (correct) {
      state.chess.move({ from: from, to: to, promotion: promo });
      state.lastMove = { from: from, to: to };
      state.hintSquares = null;
      state.badSquares = null;
      state.stepIndex++;
      renderBoard();
      renderProgressDots();
      if (state.stepIndex >= state.opening.line.length) { onLineComplete(); return; }
      setStatus('Correct! ' + expectedSanLabel(state.stepIndex - 1) + ' …', 'ok');
      autoPlayBookReply();
    } else {
      punishWrongMove(from, to, promo);
    }
  }

  // A nice label for a played ply: "1.e4" / "1...c5".
  function expectedSanLabel(plyIndex) {
    var san = state.opening.line[plyIndex];
    if (san == null) return '';
    var moveNo = Math.floor(plyIndex / 2) + 1;
    return (plyIndex % 2 === 0) ? (moveNo + '.' + san) : (moveNo + '...' + san);
  }

  // Auto-play the opponent's scripted book SAN, then it's the user's turn.
  function autoPlayBookReply() {
    if (state.stepIndex >= state.opening.line.length) { onLineComplete(); return; }
    state.busy = true;
    var san = state.opening.line[state.stepIndex];
    var idx = state.stepIndex;
    setStatus('Opponent to move…');
    setTimeout(function () {
      if (!state) return;
      var mv = null;
      try { mv = state.chess.move(san, { sloppy: true }); } catch (e) { mv = null; }
      if (mv) { state.lastMove = { from: mv.from, to: mv.to }; state.stepIndex++; }
      state.busy = false;
      renderBoard();
      renderProgressDots();
      if (state.stepIndex >= state.opening.line.length) { onLineComplete(); return; }
      setStatus('Opponent played ' + expectedSanLabel(idx) + '. Your move.');
    }, 380);
  }

  // WRONG user move: play it so the mistake is felt, flag it, then auto-revert
  // and let them retry the correct move (punish-then-retry).
  function punishWrongMove(from, to, promo) {
    var beforeFen = state.chess.fen();
    var mv = state.chess.move({ from: from, to: to, promotion: promo });
    if (!mv) return;
    state.clean = false;
    state.lastMove = { from: from, to: to };
    state.badSquares = [from, to];
    state.busy = true;
    state.hintSquares = null;
    renderBoard();
    var exp = expectedMoveObj();
    var want = expectedSan();
    // The move IS legal (only legal moves reach here) — it's just not the line this
    // drill is teaching. Frame it as "a different line", not a blunder, so a player
    // who knows theory isn't told a sound alternative is "wrong".
    setStatus('That’s playable — but this drill follows one line. The book continues ' + (want || '…') + '.', 'bad');
    refs.btnHint.disabled = true;
    setTimeout(function () {
      if (!state) return;
      // Revert to the pre-mistake position so they can retry the correct move.
      state.chess = new window.Chess(beforeFen);
      state.busy = false;
      state.punished = false;
      state.selected = null;
      state.targets = null;
      state.badSquares = null;
      // Leave a hint on the correct move after a slip.
      state.hintSquares = exp ? [exp.from, exp.to] : null;
      state.lastMove = null;
      refs.btnHint.disabled = false;
      renderBoard();
      setStatus('Play ' + (want || 'the book move') + ' to stay in the line.', 'bad');
    }, 900);
  }

  function onHint() {
    if (!state || state.done || state.busy || state.punished) return;
    if (state.chess.turn() !== state.userColor) return;
    var exp = expectedMoveObj();
    if (!exp) return;
    state.hintSquares = [exp.from, exp.to];
    renderBoard();
    setStatus('Hint: the line continues ' + (expectedSan() || '') + '.', 'ok');
  }

  function onRestart() {
    if (!state) return;
    startDrill(state.opening);
  }

  function onLineComplete() {
    state.done = true;
    state.selected = null; state.targets = null; state.hintSquares = null; state.badSquares = null;
    refs.btnHint.disabled = true;
    renderBoard();
    renderProgressDots();
    if (refs.board) {
      refs.board.classList.add('solved');
      setTimeout(function () { if (refs.board) refs.board.classList.remove('solved'); }, 600);
    }

    // Mastery only rises on a CLEAN run (no wrong move); a slipped run still
    // stamps the review clock but is gentler. We treat a completed run as a
    // review either way; mastery gain is reserved for clean lines.
    var before = progressFor(state.opening.id).mastery || 0;
    var p;
    if (state.clean) {
      p = markCompleted(state.opening.id);
      var delta = (p.mastery || 0) - before;
      setStatus('Line complete! ✓ ' + state.opening.name + ' mastery +' + delta + '% → ' + p.mastery + '%.', 'win');
    } else {
      // Stamp the review (so it's no longer "due") without a mastery bump.
      var all = allProgress();
      var rec = all[state.opening.id] || { mastery: 0, lastReviewed: null, attempts: 0 };
      rec.attempts = (rec.attempts || 0) + 1;
      rec.lastReviewed = Date.now();
      all[state.opening.id] = rec;
      persistProgress();
      setStatus('Line complete — but you slipped once. Run it cleanly to raise mastery.', 'ok');
    }

    // Celebrate using the app's confetti if available (clean runs only).
    if (state.clean) {
      try { if (window.CT && typeof window.CT.ctCelebrate === 'function') window.CT.ctCelebrate('win'); } catch (e) {}
    }

    // Offer "next due" if anything else is due; else a friendly button to pick.
    refs.btnNext.style.display = '';
    refs.btnNext.textContent = dueCount() > 0 ? 'Review next due' : 'Back to openings';

    // Keep the lobby card fresh.
    try { renderLobbyCard(); } catch (e) {}
  }

  function onNextDue() {
    // Find the next due opening other than the one just drilled; else go to list.
    var current = state && state.opening ? state.opening.id : null;
    var next = null;
    for (var i = 0; i < OPENINGS.length; i++) {
      var o = OPENINGS[i];
      if (o.id === current) continue;
      if (isDue(o.id)) { next = o; break; }
    }
    if (next) drill(next.id);
    else showList();
  }

  // ---------------------------------------------------------------------------
  // LOBBY CARD — "N openings due for review" (populates #lobby-openings-card).
  // Self-contained: hides the card when nothing is due, fills it when due.
  // ---------------------------------------------------------------------------
  function renderLobbyCard() {
    var card = document.getElementById('lobby-openings-card');
    if (!card) return;
    var due = dueCount();
    var titleEl = document.getElementById('lobby-openings-title');
    var subEl = document.getElementById('lobby-openings-sub');
    if (due > 0) {
      card.style.display = '';
      if (titleEl) titleEl.textContent = 'Opening Trainer';
      if (subEl) subEl.textContent = due + (due === 1 ? ' opening' : ' openings') + ' due for review — drill your book lines.';
    } else {
      // No reviews due: show a gentle "keep sharp" prompt rather than hiding it
      // entirely, so the feature stays discoverable. (Hide instead if preferred.)
      card.style.display = '';
      if (titleEl) titleEl.textContent = 'Opening Trainer';
      if (subEl) subEl.textContent = 'Drill real opening lines and build your repertoire.';
    }
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------
  function init(mountSelector) {
    var target = resolveMount(mountSelector);
    if (!target) return false;
    if (initialized && mountEl === target) { renderList(); return true; }
    mountEl = target;
    buildUI();
    initialized = true;
    renderList();
    try { renderLobbyCard(); } catch (e) {}
    return true;
  }

  function openTrainer() {
    if (!initialized && !init()) return;
    showList();
  }

  function drill(openingId) {
    if (!initialized && !init()) return;
    var o = findOpening(openingId);
    if (!o) { showList(); return; }
    startDrill(o);
  }

  window.CT_Openings = {
    init: init,
    openTrainer: openTrainer,
    render: openTrainer,
    drill: drill,
    renderLobbyCard: renderLobbyCard,
    dueCount: dueCount,
    // Exposed for testing: the raw book + the SR predicate.
    _openings: OPENINGS,
    _isDue: isDue,
  };
})();
