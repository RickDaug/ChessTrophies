/* ct-checkers.js — ChessTrophies CHECKERS / DRAUGHTS UI + orchestration.
 *
 * Classic browser <script> (NO import/export, NO inline on* — CSP-safe; all
 * handlers are added via addEventListener / delegation). Mirrors the chess game
 * experience in app.js (board render, click-to-move, result modal, vs-computer
 * Elo slider, ranked matchmaking, friendly challenges) but for the self-contained
 * checkers engine (window.CT_Checkers) + AI (window.CT_CheckersAI).
 *
 * Exposes window.CT_Checkers_UI:
 *   startPractice(elo, size, rules)        offline vs computer
 *   startFindRanked(size, rules)           ranked matchmaking (server)
 *   inviteFriend(friendId, name, size, rules)  friendly (unrated) challenge
 *   onMatchFound(data)                     called by app.js when a checkers match starts
 *   onMoveMade(data) / onGameOver(data) / onErr(data)
 *   wireNet()                              register CTNet checkers listeners (idempotent)
 *   render()                               re-render the active board (used on resume)
 *   state                                  getter for the active-game state (debug/tests)
 *   isActive()                             true while a checkers game is on screen
 *
 * It reuses window.CT for shared helpers (showScreen, toast, openModal, closeModal,
 * ctCelebrate, escapeHTML, loadDB/saveDB, checkAchievementsFor, tierColor) and
 * window.CTNet for the online contract. checkers.js + checkers-ai.js must be loaded
 * before this file (see index.html ordering).
 *
 * ONLINE EVENT NAMES are centralized in CK_EVENTS / the CTNet helpers so a slightly
 * different server contract is a one-line change. The contract this implements:
 *   emit  checkers_mm_join   { mode:'ranked', size, rules, tc }
 *   emit  checkers_mm_leave  {}
 *   emit  checkers_move      { gameId, move }
 *   emit  checkers_resign    { gameId }
 *   emit  checkers_challenge_invite/accept/decline/cancel { friendId|inviteId, game:'checkers', size, rules }
 *   on    checkers_match_found { gameId, color, size, rules, mode, position, opponent }
 *   on    checkers_move_made   { gameId, move, position, turn }
 *   on    checkers_game_over   { gameId, winner, reason }
 *   on    checkers_err         { error }
 */
