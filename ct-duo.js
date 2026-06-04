/* ct-duo.js — ChessTrophies 2v2 team chess ("Duo") client, extracted from app.js.
 *
 * One board, relay turns: White = you + partner, Black = two opponents. Online
 * play is server-authoritative (moves, clocks and result all come from the
 * server). This module owns the duo board UI + state, but leans on a handful of
 * app.js helpers (DOM, storage, clocks, trophies). app.js passes them in once
 * via window.CT_Duo.install(ctx), which also publishes window.Duo + window.__duo.
 */
(function () {
  'use strict';

  // App-side dependencies, injected by app.js via install(). Declared here so the
  // duo functions below close over them; populated before any of them can run.
  var state, loadDB, saveDB, unlockAchievement, showScreen, $, squareName,
      pieceSVG, escapeHTML, clockStop, clockSync, clockState, ctCelebrate,
      eloKFactor, fetchMe, syncRemoteProfile, Chess;

  var duo = {
    game: null, mode: null, ranked: false,
    selected: null, legalTargets: [], lastMove: null,
    teammate: null,   // { name, isAI }
    teammateId: null,
    opp1: null, opp2: null, // opponent team members (sim/AI/users)
    seat: 0,          // whose turn within current color (0/1)
    suggestion: null, // { from, to } from partner during your turn
    over: false, ended: false,
    overrides: 0, accepts: 0,
    youColor: 'w',
    aiLevel: 'medium',
    sawQueenDown: false,
  };
  // 2v2: map the two clock cards to team colors. Your team is always at the
  // bottom (the board flips when youColor === 'b'). w/b in the payload are
  // per-TEAM remaining ms.
  function duoClockMap() {
    return {
      topEl: document.getElementById('duo-clock-top'),
      botEl: document.getElementById('duo-clock-bot'),
      topSide: duo.youColor === 'w' ? 'b' : 'w',
      botSide: duo.youColor,
    };
  }
  function duoShowClockCards(show) {
    const t = document.getElementById('duo-card-top');
    const b = document.getElementById('duo-card-bot');
    if (t) t.style.display = show ? '' : 'none';
    if (b) b.style.display = show ? '' : 'none';
    const tl = document.getElementById('duo-top-label');
    const bl = document.getElementById('duo-bot-label');
    if (tl) tl.textContent = 'Opponents';
    if (bl) bl.textContent = 'Your team';
  }

  // Is it the human player's seat to move right now?
  function duoIsYourTurn() {
    if (!duo.game || duo.over) return false;
    const turn = duo.game.turn();
    if (turn !== duo.youColor) return false;
    const seatToMove = (duo.turnCount ? duo.turnCount[duo.youColor] : 0) % 2;
    const mySeat = (typeof duo.youSeat === 'number') ? duo.youSeat : 0; // practice: always seat 0
    return seatToMove === mySeat;
  }

  function duoStart(opts) {
    // opts: { ranked, online?, gameId?, youColor?, youSeat?, partnerId?,
    //         teammateName, teammateIsAI, aiLevel,
    //         whiteRoster?, blackRoster?, whiteAvgElo?, blackAvgElo? }
    const db = loadDB();
    duo.game = new Chess();
    duo.ranked = !!opts.ranked;
    duo.online = !!opts.online;
    duo.gameId = opts.gameId || null;
    duo.mode = duo.online ? 'team-ranked' : (opts.ranked ? 'ranked' : 'private');
    duo.aiLevel = opts.aiLevel || 'medium';
    duo.youColor = opts.youColor || 'w';
    duo.youSeat = (typeof opts.youSeat === 'number') ? opts.youSeat : 0;
    duo.seat = 0;
    duo.turnCount = { w: 0, b: 0 };
    duo.selected = null; duo.legalTargets = []; duo.lastMove = null;
    duo.suggestion = null; duo.over = false; duo.ended = false;
    duo.overrides = 0; duo.accepts = 0; duo.sawQueenDown = false;
    duo._awaitingServerMove = null;
    duo.partnerId = opts.partnerId || null;
    duo.teammateId = opts.teammateId || null;
    duo.teammate = { name: opts.teammateName || 'Ally', isAI: opts.teammateIsAI !== false };

    if (duo.online && opts.whiteRoster && opts.blackRoster) {
      // Roster comes from the server. Map to opp1/opp2 (the opposing team's seats 0/1)
      // and partner display (the teammate's seat).
      const myRoster = duo.youColor === 'w' ? opts.whiteRoster : opts.blackRoster;
      const enemyRoster = duo.youColor === 'w' ? opts.blackRoster : opts.whiteRoster;
      duo.opp1 = { name: enemyRoster.p1.username, elo: enemyRoster.p1.elo, userId: enemyRoster.p1.id };
      duo.opp2 = { name: enemyRoster.p2.username, elo: enemyRoster.p2.elo, userId: enemyRoster.p2.id };
      const partnerPub = duo.youSeat === 0 ? myRoster.p2 : myRoster.p1;
      duo.teammate = { name: partnerPub.username, isAI: false, elo: partnerPub.elo, userId: partnerPub.id };
    } else {
      const pool = ['Nova','Rook','Blaze','Sable','Vega','Onyx','Quill','Drift'];
      duo.opp1 = { name: pool[Math.floor(Math.random()*pool.length)] };
      duo.opp2 = { name: pool[Math.floor(Math.random()*pool.length)] };
    }

    // Award "played a 2v2" trophy
    try {
      const me = state.user;
      if (me) { unlockAchievement(me, 'duo_first'); { const _db = loadDB(); if (state.user) _db.users[state.user.id] = state.user; saveDB(_db); } }
    } catch(e){}
    // Reset clocks; an online clocked game re-inits them in duoStartOnline.
    clockStop();
    duoShowClockCards(false);
    showScreen('duo');
    duoRender();
    duoUpdateStatus();
    if (!duo.online) duoComputeSuggestion();
  }

  // Advance one ply has been made; rotate seat and drive AI seats.
  function duoAfterPly(move) {
    duo.lastMove = move ? { from: move.from, to: move.to } : null;
    duo.selected = null; duo.legalTargets = [];
    // sound
    try {
      if (window.ChessSounds) {
        if (move && move.captured) window.ChessSounds.capture();
        else window.ChessSounds.move();
        if (duo.game.in_check()) setTimeout(() => window.ChessSounds.check(), 80);
      }
    } catch(e){}
    // track queen-down for comeback trophy (your side lost its queen earlier)
    try {
      const fen = duo.game.fen();
      const youHasQ = duo.youColor === 'w' ? fen.split(' ')[0].includes('Q') : fen.split(' ')[0].includes('q');
      if (!youHasQ) duo.sawQueenDown = true;
    } catch(e){}
    if (duo.game.game_over()) { duoRender(); duoUpdateStatus(); duoFinish(); return; }
    // seat rotates each ply within the same color until color flips
    // A team just completed its single move (normal chess: teams alternate).
    // Record that this team took a turn, then the chooser within each team
    // alternates (0->1->0...) the NEXT time that team is on move.
    const moved = duo.game.turn() === 'w' ? 'b' : 'w'; // side that just moved
    if (!duo.turnCount) duo.turnCount = { w: 0, b: 0 };
    duo.turnCount[moved] = (duo.turnCount[moved] || 0) + 1;
    duo.seat = (duo.turnCount[duo.game.turn()] || 0) % 2; // chooser for side now on move
    duoRender();
    duoUpdateStatus();
    // Drive non-human seats
    duoDriveTurn();
  }

  // Decide who controls the current ply and auto-play AI/sim seats.
  // Online (server-authoritative): no auto-play; we just wait for the next
  // server move_made event.
  function duoDriveTurn() {
    if (duo.over || !duo.game || duo.game.game_over()) return;
    // Server-authoritative: just refresh status and wait for the next
    // server move_made event. (2v2 is online-only — no AI seats.)
    duoUpdateStatus();
  }

  // Online 2v2 has no AI partner, so there is never a suggestion to show.
  function duoComputeSuggestion() {
    duo.suggestion = null;
    duoRenderSuggestion();
  }

  // Human accepts the partner suggestion.
  function duoAcceptSuggestion() {
    if (!duo.suggestion || !duoIsYourTurn()) return;
    const s = duo.suggestion;
    const applied = duo.game.move({ from: s.from, to: s.to, promotion: s.promotion || 'q' });
    if (!applied) return;
    duo.accepts++;
    try { const me = state.user; if (me) { me.duoSuggestAccepts = (me.duoSuggestAccepts||0)+1; if (me.duoSuggestAccepts >= 10) unlockAchievement(me, 'duo_synergy'); { const _db = loadDB(); if (state.user) _db.users[state.user.id] = state.user; saveDB(_db); } } } catch(e){}
    duoAfterPly(applied);
  }

  // Human clicks a board square during their seat.
  function duoClick(name) {
    if (!duoIsYourTurn()) return;
    if (duo._awaitingServerMove) return; // already sent a move, waiting for echo
    const g = duo.game;
    const piece = g.get(name);
    if (duo.selected) {
      if (duo.selected === name) { duo.selected = null; duo.legalTargets = []; duoRender(); return; }
      // try move
      const legal = g.moves({ square: duo.selected, verbose: true }).find(m => m.to === name);
      if (legal) {
        // count as override if it differs from partner suggestion (practice only — no suggestion online)
        if (duo.suggestion && !(duo.suggestion.from === duo.selected && duo.suggestion.to === name)) {
          duo.overrides++;
        }
        if (duo.online) {
          // Server-authoritative: send and wait for move_made to apply.
          duo._awaitingServerMove = { from: duo.selected, to: name };
          duo.selected = null; duo.legalTargets = [];
          duoUpdateStatus();
          try {
            window.CTNet.sendMove({ gameId: duo.gameId, from: duo._awaitingServerMove.from, to: duo._awaitingServerMove.to });
          } catch (e) { console.error('[Duo] sendMove failed', e); duo._awaitingServerMove = null; }
          duoRender();
          return;
        }
        const applied = g.move({ from: duo.selected, to: name, promotion: 'q' });
        duoAfterPly(applied);
        return;
      }
      if (piece && piece.color === duo.youColor) { duoSelect(name); return; }
      duo.selected = null; duo.legalTargets = []; duoRender(); return;
    }
    if (piece && piece.color === duo.youColor) duoSelect(name);
  }

  // Apply a move received from the server (online team game).
  function duoApplyServerMove(data) {
    if (!duo.online || !duo.game || duo.gameId !== data.gameId) return;
    const mv = data.move;
    if (!mv) return;
    // Re-sync the team clocks from the server on every move.
    if (data.clock && clockState.active) {
      const mp = duoClockMap();
      clockSync(data.clock, mp.topEl, mp.botEl, mp.topSide, mp.botSide);
    }
    duo._awaitingServerMove = null;
    const applied = duo.game.move({ from: mv.from, to: mv.to, promotion: mv.promotion || 'q' });
    if (!applied) {
      console.warn('[Duo] server move did not apply locally; reloading from fen');
      try { duo.game.load(data.fen); } catch (e) { console.error(e); }
    }
    // Use afterPly to handle animations/sound/turn-count update.
    duoAfterPly(applied || { from: mv.from, to: mv.to, captured: mv.captured, color: mv.color, flags: mv.flags, piece: mv.piece });
  }

  function duoHandleServerGameOver(data) {
    if (!duo.online || duo.gameId !== data.gameId) return;
    duo.ended = true; duo.over = true;
    clockStop();
    const winnerColor = data.winnerColor || null;
    const isDraw = !winnerColor;
    const youWon = winnerColor === duo.youColor;
    const me = state.user;
    let delta = 0;
    if (me && data.perPlayerDelta) {
      delta = data.perPlayerDelta[me.id] || 0;
      me.elo2v2 = Math.max(100, Math.min(2800, (me.elo2v2 || 1200) + delta));
      try { const _db = loadDB(); if (me && me.id) _db.users[me.id] = me; saveDB(_db); } catch (e) {}
    }
    try { if (window.ChessSounds) { if (isDraw) window.ChessSounds.note && window.ChessSounds.note(523,0.4,'sine',0.18); else window.ChessSounds.gameOver(youWon); } } catch (e) {}
    if (youWon && typeof ctCelebrate === 'function') { try { ctCelebrate('big'); } catch (e) {} }
    duoShowResult(youWon, isDraw, data.reason || 'unknown', delta);
    // Re-sync server-side stats (wins_2v2, etc) so the lobby reflects them.
    if (window.fetch && typeof fetchMe === 'function' && typeof syncRemoteProfile === 'function') {
      fetchMe().then(syncRemoteProfile).catch(() => {});
    }
    duo.online = false;
    duo.gameId = null;
  }

  function duoSelect(name) {
    duo.selected = name;
    duo.legalTargets = duo.game.moves({ square: name, verbose: true }).map(m => m.to);
    duoRender();
  }

  function duoRender() {
    const el = $('#duo-board');
    if (!el || !duo.game) return;
    el.innerHTML = '';
    const board = duo.game.board();
    const flip = duo.youColor === 'b';
    for (let r = 7; r >= 0; r--) {
      for (let f = 0; f < 8; f++) {
        const rr = flip ? 7 - r : r;
        const ff = flip ? 7 - f : f;
        const sq = document.createElement('div');
        const isLight = (rr + ff) % 2 === 1;
        const name = squareName(ff, rr);
        sq.className = 'sq ' + (isLight ? 'light' : 'dark');
        sq.dataset.sq = name;
        const pieceObj = board[7 - rr][ff];
        if (pieceObj) sq.innerHTML = pieceSVG(pieceObj.type, pieceObj.color);
        if (duo.selected === name) sq.classList.add('selected');
        if (duo.legalTargets.indexOf(name) !== -1) sq.classList.add('target');
        if (duo.lastMove && (duo.lastMove.from === name || duo.lastMove.to === name)) sq.classList.add('lastmove');
        if (duo.suggestion && duoIsYourTurn() && (duo.suggestion.from === name || duo.suggestion.to === name)) sq.classList.add('duo-suggest-sq');
        sq.addEventListener('click', () => duoClick(name));
        el.appendChild(sq);
      }
    }
  }

  function duoColorLabel(c) { return c === 'w' ? 'White' : 'Black'; }

  function duoUpdateStatus() {
    const s = $('#duo-status'); if (!s || !duo.game) return;
    const turn = duo.game.turn();
    let who;
    if (turn === duo.youColor) who = duo.seat === 0 ? 'Your move' : duo.teammate.name + ' (partner) is thinking\u2026';
    else who = (duo.seat === 0 ? duo.opp1.name : duo.opp2.name) + ' (opponent) is thinking\u2026';
    let extra = '';
    if (duo.game.in_check()) extra = ' \u2014 Check!';
    s.textContent = who + extra;
  }

  function duoRenderSuggestion() {
    const p = $('#duo-suggest'); if (!p) return;
    if (duo.suggestion && duoIsYourTurn()) {
      const sanTxt = duo.suggestion.san || (duo.suggestion.from + '\u2192' + duo.suggestion.to);
      p.style.display = '';
      p.innerHTML = '<div class="duo-suggest-row"><span>\ud83e\udd1d ' + escapeHTML(duo.teammate.name) + ' suggests: <b>' + escapeHTML(sanTxt) + '</b></span>' +
        '<span><button id="duo-accept" class="btn btn-secondary" style="padding:6px 12px">Play it</button> ' +
        '<button id="duo-ignore" class="btn" style="padding:6px 12px">I\u2019ll decide</button></span></div>';
      const a = $('#duo-accept'); if (a) a.addEventListener('click', duoAcceptSuggestion);
      const ig = $('#duo-ignore'); if (ig) ig.addEventListener('click', () => { p.style.display='none'; });
    } else { p.style.display = 'none'; p.innerHTML = ''; }
  }

  function duoFinish() {
    if (duo.ended) return;
    // Online: defer to the server's game_over event for authoritative result/ELO.
    if (duo.online) { duo.ended = true; duo.over = true; return; }
    duo.ended = true; duo.over = true;
    const g = duo.game;
    let winnerColor = null, reason = 'draw';
    if (g.in_checkmate()) { winnerColor = g.turn() === 'w' ? 'b' : 'w'; reason = 'checkmate'; }
    else if (g.in_stalemate()) { reason = 'stalemate'; }
    else if (g.in_draw() || g.insufficient_material() || g.in_threefold_repetition()) { reason = 'draw'; }
    const youWon = winnerColor === duo.youColor;
    const isDraw = winnerColor === null;
    const me = state.user;
    let delta = 0;
    if (me) {
      me.games2v2 = (me.games2v2||0) + 1; // count completed game
      if (youWon) { me.wins2v2 = (me.wins2v2||0)+1; me.currentStreak2v2 = (me.currentStreak2v2||0)+1; me.bestStreak2v2 = Math.max(me.bestStreak2v2||0, me.currentStreak2v2); }
      else if (isDraw) { me.draws2v2 = (me.draws2v2||0)+1; me.currentStreak2v2 = 0; }
      else { me.losses2v2 = (me.losses2v2||0)+1; me.currentStreak2v2 = 0; }
      // ELO (ranked 2v2 only): team rating vs a simulated team rating near yours
      if (duo.ranked) {
        const myR = me.elo2v2 || 1200;
        const oppR = Math.max(400, myR + Math.floor((Math.random()-0.5)*200));
        const score = isDraw ? 0.5 : (youWon ? 1 : 0);
        const k = (typeof eloKFactor === 'function') ? eloKFactor(myR, me.games2v2||0) : 24;
        delta = Math.round(k * (score - (1/(1+Math.pow(10,(oppR-myR)/400)))));
        me.elo2v2 = Math.max(100, Math.min(2800, myR + delta));
        if (!Array.isArray(me.ratingHistory2v2)) me.ratingHistory2v2 = [myR];
        me.ratingHistory2v2.push(me.elo2v2);
        if (me.ratingHistory2v2.length > 30) me.ratingHistory2v2 = me.ratingHistory2v2.slice(-30);
      }
      // Trophies
      if (youWon) {
        unlockAchievement(me, 'duo_win1');
        if ((me.wins2v2||0) >= 10) unlockAchievement(me, 'duo_win10');
        if ((me.wins2v2||0) >= 25) unlockAchievement(me, 'duo_win25');
        if ((me.currentStreak2v2||0) >= 3) unlockAchievement(me, 'duo_streak3');
        if ((me.currentStreak2v2||0) >= 5) unlockAchievement(me, 'duo_streak5');
        if (duo.overrides > 0) { me.duoOverrideWins = (me.duoOverrideWins||0)+duo.overrides; if ((me.duoOverrideWins||0) >= 20) unlockAchievement(me, 'duo_maverick'); }
        if ((me.elo2v2||1200) >= 1600) unlockAchievement(me, 'duo_2400');
        if (duo.sawQueenDown) unlockAchievement(me, 'duo_comeback');
      }
      try { { const _db = loadDB(); if (state.user) _db.users[state.user.id] = state.user; saveDB(_db); } } catch(e){}
    }
    // celebrate / sound
    try { if (window.ChessSounds) { if (isDraw) window.ChessSounds.note && window.ChessSounds.note(523,0.4,'sine',0.18); else window.ChessSounds.gameOver(youWon); } } catch(e){}
    if (youWon && typeof ctCelebrate === 'function') { try { ctCelebrate('big'); } catch(e){} }
    duoShowResult(youWon, isDraw, reason, delta);
  }

  function duoShowResult(youWon, isDraw, reason, delta) {
    const s = $('#duo-status');
    const onTime = reason === 'timeout';
    if (s) s.textContent = isDraw ? 'Draw \u2014 ' + reason
      : (youWon ? ('Victory! Your team wins' + (onTime ? ' on time.' : '.'))
                : ('Defeat \u2014 your team lost' + (onTime ? ' on time.' : '.')));
    const p = $('#duo-suggest');
    if (p) {
      const dtxt = duo.ranked ? ('<div class="muted small">2v2 rating ' + (delta>=0?'+':'') + delta + ' (now ' + (state.user?state.user.elo2v2:'?') + ')</div>') : '<div class="muted small">Private match \u2014 no rating change.</div>';
      p.style.display = '';
      p.innerHTML = '<div style="text-align:center"><h3 style="margin:4px 0">' + (isDraw?'\ud83e\udd1d Draw':(youWon?'\ud83c\udfc6 Victory':'\ud83d\ude45 Defeat')) + '</h3>' + dtxt +
        '<button id="duo-again" class="btn btn-primary" style="margin-top:10px">Back to lobby</button></div>';
      const again = $('#duo-again'); if (again) again.addEventListener('click', () => { duo.over = true; duo.game = null; showScreen('lobby'); });
    }
  }

  // Forfeit / leave a 2v2 in progress (warns first).
  function duoQuit() {
    if (duo.game && !duo.ended && !duo.over) {
      if (!confirm('Are you sure you want to quit this 2v2 match?\n\nLeaving now counts as a forfeit for your team.')) return false;
      if (duo.online && duo.gameId && window.CTNet && window.CTNet.isReady()) {
        // Server-authoritative resign; the server will emit game_over to all 4 with
        // the real ELO deltas, which routes back through duoHandleServerGameOver.
        try { window.CTNet.resign(duo.gameId); } catch (e) { console.error(e); }
        duo.ended = true; duo.over = true;
        return true;
      }
      const me = state.user;
      if (me) { me.losses2v2 = (me.losses2v2||0)+1; me.currentStreak2v2 = 0; try { { const _db = loadDB(); if (state.user) _db.users[state.user.id] = state.user; saveDB(_db); } } catch(e){} }
      duo.ended = true; duo.over = true;
    }
    return true;
  }

  // Lobby entry points
  function duoStartPrivate(partnerName) {
    throw new Error('Private 2v2 is disabled. Use ranked 2v2 with four players on separate devices.');
  }

  // Online entry: caller passes the team_match_found payload.
  // Required fields: gameId, yourSide ('w'|'b'), yourSeat (0|1), partner (publicUser),
  // partnerId, white {p1,p2}, black {p1,p2}, whiteAvgElo, blackAvgElo.
  function duoStartOnline(m) {
    if (!m || !m.gameId) return;
    duoStart({
      ranked: true,
      online: true,
      gameId: m.gameId,
      youColor: m.yourSide,
      youSeat: m.yourSeat,
      partnerId: m.partnerId,
      teammateName: m.partner && m.partner.username || 'Partner',
      teammateIsAI: false,
      whiteRoster: m.white,
      blackRoster: m.black,
      whiteAvgElo: m.whiteAvgElo,
      blackAvgElo: m.blackAvgElo,
    });
    duo.tc = m.tc || null;
    // Clocked team game: show + start both team clocks (unlimited omits `clock`).
    if (m.clock) {
      duoShowClockCards(true);
      const mp = duoClockMap();
      clockSync(m.clock, mp.topEl, mp.botEl, mp.topSide, mp.botSide);
    }
  }

  // Wire up app.js dependencies and publish the public API. Called once by app.js.
  function install(ctx) {
    state = ctx.state; loadDB = ctx.loadDB; saveDB = ctx.saveDB;
    unlockAchievement = ctx.unlockAchievement; showScreen = ctx.showScreen;
    $ = ctx.$; squareName = ctx.squareName; pieceSVG = ctx.pieceSVG; escapeHTML = ctx.escapeHTML;
    clockStop = ctx.clockStop; clockSync = ctx.clockSync; clockState = ctx.clockState;
    ctCelebrate = ctx.ctCelebrate; eloKFactor = ctx.eloKFactor;
    fetchMe = ctx.fetchMe; syncRemoteProfile = ctx.syncRemoteProfile;
    Chess = ctx.Chess || (typeof window !== 'undefined' ? window.Chess : undefined);
    window.__duo = duo;
    window.Duo = {
      startOnline: duoStartOnline,
      startPrivate: duoStartPrivate,
      quit: duoQuit,
      accept: duoAcceptSuggestion,
      applyServerMove: duoApplyServerMove,
      handleServerGameOver: duoHandleServerGameOver,
      state: duo,
    };
    return window.Duo;
  }

  window.CT_Duo = { install: install };
})();
