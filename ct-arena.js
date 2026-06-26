/*
 * ct-arena.js — Arena tournaments UI (window.CT_Arena). Layer 3 of ARENA_DESIGN.md.
 *
 * Renders the lobby arena card + the #screen-arena live leaderboard, and drives
 * the join/leave loop over CTNet. Arena GAMES are ordinary online games with
 * mode:'arena' — they arrive via the normal `match_found` and are entered by
 * app.js's existing online flow; this module only handles the arena shell + the
 * continuous-play loop (join → paired → play → re-pool → paired again).
 *
 * Depends on (all optional — degrades to a hidden card if missing):
 *   • window.CT_Auth.api(path)      — authed JSON fetch (adds bearer token)
 *   • window.CTNet.joinArena/leaveArena + isReady
 *   • window.CT.{showScreen,toast,escapeHTML,user}
 *
 * app.js calls into us: isActive() (to accept arena match_found), onMatchStarted(),
 * onGameEnded(data); and forwards CTNet events to onJoined/onErr/onLeft.
 */
(function () {
  'use strict';

  var enabled = false;          // server reports arenas on
  var active = false;           // the user has JOINED and wants to be paired
  var arenaId = null;           // the live arena id we're tracking
  var lastData = null;          // last /api/arena/current payload
  var pollTimer = null;         // leaderboard refresh while on the arena screen
  var tickTimer = null;         // 1s countdown ticker
  var onArenaScreen = false;

  function api(path) {
    if (window.CT_Auth && typeof window.CT_Auth.api === 'function') return window.CT_Auth.api(path);
    return Promise.reject(new Error('CT_Auth.api unavailable'));
  }
  function esc(s) { return (window.CT && window.CT.escapeHTML) ? window.CT.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s); }
  function toast(m, ok) { if (window.CT && window.CT.toast) window.CT.toast(m, ok); }
  function $(id) { return document.getElementById(id); }
  function isSignedIn() {
    try { return !!(window.CT_Auth && window.CT_Auth.isServerLoggedIn && window.CT_Auth.isServerLoggedIn()); } catch (e) { return false; }
  }
  function netReady() { return !!(window.CTNet && window.CTNet.isReady && window.CTNet.isReady()); }

  // mm:ss (or h:mm:ss) from a millisecond span, clamped at 0.
  function fmtSpan(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var mm = (m < 10 && h > 0 ? '0' : '') + m, ss = (sec < 10 ? '0' : '') + sec;
    return (h > 0 ? h + ':' : '') + mm + ':' + ss;
  }

  // Countdown line for the banner from the current snapshot.
  function countdownText() {
    var d = lastData;
    if (!d || !d.enabled) return 'Arenas are off right now.';
    var now = Date.now();
    if (d.live) {
      var endsIn = Number(d.live.endsAt) - now;
      if (endsIn > 0) return 'Ends in ' + fmtSpan(endsIn) + ' · ' + (d.live.players || 0) + ' playing';
    }
    if (d.next) {
      var startsIn = Number(d.next.startsAt) - now;
      if (startsIn > 0) return 'Next arena starts in ' + fmtSpan(startsIn);
    }
    return 'Starting…';
  }

  function renderLeaderboard(top, myId) {
    var list = $('arena-list');
    if (!list) return;
    if (!top || !top.length) {
      list.innerHTML = '<div class="card muted small" style="text-align:center">No games played yet — be the first to score.</div>';
      return;
    }
    list.innerHTML = top.map(function (r) {
      var me = myId && r.userId === myId;
      var fire = r.onFire ? ' <span title="on a win streak">🔥' + (r.streak || '') + '</span>' : '';
      return '<div class="card row between" style="padding:10px 12px;margin-bottom:6px;' + (me ? 'border-color:var(--accent)' : '') + '">' +
        '<div style="display:flex;align-items:center;gap:10px;min-width:0">' +
        '<div class="pill" style="min-width:26px;text-align:center">' + r.rank + '</div>' +
        '<div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.username) + (me ? ' <span class="muted small">(you)</span>' : '') + fire + '</div>' +
        '</div>' +
        '<div style="text-align:right;white-space:nowrap"><b>' + r.points + '</b> <span class="muted small">pts · ' + (r.games || 0) + 'g</span></div>' +
        '</div>';
    }).join('');
  }

  // Update the join/leave control + status line for the current state.
  function renderControl() {
    var btn = $('btn-arena-join');
    var status = $('arena-status');
    if (!btn) return;
    var d = lastData;
    var liveExists = !!(d && d.live);
    if (!liveExists) {
      btn.textContent = 'Join arena';
      btn.disabled = true;
      if (status) status.textContent = d && d.next ? 'The next arena hasn\'t started yet. Hang tight.' : 'No arena is live right now.';
      return;
    }
    btn.disabled = false;
    if (active) {
      btn.textContent = 'Leave arena';
      btn.classList.add('btn-secondary');
    } else {
      btn.textContent = 'Join arena';
      btn.classList.remove('btn-secondary');
      if (status) status.textContent = 'Win games to climb the live leaderboard. Bots fill in so there\'s always an opponent.';
    }
  }

  function setStatus(msg) { var s = $('arena-status'); if (s) s.textContent = msg; }

  function renderChampions(champs) {
    var el = $('arena-champions');
    if (!el) return;
    if (!champs || !champs.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="muted small" style="margin-bottom:6px">🏆 Recent champions</div>' +
      champs.map(function (c) {
        return '<div class="row between" style="padding:4px 2px"><span>' + esc(c.name) + '</span><span class="muted small">' + esc(c.champion) + '</span></div>';
      }).join('');
  }

  // Fetch the current arena snapshot + (if signed in) the caller's standing, and
  // paint the arena screen.
  function render() {
    return api('/api/arena/current').then(function (d) {
      lastData = d || { enabled: false };
      enabled = !!(d && d.enabled);
      arenaId = d && d.live ? d.live.id : null;
      var nameEl = $('arena-name'), cdEl = $('arena-countdown');
      if (nameEl) nameEl.textContent = (d && d.live && d.live.name) || (d && d.next && d.next.name) || 'Arena';
      if (cdEl) cdEl.textContent = countdownText();
      var myId = (window.CT && window.CT.user && window.CT.user.id) || null;
      renderLeaderboard(d && d.live ? d.live.top : [], myId);
      renderChampions(d && d.champions);
      renderControl();
      // Caller's standing (signed-in only, and only for the live arena).
      var meCard = $('arena-me'), meLine = $('arena-me-line');
      if (arenaId && isSignedIn()) {
        api('/api/arena/' + arenaId + '/standing').then(function (s) {
          if (s && s.joined && s.standing && meCard && meLine) {
            meCard.style.display = '';
            meLine.innerHTML = '<b>' + s.standing.points + '</b> pts · rank #' + s.standing.rank + ' · ' +
              s.standing.wins + 'W ' + s.standing.draws + 'D ' + s.standing.losses + 'L' +
              (s.standing.onFire ? ' · 🔥' + s.standing.streak : '');
          } else if (meCard) { meCard.style.display = 'none'; }
        }).catch(function () { if (meCard) meCard.style.display = 'none'; });
      } else if (meCard) { meCard.style.display = 'none'; }
    }).catch(function () { /* offline/guest: leave the shell as-is */ });
  }

  // The small lobby card: show it only when an arena is live or upcoming.
  function renderLobbyCard() {
    var card = $('lobby-arena-card');
    if (!card) return;
    api('/api/arena/current').then(function (d) {
      lastData = d || lastData;
      if (!d || !d.enabled || (!d.live && !d.next)) { card.style.display = 'none'; return; }
      var title = $('lobby-arena-title'), sub = $('lobby-arena-sub'), pill = $('lobby-arena-pill');
      if (d.live) {
        if (title) title.textContent = '⏱️ ' + d.live.name;
        if (sub) sub.textContent = 'Live now — quick back-to-back games, climb the points board · ' + countdownText();
        if (pill) pill.textContent = active ? 'Open' : 'Join';
      } else {
        if (title) title.textContent = '⏱️ ' + d.next.name;
        if (sub) sub.textContent = 'Live tournament — quick back-to-back games · ' + countdownText();
        if (pill) pill.textContent = 'View';
      }
      card.style.display = '';
    }).catch(function () { card.style.display = 'none'; });
  }

  // --- Join / leave -----------------------------------------------------------
  function join() {
    if (!isSignedIn()) { toast('Sign in to join the arena.'); if (window.CT && window.CT.showScreen) window.CT.showScreen('auth'); return; }
    if (!netReady()) { toast('Connecting… try again in a moment.'); return; }
    if (!arenaId) { toast('No arena is live right now.'); return; }
    if (!window.CTNet.joinArena(arenaId)) { toast('Could not join — try again.'); return; }
    active = true;
    renderControl();
    setStatus('Finding you a game…');
  }
  function leave() {
    active = false;
    if (netReady() && window.CTNet.leaveArena) window.CTNet.leaveArena();
    renderControl();
    setStatus('You left the arena. Your score is locked in — re-join any time before the bell.');
  }

  // --- CTNet event hooks (forwarded by app.js) -------------------------------
  function onJoined() { if (active) setStatus('You\'re in! Finding you a game…'); }
  function onErr(d) { active = false; renderControl(); var m = (d && d.error) || 'Arena error.'; setStatus(m); toast(m); }
  function onLeft() { /* server ack; UI already updated optimistically */ }

  // The arena finalized and WE won it (server fired arena_champion). app.js does
  // the confetti + profile refresh; we mark inactive (the event is over) + crow.
  function onChampion(data) {
    active = false;
    var name = (data && data.name) || 'the arena';
    var pts = (data && data.points) || 0;
    setStatus('🏆 You won ' + name + '! A new arena starts shortly.');
    render();
    // Give the win a real moment with a next action, instead of a toast that just
    // vanishes (the old arena dead-end). Falls back to the toast if the modal /
    // openModal isn't available.
    var line = $('arena-champion-line');
    if (line) line.textContent = 'You won ' + name + ' with ' + pts + (pts === 1 ? ' point' : ' points') + '. A new arena starts shortly.';
    if (window.CT && window.CT.openModal && document.getElementById('modal-arena-champion')) {
      window.CT.openModal('arena-champion');
    } else {
      toast('🏆 Champion! You won ' + name + ' with ' + pts + ' points!', true);
    }
  }

  // app.js tells us when an arena game starts / ends.
  function onMatchStarted() { setStatus('Game on — good luck!'); }
  function onGameEnded(data) {
    // The server already scored it + re-pooled us. Show the result, refresh the
    // board, and the next match_found will pull us back in.
    var me = (window.CT && window.CT.user) || null;
    var msg = !data || !data.winnerId ? 'Draw.' : (me && data.winnerId === me.id ? 'You won! 🏆' : 'You lost.');
    toast(msg + (active ? ' Pairing you for the next game…' : ''), me && data && data.winnerId === me.id);
    if (active) setStatus('Pairing you for the next game…');
    render();
  }

  // --- Screen lifecycle (called by app.js showScreen) ------------------------
  function enter() {
    onArenaScreen = true;
    render();
    if (!pollTimer) pollTimer = setInterval(function () { if (onArenaScreen) render(); }, 7000);
    if (!tickTimer) tickTimer = setInterval(function () {
      if (!onArenaScreen) return;
      var cd = $('arena-countdown'); if (cd) cd.textContent = countdownText();
    }, 1000);
  }
  function exit() {
    onArenaScreen = false;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  function init() {
    var joinBtn = $('btn-arena-join');
    if (joinBtn) joinBtn.addEventListener('click', function () { active ? leave() : join(); });
    var back = $('btn-arena-back');
    if (back) back.addEventListener('click', function () { if (window.CT && window.CT.showScreen) window.CT.showScreen('lobby'); });
    // Arena-champion modal CTAs (CSP-safe — wired here, no inline handlers). Each
    // closes the modal then routes via the same globals the rest of the app uses.
    var champAgain = $('btn-arena-champ-again');
    if (champAgain) champAgain.addEventListener('click', function () {
      if (window.CT && window.CT.closeModal) window.CT.closeModal('arena-champion');
      if (window.CT && window.CT.showScreen) window.CT.showScreen('arena');
    });
    var champDaily = $('btn-arena-champ-daily');
    if (champDaily) champDaily.addEventListener('click', function () {
      if (window.CT && window.CT.closeModal) window.CT.closeModal('arena-champion');
      var nav = document.getElementById('nav-puzzles'); // reuse the bottom-nav daily-puzzle route
      if (nav) nav.click();
      else if (window.CT && window.CT.showScreen) window.CT.showScreen('lobby');
    });
    var champClose = $('btn-arena-champ-close');
    if (champClose) champClose.addEventListener('click', function () {
      if (window.CT && window.CT.closeModal) window.CT.closeModal('arena-champion');
    });
    // Lobby card is refreshed by app.js's lobby render via renderLobbyCard().
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.CT_Arena = {
    render: render,
    renderLobbyCard: renderLobbyCard,
    enter: enter,
    exit: exit,
    join: join,
    leave: leave,
    isActive: function () { return active; },
    onJoined: onJoined,
    onErr: onErr,
    onLeft: onLeft,
    onMatchStarted: onMatchStarted,
    onGameEnded: onGameEnded,
    onChampion: onChampion,
  };
})();