(function () {
  'use strict';

  // Resolve window.CT lazily — app.js may load after this file. All helper shims
  // below go through CT() so they pick up window.CT once it exists.
  function CT() { return (typeof window !== 'undefined') ? window.CT : null; }
  function engine() { return window.CT_Checkers; }
  function ai() { return window.CT_CheckersAI; }

  // --- shared-helper shims (degrade gracefully if CT isn't ready) -------------
  function showScreen(id) { var c = CT(); if (c && c.showScreen) c.showScreen(id); }
  function toast(m, gold) { var c = CT(); if (c && c.toast) c.toast(m, gold); }
  function openModal(id) { var c = CT(); if (c && c.openModal) c.openModal(id); }
  function closeModal(id) { var c = CT(); if (c && c.closeModal) c.closeModal(id); }
  function celebrate(x) { var c = CT(); if (c && c.ctCelebrate) c.ctCelebrate(x); }
  function esc(str) { var c = CT(); return (c && c.escapeHTML) ? c.escapeHTML(str) : String(str == null ? '' : str); }
  function loadDB() { var c = CT(); return (c && c.loadDB) ? c.loadDB() : { users: {} }; }
  function saveDB(db) { var c = CT(); if (c && c.saveDB) c.saveDB(db); }
  function ctUser() { var c = CT(); return c ? c.user : null; }
  function ctState() { var c = CT(); return c ? c.state : null; }
  // Seasonal ranked switch — single source of truth lives in app.js (driven by
  // GET /api/config). Default FALSE (safe) if app.js isn't ready yet.
  function rankedEnabled() { var c = CT(); return !!(c && c.rankedEnabled && c.rankedEnabled()); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // Active checkers game state (mirrors app.js state for chess).
  var s = {
    game: null,        // CT_Checkers game instance
    size: 8,
    rules: 'acf',
    mode: null,        // 'practice' | 'ranked' | 'friendly'
    myColor: 'w',      // the human's color
    orientation: 'w',  // bottom-of-board color
    opponent: null,    // { username, elo, isAI, aiElo, userId }
    selected: null,    // selected origin square number
    legalForSel: [],   // [{ to, move }] legal destinations for the selected piece
    lastMove: null,    // last move object (for highlight)
    aiThinking: false,
    ended: false,
    // online
    isOnline: false,
    gameId: null,
    applyingRemote: false,
    // trophy bookkeeping for the current game
    myCapturesThisGame: 0,
    lostAnyPiece: false,
    hadKing: false,
    maxJumpThisTurn: 0,
  };

  // ---------------------------------------------------------------------------
  //  RULE-SET / SIZE resolution
  // ---------------------------------------------------------------------------
  // The lobby offers ACF / International / Casual; map to the engine's (size,rules).
  function resolveRules(size, ruleChoice) {
    size = (size === 10) ? 10 : 8;
    if (ruleChoice === 'casual') return { size: size, rules: 'casual' };
    if (ruleChoice === 'international' || ruleChoice === 'fmjd') return { size: 10, rules: 'fmjd' };
    // default ACF on 8x8
    return { size: 8, rules: 'acf' };
  }
  function rulesLabel(rules, size) {
    if (rules === 'fmjd') return 'International';
    if (rules === 'casual') return 'Casual';
    return 'ACF';
  }

  // ---------------------------------------------------------------------------
  //  DISC drawing (we draw discs, not pieceSVG)
  // ---------------------------------------------------------------------------
  function discSVG(color, king) {
    // color: 'w' | 'b'. Light vs dark disc, with a crown ring for kings.
    var light = color === 'w';
    var fill = light ? '#efe9da' : '#22283a';
    var edge = light ? '#c8bfa6' : '#0c1120';
    var rim = light ? '#d9d1bd' : '#3a4156';
    var crown = light ? '#b9962e' : '#f5c451';
    var svg = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="ck-disc">';
    svg += '<circle cx="50" cy="52" r="34" fill="' + edge + '"/>';
    svg += '<circle cx="50" cy="48" r="34" fill="' + fill + '" stroke="' + edge + '" stroke-width="2"/>';
    svg += '<circle cx="50" cy="48" r="26" fill="none" stroke="' + rim + '" stroke-width="3"/>';
    if (king) {
      // simple crown glyph
      svg += '<path d="M36 50 L40 40 L46 47 L50 38 L54 47 L60 40 L64 50 Z" fill="' + crown + '" stroke="' + edge + '" stroke-width="1.5" stroke-linejoin="round"/>';
      svg += '<rect x="36" y="51" width="28" height="5" rx="2" fill="' + crown + '" stroke="' + edge + '" stroke-width="1"/>';
    }
    svg += '</svg>';
    return svg;
  }

  // ---------------------------------------------------------------------------
  //  BOARD RENDER  (#checkers-board)
  // ---------------------------------------------------------------------------
  function render() {
    var boardEl = $('#checkers-board');
    if (!boardEl || !s.game) return;
    var size = s.size;
    boardEl.style.gridTemplateColumns = 'repeat(' + size + ', minmax(0, 1fr))';
    boardEl.style.gridTemplateRows = 'repeat(' + size + ', minmax(0, 1fr))';
    boardEl.innerHTML = '';
    var board = s.game.board(); // [r][c]
    var E = engine();
    // Orientation: white at bottom => iterate rows bottom-up; black at bottom flips.
    var rowsOrder = [], colsOrder = [];
    for (var i = 0; i < size; i++) { rowsOrder.push(i); colsOrder.push(i); }
    if (s.orientation === 'w') { rowsOrder.reverse(); }
    else { colsOrder.reverse(); }

    // Build a quick lookup of legal destination squares for the selected piece.
    var destSet = {};
    for (var d = 0; d < s.legalForSel.length; d++) destSet[s.legalForSel[d].to] = true;
    // Forced-capture origin squares (so we can hint which pieces MUST move).
    var forcedOrigins = forcedCaptureOrigins();

    for (var ri = 0; ri < rowsOrder.length; ri++) {
      for (var ci = 0; ci < colsOrder.length; ci++) {
        var r = rowsOrder[ri], c = colsOrder[ci];
        var playable = ((r + c) & 1) === 1;
        var num = playable ? E.rcToSquare(size, r, c) : 0;
        var cell = document.createElement('div');
        cell.className = 'ck-sq ' + (playable ? 'ck-dark' : 'ck-light');
        if (playable) cell.setAttribute('data-ck', String(num));
        var piece = board[r][c];
        if (piece) {
          var span = document.createElement('span');
          span.className = 'ck-piece';
          span.innerHTML = discSVG(piece.color, piece.king);
          cell.appendChild(span);
        }
        // highlights
        if (s.selected === num) cell.classList.add('ck-selected');
        if (s.lastMove && (s.lastMove.from === num || s.lastMove.to === num ||
            (s.lastMove.path && s.lastMove.path.indexOf(num) !== -1))) cell.classList.add('ck-last');
        if (destSet[num]) {
          var dot = document.createElement('span');
          dot.className = piece ? 'ck-ring' : 'ck-dot';
          cell.appendChild(dot);
        }
        // forced-capture indicator on pieces that are obligated to capture
        if (!s.selected && forcedOrigins[num]) cell.classList.add('ck-forced');
        if (playable) {
          (function (n) { cell.addEventListener('click', function () { onCellClick(n); }); })(num);
        }
        boardEl.appendChild(cell);
      }
    }
    updateStatus();
    renderCaptured();
  }

  // Origins (square numbers) that have a mandatory capture available this turn.
  function forcedCaptureOrigins() {
    var out = {};
    if (!s.game || s.ended) return out;
    if (s.game.turn() !== currentClickColor()) return out;
    var moves = s.game.legalMoves();
    var anyCapture = false;
    for (var i = 0; i < moves.length; i++) if (moves[i].captures.length > 0) anyCapture = true;
    if (!anyCapture) return out;
    // Only flag as "forced" when the ruleset actually forces captures.
    if (!s.game.cfg || !s.game.cfg.mandatory) return out;
    for (var j = 0; j < moves.length; j++) if (moves[j].captures.length > 0) out[moves[j].from] = true;
    return out;
  }

  // Which color is allowed to click right now (human side; both in nothing — vs AI
  // only the human's color, online only the human's color).
  function currentClickColor() { return s.game ? s.game.turn() : 'w'; }

  function renderCaptured() {
    // Count missing pieces per color vs the starting count, like chess captured row.
    if (!s.game) return;
    var size = s.size, rows = size === 10 ? 4 : 3;
    var startPer = 0;
    for (var r = 0; r < rows; r++) for (var c = 0; c < size; c++) if (((r + c) & 1) === 1) startPer++;
    var present = { w: 0, b: 0 };
    var board = s.game.board();
    for (var rr = 0; rr < size; rr++) for (var cc = 0; cc < size; cc++) {
      var p = board[rr][cc]; if (p) present[p.color]++;
    }
    var capByW = startPer - present.b; // white has captured this many black
    var capByB = startPer - present.w;
    var topIsOpp = s.orientation === s.myColor;
    var oppColor = s.myColor === 'w' ? 'b' : 'w';
    var topColor = topIsOpp ? oppColor : s.myColor;
    var botColor = topIsOpp ? s.myColor : oppColor;
    // pieces a side captured are of the OTHER color
    var topCaps = topColor === 'w' ? capByW : capByB;
    var botCaps = botColor === 'w' ? capByW : capByB;
    var ctEl = $('#ck-pt-captured'), cbEl = $('#ck-pb-captured');
    if (ctEl) ctEl.innerHTML = miniDiscs(topColor === 'w' ? 'b' : 'w', Math.max(0, topCaps));
    if (cbEl) cbEl.innerHTML = miniDiscs(botColor === 'w' ? 'b' : 'w', Math.max(0, botCaps));
  }
  function miniDiscs(color, n) {
    var out = '';
    for (var i = 0; i < n; i++) out += '<span class="ck-cap">' + discSVG(color, false) + '</span>';
    return out;
  }

  function updateStatus() {
    var el = $('#ck-game-status');
    if (!el || !s.game) return;
    var txt;
    if (s.game.isGameOver()) {
      var w = s.game.winner();
      txt = w === null ? 'Game over — draw' : (w === s.myColor ? 'You won' : 'You lost');
    } else {
      var t = s.game.turn();
      var mine = (t === s.myColor);
      txt = mine ? 'Your move' : (s.opponent && s.opponent.isAI ? 'Computer thinking…' : 'Opponent to move');
      // surface forced capture
      var moves = s.game.legalMoves();
      var hasCap = moves.some(function (m) { return m.captures.length > 0; });
      if (mine && hasCap && s.game.cfg && s.game.cfg.mandatory) txt += ' · capture required';
    }
    el.textContent = txt;
    var top = $('#ck-player-top'), bot = $('#ck-player-bot');
    if (top && bot && s.game) {
      var t2 = s.game.turn();
      var topIsOpp = s.orientation === s.myColor;
      var topSide = topIsOpp ? (s.myColor === 'w' ? 'b' : 'w') : s.myColor;
      top.classList.toggle('active', t2 === topSide);
      bot.classList.toggle('active', t2 !== topSide);
    }
  }

  function setupGameScreen() {
    var me = ctUser() || { username: 'You', elo: 1200 };
    var opp = s.opponent || { username: 'Opponent', elo: 1200 };
    var topIsOpp = s.orientation === s.myColor;
    var topU = topIsOpp ? opp : me;
    var botU = topIsOpp ? me : opp;
    setText('#ck-pt-name', topU.username);
    setText('#ck-pt-elo', 'ELO ' + (topU.elo != null ? topU.elo : '—'));
    setText('#ck-pb-name', botU.username);
    setText('#ck-pb-elo', 'ELO ' + (botU.elo != null ? botU.elo : '—'));
    var sub = $('#ck-variant-sub');
    if (sub) sub.textContent = s.size + 'x' + s.size + ' · ' + rulesLabel(s.rules, s.size) +
      (s.mode === 'ranked' ? ' · Ranked' : s.mode === 'friendly' ? ' · Friendly' : ' · Practice');
  }
  function setText(sel, t) { var el = $(sel); if (el) el.textContent = t; }

  // ---------------------------------------------------------------------------
  //  CLICK-TO-MOVE  (supports multi-jump by clicking through the path)
  // ---------------------------------------------------------------------------
  function onCellClick(num) {
    if (!s.game || s.ended || s.aiThinking || s.applyingRemote) return;
    var turn = s.game.turn();
    // vs AI / online: only the human's color may move.
    if ((s.opponent && s.opponent.isAI) && turn !== s.myColor) return;
    if (s.isOnline && turn !== s.myColor) return;

    var piece = s.game.get(num);
    if (s.selected != null) {
      if (s.selected === num) { clearSel(); render(); return; }
      // Is this a legal destination from the selected piece?
      var hit = null;
      for (var i = 0; i < s.legalForSel.length; i++) {
        if (s.legalForSel[i].to === num) { hit = s.legalForSel[i]; break; }
      }
      if (hit) { applyHumanMove(hit.move); return; }
      // Otherwise: re-select if it's another of the player's pieces.
      if (piece && piece.color === turn) { selectSquare(num); return; }
      clearSel(); render(); return;
    }
    if (piece && piece.color === turn) selectSquare(num);
  }

  function selectSquare(num) {
    s.selected = num;
    // Destinations: every legal move whose FROM is this square. (Multi-jumps are
    // single move objects with a full path; the engine lists complete sequences,
    // so clicking the final landing square executes the whole chain. We also list
    // intermediate landing squares of forced single-direction jumps so the path is
    // clickable step-by-step where unambiguous.)
    var legal = s.game.legalMoves();
    var dests = [];
    var seen = {};
    for (var i = 0; i < legal.length; i++) {
      var m = legal[i];
      if (m.from !== num) continue;
      if (!seen[m.to]) { dests.push({ to: m.to, move: m }); seen[m.to] = true; }
    }
    s.legalForSel = dests;
    render();
  }
  function clearSel() { s.selected = null; s.legalForSel = []; }

  function applyHumanMove(move) {
    var capCount = move.captures ? move.captures.length : 0;
    var applied = s.game.move(move);
    clearSel();
    if (!applied) { render(); return; }
    afterMove(applied, true);
  }

  function afterMove(move, isMine) {
    s.lastMove = move;
    // Sound: capture vs move (reuse chess sounds if present).
    try {
      if (window.ChessSounds) {
        if (move.captures && move.captures.length) window.ChessSounds.capture();
        else window.ChessSounds.move();
      }
    } catch (e) {}
    // Trophy bookkeeping (local play tracking).
    if (isMine && move.color === s.myColor) {
      var caps = move.captures ? move.captures.length : 0;
      s.myCapturesThisGame += caps;
      if (caps > s.maxJumpThisTurn) s.maxJumpThisTurn = caps;
      // Did I have/get a king?
      if (move.promotion || (move.king && move.color === s.myColor)) s.hadKing = true;
      var pc = s.game.get(move.to);
      if (pc && pc.color === s.myColor && pc.king) s.hadKing = true;
      // Online: send my move to the server.
      if (s.isOnline && !s.applyingRemote && s.gameId) {
        try { sendCheckersMove(s.gameId, serializeMove(move)); } catch (e) { console.error('[CK] sendMove', e); }
      }
    } else if (!isMine) {
      // Opponent captured one of my pieces.
      if (move.captures && move.captures.length) s.lostAnyPiece = true;
    }
    render();
    if (s.game.isGameOver()) {
      if (!s.isOnline) finishGame(s.game.winner(), s.game.gameOverReason());
      return;
    }
    // vs AI: trigger the AI reply (offline only).
    if (!s.isOnline && s.opponent && s.opponent.isAI && s.game.turn() !== s.myColor) {
      s.aiThinking = true;
      updateStatus();
      setTimeout(makeAIMove, 350);
    }
  }

  function makeAIMove() {
    if (!s.game || s.game.isGameOver()) { s.aiThinking = false; return; }
    var g = s.game;
    var elo = (s.opponent && s.opponent.aiElo) || 1200;
    var A = ai();
    if (!A) { s.aiThinking = false; return; }
    function applyAi(move) {
      s.aiThinking = false;
      if (!move || s.game !== g || g.isGameOver()) return;
      var applied = g.move(move);
      if (applied) afterMove(applied, false);
    }
    // Run the search OFF the UI thread via the Web Worker (mirrors chess's
    // chooseMoveAsync); the worker reconstructs the position from serialize().
    // Falls back to the synchronous engine when Workers are unavailable/hang.
    if (typeof A.chooseMoveAsync === 'function') {
      A.chooseMoveAsync(g.serialize(), elo).then(applyAi, function (e) { console.error('[CK] ai', e); s.aiThinking = false; });
    } else {
      setTimeout(function () {
        if (s.game !== g || g.isGameOver()) { s.aiThinking = false; return; }
        var move;
        try { move = A.chooseMove(g, elo); } catch (e) { console.error('[CK] ai', e); s.aiThinking = false; return; }
        applyAi(move);
      }, 20);
    }
  }

  // ---------------------------------------------------------------------------
  //  GAME LIFECYCLE
  // ---------------------------------------------------------------------------
  function newGame(size, rules, position) {
    var E = engine();
    var opts = { size: size, rules: rules };
    if (position) opts.position = position;
    return E.create(opts);
  }

  function startGame(mode) {
    s.mode = mode;
    s.ended = false;
    s.selected = null;
    s.legalForSel = [];
    s.lastMove = null;
    s.aiThinking = false;
    s.applyingRemote = false;
    s.myCapturesThisGame = 0;
    s.lostAnyPiece = false;
    s.hadKing = false;
    s.maxJumpThisTurn = 0;
    s.orientation = s.myColor;
    setupGameScreen();
    showScreen('checkers');
    render();
    // If the AI moves first (human is black), kick it off.
    if (!s.isOnline && s.opponent && s.opponent.isAI && s.game.turn() !== s.myColor) {
      s.aiThinking = true;
      setTimeout(makeAIMove, 500);
    }
  }

  // --- vs COMPUTER ----------------------------------------------------------
  function startPractice(elo, size, rules) {
    var R = resolveRules(size, rules);
    s.size = R.size; s.rules = R.rules;
    s.isOnline = false; s.gameId = null;
    s.game = newGame(s.size, s.rules);
    var aiElo = clampElo(elo);
    s.myColor = Math.random() < 0.5 ? 'w' : 'b';
    s.opponent = { username: 'Computer (' + aiNameForElo(aiElo) + ')', elo: aiElo, isAI: true, aiElo: aiElo };
    startGame('practice');
  }
  function clampElo(v) { v = Number(v); if (!isFinite(v)) return 1200; return Math.max(100, Math.min(2800, Math.round(v / 100) * 100)); }
  function aiNameForElo(e) {
    if (e >= 2500) return 'Grandmaster'; if (e >= 2300) return 'Master';
    if (e >= 2000) return 'Expert'; if (e >= 1700) return 'Strong';
    if (e >= 1400) return 'Intermediate'; if (e >= 1100) return 'Club'; return 'Beginner';
  }

  // --- RANKED matchmaking ---------------------------------------------------
  var mmTimer = null, mmStart = 0, mmGiveUp = null, waitingMatch = false;
  function startFindRanked(size, rules) {
    // Defensive: even if the disabled button is somehow triggered, never join the
    // ranked queue while the seasonal switch is off.
    if (!rankedEnabled()) { toast('Ranked checkers is coming soon.'); return; }
    var R = resolveRules(size, rules);
    s.size = R.size; s.rules = R.rules;
    if (!ctUser() || isGuest()) {
      toast('Ranked checkers needs a free account. Try Practice vs Computer for now.');
      return;
    }
    if (!window.CTNet || !window.CTNet.isReady()) {
      toast('Connecting to the game server… try again in a moment.');
      if (window.__connectGameSocket) window.__connectGameSocket();
      return;
    }
    openMatchmaking();
    waitingMatch = true;
    mmStart = Date.now();
    if (mmTimer) clearInterval(mmTimer);
    mmTimer = setInterval(function () {
      var secs = Math.floor((Date.now() - mmStart) / 1000);
      var t = $('#ck-mm-timer'); if (t) t.textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    }, 1000);
    if (mmGiveUp) clearTimeout(mmGiveUp);
    mmGiveUp = setTimeout(function () {
      if (!waitingMatch) return;
      stopMatchmaking();
      leaveCheckersQueue();
      closeModal('ck-matchmaking');
      toast('No checkers opponent found right now — try again.');
    }, 120000);
    joinCheckersQueue('ranked', s.size, s.rules, (ctState() && ctState().selectedTc) || 'unlimited');
  }
  function stopMatchmaking() {
    waitingMatch = false;
    if (mmTimer) { clearInterval(mmTimer); mmTimer = null; }
    if (mmGiveUp) { clearTimeout(mmGiveUp); mmGiveUp = null; }
  }
  function openMatchmaking() {
    var t = $('#ck-mm-timer'); if (t) t.textContent = '0:00';
    var sub = $('#ck-mm-sub');
    if (sub) sub.textContent = 'Looking for a ' + s.size + 'x' + s.size + ' ' + rulesLabel(s.rules, s.size) + ' opponent near your rating…';
    openModal('ck-matchmaking');
  }
  function isGuest() {
    var A = window.CT_Auth;
    return !(A && A.isServerLoggedIn && A.isServerLoggedIn());
  }

  // --- FRIENDLY challenge ---------------------------------------------------
  function inviteFriend(friendId, name, size, rules) {
    var R = resolveRules(size, rules);
    s.size = R.size; s.rules = R.rules;
    if (!window.CTNet || !window.CTNet.isReady()) {
      toast('Server unavailable — a checkers challenge needs a connection.');
      return;
    }
    inviteCheckersChallenge(friendId, R.size, R.rules, (ctState() && ctState().selectedTc) || 'unlimited');
    waitingMatch = true;
    var body = $('#ck-challenge-wait-body');
    if (body) body.textContent = 'Waiting for ' + (name || 'your friend') + ' to accept your ' +
      R.size + 'x' + R.size + ' ' + rulesLabel(R.rules, R.size) + ' challenge…';
    openModal('ck-challenge-wait');
  }

  // ---------------------------------------------------------------------------
  //  ONLINE handlers (called from app.js / wired here on CTNet)
  // ---------------------------------------------------------------------------
  function onMatchFound(data) {
    if (!data || !data.gameId) return;
    stopMatchmaking();
    waitingMatch = false;
    closeModal('ck-matchmaking');
    closeModal('ck-challenge-wait');
    var me = ctUser();
    s.size = (data.size === 10) ? 10 : 8;
    s.rules = data.rules || (s.size === 10 ? 'fmjd' : 'acf');
    s.myColor = data.color === 'b' ? 'b' : 'w';
    s.isOnline = true;
    s.gameId = data.gameId;
    var opp = data.opponent || {};
    s.opponent = {
      username: opp.username || 'Opponent',
      elo: opp.elo != null ? opp.elo : 1200,
      isAI: false,
      userId: opp.id != null ? opp.id : (opp.userId != null ? opp.userId : null),
    };
    // Build the game from the server position if given, else fresh start.
    try { s.game = newGame(s.size, s.rules, data.position || undefined); }
    catch (e) { s.game = newGame(s.size, s.rules); }
    toast('Matched with ' + s.opponent.username + ' (ELO ' + s.opponent.elo + ')', true);
    startGame(data.mode === 'ranked' ? 'ranked' : 'friendly');
  }

  function onMoveMade(data) {
    if (!data || !s.isOnline || !s.game) return;
    if (data.gameId !== s.gameId) return;
    var mv = data.move; if (!mv) return;
    // Authoritative position resync if provided.
    if (data.position) {
      try {
        var fresh = engine().load(data.position);
        s.game = fresh;
      } catch (e) { /* fall back to applying the move below */ }
    }
    // Determine the move's color: prefer payload, else infer.
    var moveColor = mv.color || (data.turn ? (data.turn === 'w' ? 'b' : 'w') : null);
    if (!data.position) {
      // Apply by notation/object if we didn't resync from a position.
      s.applyingRemote = true;
      var applied = s.game.move(mv.notation || mv);
      s.applyingRemote = false;
      if (applied) { afterMove(applied, false); return; }
    }
    // Resynced from position: just re-render + bookkeeping.
    if (mv.captures && mv.captures.length && moveColor && moveColor !== s.myColor) s.lostAnyPiece = true;
    s.lastMove = (typeof mv === 'object') ? mv : s.lastMove;
    render();
    if (s.game.isGameOver()) return; // server will send checkers_game_over
  }

  function onGameOver(data) {
    if (!data || !s.isOnline || data.gameId !== s.gameId) return;
    var me = ctUser();
    var winnerColor = null;
    if (data.winner === 'w' || data.winner === 'b') winnerColor = data.winner;
    else if (data.winnerId != null && me) winnerColor = (String(data.winnerId) === String(me.id)) ? s.myColor : (s.myColor === 'w' ? 'b' : 'w');
    s.ended = true;
    finishGame(winnerColor, data.reason || 'unknown');
    s.isOnline = false;
    s.gameId = null;
    // Refresh checkers stats from the server.
    if (window.CT_Checkers_UI && window.CT_Checkers_UI.refreshStats) window.CT_Checkers_UI.refreshStats();
  }

  function onErr(data) { toast('Checkers: ' + ((data && data.error) || 'server error')); }

  // ---------------------------------------------------------------------------
  //  FINISH GAME — result modal + trophies (mirrors chess finishGame)
  // ---------------------------------------------------------------------------
  function finishGame(winnerColor, reason) {
    if (s.ended && !s.isOnline) { /* allow */ }
    s.ended = true;
    var me = ctUser();
    var c = CT();
    var isDraw = (winnerColor == null);
    var myWon = (winnerColor === s.myColor);

    try { if (window.ChessSounds) { if (!isDraw) window.ChessSounds.gameOver(myWon); } } catch (e) {}

    var rewards = [];
    var ranked = (s.mode === 'ranked');

    if (me) {
      me.checkers = me.checkers || { elo8: 1200, elo10: 1200, wins: 0, losses: 0, draws: 0, streak: 0 };
      if (ranked) {
        // Local provisional ELO update (server reconciles authoritatively).
        var key = (s.size === 10) ? 'elo10' : 'elo8';
        var myElo = me.checkers[key] || 1200;
        var oppElo = (s.opponent && s.opponent.elo) || 1200;
        var score = isDraw ? 0.5 : (myWon ? 1 : 0);
        var games = (me.checkers.wins || 0) + (me.checkers.losses || 0) + (me.checkers.draws || 0);
        var delta = eloDelta(myElo, oppElo, score, games);
        me.checkers[key] = myElo + delta;
        if (isDraw) me.checkers.draws = (me.checkers.draws || 0) + 1;
        else if (myWon) { me.checkers.wins = (me.checkers.wins || 0) + 1; me.checkers.streak = (me.checkers.streak || 0) + 1; }
        else { me.checkers.losses = (me.checkers.losses || 0) + 1; me.checkers.streak = 0; }
        rewards.push('<div class="card row between"><div>Checkers ELO</div><div class="pill ' + (delta >= 0 ? 'success' : 'danger') + '">' + (delta >= 0 ? '+' : '') + delta + ' (now ' + me.checkers[key] + ')</div></div>');
      } else {
        rewards.push('<div class="card center muted">' + (s.mode === 'friendly' ? 'Friendly match — unrated.' : 'Practice game — no rating change.') + '</div>');
      }

      // --- FLAG trophies (checkers-scoped) ---
      me.flags = me.flags || {};
      if (s.maxJumpThisTurn >= 3) me.flags.ckTripleJump = (me.flags.ckTripleJump || 0) + 1;
      if (myWon && s.size === 10 && s.hadKing) me.flags.ckFlyingKingWin = (me.flags.ckFlyingKingWin || 0) + 1;
      if (myWon && !s.lostAnyPiece) me.flags.ckShutout = (me.flags.ckShutout || 0) + 1;

      // Run the trophy check (covers checkers_elo / checkers_games / ck flags).
      var unlocked = (c && c.checkAchievementsFor) ? c.checkAchievementsFor(me, { justWon: myWon }) : [];
      (unlocked || []).filter(Boolean).forEach(function (a) {
        var color = (c && c.tierColor) ? c.tierColor(a.tier || 1) : '#f5c451';
        var oops = a.embarrassing;
        rewards.push('<div class="card row" style="gap:12px;border-color:' + color + 'aa">' +
          '<div style="font-size:30px">' + a.icon + '</div>' +
          '<div style="flex:1"><div style="font-weight:700">' + (a.hidden ? '🔓 Hidden trophy unlocked' : 'Trophy unlocked') +
          '<span class="pill" style="background:' + color + '22;color:' + color + ';margin-left:6px">' + esc(a.family) + '</span></div>' +
          '<div>' + esc(a.name) + ' — <span class="muted small">' + esc(a.desc) + '</span></div></div></div>');
      });

      // Persist + record daily play.
      var db = loadDB();
      if (db.users[me.id]) { db.users[me.id] = me; saveDB(db); }
      if (c && c.state) c.state.user = me;
      if (c && c.recordDailyPlay) c.recordDailyPlay();
      if (window.CT_syncProgress) try { window.CT_syncProgress(); } catch (e) {}
    }

    // Result modal (reuses the chess #modal-result element).
    var title, body;
    if (isDraw) { title = 'Draw'; body = reasonText(reason, 'draw'); }
    else if (myWon) { title = 'Victory! 🏆'; body = reasonText(reason, 'win'); }
    else { title = 'Defeat'; body = reasonText(reason, 'loss'); }
    var tEl = $('#result-title'), bEl = $('#result-body'), rEl = $('#result-rewards');
    if (tEl) tEl.textContent = title;
    if (bEl) bEl.textContent = body;
    if (rEl) rEl.innerHTML = rewards.join('');
    // Hide chess-only result controls (rematch/review/block) for checkers.
    hide('#rematch-ui'); hide('#btn-result-review'); hide('#btn-result-block');
    openModal('result');
    var unlockedCount = (function(){ try { return rewards.filter(function(x){return /Trophy unlocked/.test(x);}).length; } catch(e){ return 0; } })();
    if (unlockedCount > 0) celebrate(unlockedCount >= 2 ? 'big' : 'normal');
    else if (myWon) celebrate('normal');
  }
  function hide(sel) { var el = $(sel); if (el) el.style.display = 'none'; }
  function reasonText(reason, kind) {
    if (kind === 'draw') return reason === 'no-progress' ? 'Draw — no progress.' : reason === 'threefold' ? 'Draw by repetition.' : 'Draw.';
    if (kind === 'win') return reason === 'resignation' ? 'Your opponent resigned.' : reason === 'no-moves' ? 'Your opponent has no moves left.' : reason === 'timeout' ? 'You won on time.' : 'You won.';
    return reason === 'resignation' ? 'You resigned.' : reason === 'no-moves' ? 'You have no moves left.' : reason === 'timeout' ? 'You lost on time.' : 'Your opponent won.';
  }

  // Local ELO delta (mirror app.js eloDelta; server is authoritative for ranked).
  function eloDelta(a, b, scoreA, gamesA) {
    var K = (gamesA || 0) < 30 ? 40 : (a >= 2400 ? 10 : 20);
    var expected = 1 / (1 + Math.pow(10, (b - a) / 400));
    return Math.round(K * (scoreA - expected));
  }

  // ---------------------------------------------------------------------------
  //  RESIGN / BACK
  // ---------------------------------------------------------------------------
  function resign() {
    if (!s.game || s.ended) return;
    if (!confirm('Resign this checkers game?')) return;
    if (s.isOnline && s.gameId && window.CTNet && window.CTNet.isReady()) {
      resignCheckers(s.gameId);
      return;
    }
    finishGame(s.myColor === 'w' ? 'b' : 'w', 'resignation');
  }

  // ---------------------------------------------------------------------------
  //  ONLINE WIRE — CTNet listeners + emit helpers
  // ---------------------------------------------------------------------------
  // The actual emit/on helpers live on CTNet (added in ct-net.js). These thin
  // wrappers centralize the call sites so the contract is easy to retarget.
  function joinCheckersQueue(mode, size, rules, tc) { return window.CTNet && window.CTNet.joinCheckersQueue && window.CTNet.joinCheckersQueue(mode, size, rules, tc); }
  function leaveCheckersQueue() { return window.CTNet && window.CTNet.leaveCheckersQueue && window.CTNet.leaveCheckersQueue(); }
  function sendCheckersMove(gameId, move) { return window.CTNet && window.CTNet.sendCheckersMove && window.CTNet.sendCheckersMove({ gameId: gameId, move: move }); }
  function resignCheckers(gameId) { return window.CTNet && window.CTNet.resignCheckers && window.CTNet.resignCheckers(gameId); }
  function inviteCheckersChallenge(friendId, size, rules, tc) { return window.CTNet && window.CTNet.inviteCheckersChallenge && window.CTNet.inviteCheckersChallenge(friendId, size, rules, tc); }

  // Move serialization for the wire: notation is the unambiguous, server-friendly
  // form documented by the engine (e.g. "9x18x25"). Include from/to/captures too.
  function serializeMove(m) {
    return { notation: m.notation, from: m.from, to: m.to, captures: m.captures, color: m.color };
  }

  // Register the CTNet checkers listeners. Idempotent: we off() before on() so a
  // socket reconnect (which resets CTNet's listener map) re-registers cleanly and
  // a double call never double-fires. Safe to call before CTNet exists (no-op).
  function wireNet() {
    if (!window.CTNet || !window.CTNet.on) return;
    var pairs = [
      ['checkersMatchFound', onMatchFound],
      ['checkersMoveMade', onMoveMade],
      ['checkersGameOver', onGameOver],
      ['checkersErr', onErr],
      ['checkersChallengeReceived', onChallengeReceived],
    ];
    for (var i = 0; i < pairs.length; i++) {
      try { if (window.CTNet.off) window.CTNet.off(pairs[i][0], pairs[i][1]); } catch (e) {}
      window.CTNet.on(pairs[i][0], pairs[i][1]);
    }
  }
  function onChallengeReceived(data) {
    if (!data) return;
    s._pendingChallenge = data; // { inviteId, fromName, fromElo, size, rules }
    var body = $('#ck-challenge-invite-body');
    if (body) body.textContent = (data.fromName || 'A friend') + ' challenged you to ' +
      ((data.size === 10) ? '10x10 ' : '8x8 ') + rulesLabel(data.rules, data.size) + ' checkers.';
    openModal('ck-challenge-invite');
  }

  // ---------------------------------------------------------------------------
  //  STATS — read checkers Elo/W-L from /api/me and store on state.user.checkers
  // ---------------------------------------------------------------------------
  function applyCheckersProfile(profile) {
    var me = ctUser();
    if (!me || !profile) return;
    me.checkers = me.checkers || { elo8: 1200, elo10: 1200, wins: 0, losses: 0, draws: 0, streak: 0 };
    if (profile.elo_checkers_8 != null) me.checkers.elo8 = profile.elo_checkers_8;
    if (profile.elo_checkers_10 != null) me.checkers.elo10 = profile.elo_checkers_10;
    if (profile.checkers_wins != null) me.checkers.wins = profile.checkers_wins;
    if (profile.checkers_losses != null) me.checkers.losses = profile.checkers_losses;
    if (profile.checkers_draws != null) me.checkers.draws = profile.checkers_draws;
    if (profile.checkers_streak != null) me.checkers.streak = profile.checkers_streak;
    var db = loadDB(); if (db.users[me.id]) { db.users[me.id] = me; saveDB(db); }
    var c = CT(); if (c && c.checkAchievementsFor) c.checkAchievementsFor(me); // catch checkers_elo/games
  }
  function refreshStats() {
    var A = window.CT_Auth;
    if (!A || !A.isServerLoggedIn || !A.isServerLoggedIn() || !A.fetchMe) return Promise.resolve();
    return A.fetchMe().then(function (profile) { applyCheckersProfile(profile); }).catch(function () {});
  }

  // ---------------------------------------------------------------------------
  //  STATIC HANDLER WIRING (CSP-safe; addEventListener only)
  // ---------------------------------------------------------------------------
  function wireDom() {
    var resignBtn = $('#ck-btn-resign'); if (resignBtn) resignBtn.addEventListener('click', resign);
    var flipBtn = $('#ck-btn-flip'); if (flipBtn) flipBtn.addEventListener('click', function () {
      s.orientation = s.orientation === 'w' ? 'b' : 'w'; setupGameScreen(); render();
    });
    var backBtn = $('#ck-btn-back'); if (backBtn) backBtn.addEventListener('click', function () {
      if (s.game && !s.ended) { if (!confirm('Leave this checkers game? It counts as a resignation.')) return; resignSilent(); }
      showScreen('lobby');
    });
    var mmCancel = $('#ck-btn-mm-cancel'); if (mmCancel) mmCancel.addEventListener('click', function () {
      stopMatchmaking(); leaveCheckersQueue(); closeModal('ck-matchmaking');
    });
    var chAccept = $('#ck-btn-challenge-accept'); if (chAccept) chAccept.addEventListener('click', function () {
      var pc = s._pendingChallenge; closeModal('ck-challenge-invite');
      if (pc && window.CTNet && window.CTNet.acceptCheckersChallenge) { waitingMatch = true; window.CTNet.acceptCheckersChallenge(pc.inviteId); }
    });
    var chDecline = $('#ck-btn-challenge-decline'); if (chDecline) chDecline.addEventListener('click', function () {
      var pc = s._pendingChallenge; closeModal('ck-challenge-invite');
      if (pc && window.CTNet && window.CTNet.declineCheckersChallenge) window.CTNet.declineCheckersChallenge(pc.inviteId);
      s._pendingChallenge = null;
    });
    var chWaitCancel = $('#ck-btn-challenge-wait-cancel'); if (chWaitCancel) chWaitCancel.addEventListener('click', function () {
      waitingMatch = false; closeModal('ck-challenge-wait');
    });
  }
  function resignSilent() {
    if (s.isOnline && s.gameId && window.CTNet && window.CTNet.isReady()) { resignCheckers(s.gameId); return; }
    finishGame(s.myColor === 'w' ? 'b' : 'w', 'resignation');
  }

  // Inject scoped styles for the checkers board (kept here so index.html stays
  // close to the chess structure; style-src 'unsafe-inline' is allowed).
  function injectStyles() {
    if (document.getElementById('ck-styles')) return;
    var st = document.createElement('style');
    st.id = 'ck-styles';
    st.textContent =
      '#checkers-board{display:grid;aspect-ratio:1/1;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.4);user-select:none;}' +
      '.ck-sq{position:relative;display:flex;align-items:center;justify-content:center;aspect-ratio:1/1;min-width:0;min-height:0;cursor:default;}' +
      '.ck-light{background:var(--light-sq,#e9e2cf);}' +
      '.ck-dark{background:var(--dark-sq,#6b7a52);cursor:pointer;}' +
      '.ck-piece{width:84%;height:84%;display:flex;align-items:center;justify-content:center;pointer-events:none;}' +
      '.ck-piece .ck-disc{width:100%;height:100%;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35));}' +
      '.ck-selected{box-shadow:inset 0 0 0 4px var(--accent,#f5c451);}' +
      '.ck-last{box-shadow:inset 0 0 0 4px rgba(245,196,81,.45);}' +
      '.ck-forced{box-shadow:inset 0 0 0 3px rgba(248,113,113,.8);}' +
      '.ck-dot{width:30%;height:30%;border-radius:50%;background:var(--move-dot,rgba(0,0,0,.4));opacity:.8;pointer-events:none;position:absolute;}' +
      '.ck-ring{position:absolute;inset:6%;border-radius:50%;box-shadow:inset 0 0 0 4px var(--move-dot,rgba(0,0,0,.45));pointer-events:none;}' +
      '.ck-captured{display:flex;flex-wrap:wrap;gap:2px;margin-top:2px;}' +
      '.ck-cap{width:16px;height:16px;display:inline-flex;}';
    document.head.appendChild(st);
  }

  function boot() {
    injectStyles();
    wireDom();
    wireNet();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // Public API
  window.CT_Checkers_UI = {
    startPractice: startPractice,
    startFindRanked: startFindRanked,
    inviteFriend: inviteFriend,
    onMatchFound: onMatchFound,
    onMoveMade: onMoveMade,
    onGameOver: onGameOver,
    onErr: onErr,
    wireNet: wireNet,
    render: render,
    refreshStats: refreshStats,
    applyCheckersProfile: applyCheckersProfile,
    resolveRules: resolveRules,
    resignActive: resignSilent,
    isActive: function () { return !!(s.game && !s.ended && document.querySelector('#screen-checkers.active')); },
    get state() { return s; },
  };
})();
