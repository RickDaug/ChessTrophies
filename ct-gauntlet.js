/*
 * ct-gauntlet.js — Bot Gauntlet UI (window.CT_Gauntlet).
 *
 * A solo ladder of named AI "characters" at rising ELOs the player climbs one
 * rung at a time (vs the existing practice bot engine). Beat the current rung →
 * it unlocks the next + a celebration. Replay any rung you've already beaten.
 *
 * SELF-CONTAINED CLIENT MODULE. Renders into #gauntlet-list (the gauntlet
 * screen) and #lobby-gauntlet-card (the lobby). CSP-safe: no inline on* handlers,
 * delegated click only.
 *
 * Progress lives on state.user.flags.gauntlet = { beaten: <highestBeatenIndex> }
 * (-1 if none). The NEXT rung = beaten + 1. A rung is unlocked if i <= beaten + 1.
 *
 * Depends on window.CT (all read defensively):
 *   • CT.state / CT.user        — current player + state.user.flags
 *   • CT.escapeHTML             — output escaping
 *   • CT.showScreen / CT.toast  — navigation + toasts
 *   • CT.loadDB / CT.saveDB     — persistence (same pattern as app.js user flags)
 *   • CT.startGauntletGame(ch)  — wrapper app.js adds; starts the practice game
 *
 * app.js calls into us:
 *   • enter()           — when the gauntlet screen opens (renders the ladder)
 *   • onResult(won)     — after a gauntlet game ends; advances progress on a win
 *                         of the NEXT unbeaten rung. Returns a result object so
 *                         app.js can celebrate.
 *   • currentTarget()   — the next rung object (to name the opponent on start)
 *   • renderLobbyCard() — fills #lobby-gauntlet-card with the next target
 */
(function () {
  'use strict';

  // The ladder, rising ELO order. Tasteful, chess-themed, original flavor.
  // ELOs stay inside the bot's 400–2400 range.
  var ROSTER = [
    { name: 'Pawnsworth',     elo: 500,  emoji: '🐣', blurb: 'A wide-eyed rookie who pushes pawns and hopes for the best.' },
    { name: 'Sir Forkalot',   elo: 800,  emoji: '🐴', blurb: 'A clumsy knight-errant who stumbles into the occasional fork.' },
    { name: 'Bishop Bot',     elo: 1100, emoji: '⛪', blurb: 'Preaches the gospel of the long diagonal — and means it.' },
    { name: 'Rook Solo',      elo: 1350, emoji: '🏰', blurb: 'A lone tower who lives on open files and the seventh rank.' },
    { name: 'The Archivist',  elo: 1600, emoji: '📚', blurb: 'Has read every opening book twice and never forgets a line.' },
    { name: 'Queen Mab',      elo: 1850, emoji: '👑', blurb: 'Regal and ruthless; her queen roams wherever she pleases.' },
    { name: 'Knightmare',     elo: 2050, emoji: '🌙', blurb: 'Strikes from the shadows with attacks you never saw coming.' },
    { name: 'Castle Crasher',  elo: 2250, emoji: '💥', blurb: 'Sacrifices for the initiative and crashes through your king.' },
    { name: 'Grandmaster X',  elo: 2400, emoji: '⭐', blurb: 'The final boss. Precise, relentless, and very hard to surprise.' },
  ];

  // ---- helpers ---------------------------------------------------------------
  function CT() { return window.CT || null; }
  function esc(s) {
    var c = CT();
    return (c && c.escapeHTML) ? c.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s);
  }
  function toast(m, ok) { var c = CT(); if (c && c.toast) c.toast(m, ok); }
  function $(id) { return document.getElementById(id); }
  function getUser() { var c = CT(); return (c && c.user) || (c && c.state && c.state.user) || null; }

  // Highest beaten index (-1 if none), read defensively from flags.
  function beatenIndex() {
    var u = getUser();
    var g = u && u.flags && u.flags.gauntlet;
    var b = g && typeof g.beaten === 'number' ? g.beaten : -1;
    if (b < -1) b = -1;
    if (b > ROSTER.length - 1) b = ROSTER.length - 1;
    return b;
  }

  // Index of the next unbeaten rung, or ROSTER.length when the ladder is done.
  function nextIndex() { return beatenIndex() + 1; }
  function isComplete() { return nextIndex() >= ROSTER.length; }

  // The next rung object app.js targets when starting a game (null if complete).
  function currentTarget() {
    var i = nextIndex();
    return i < ROSTER.length ? ROSTER[i] : null;
  }

  // Persist the user's gauntlet flag through loadDB/saveDB — mirrors how app.js
  // persists user flags (recordDailyPlay / finishGame). Works for logged-in users
  // AND guests, as long as the user record lives in the DB. Always mutates the
  // in-memory state.user first so the UI reflects it immediately.
  function persist(beaten) {
    var u = getUser();
    if (!u) return;
    u.flags = u.flags || {};
    u.flags.gauntlet = u.flags.gauntlet || {};
    u.flags.gauntlet.beaten = beaten;
    var c = CT();
    try {
      if (c && c.loadDB && c.saveDB && u.id) {
        var db = c.loadDB();
        if (db && db.users && db.users[u.id]) {
          db.users[u.id] = u;
          c.saveDB(db);
        }
      }
    } catch (e) { /* in-memory mutation above still stands */ }
  }

  // ---- rendering -------------------------------------------------------------
  function rowHTML(ch, i, beaten, next) {
    var state = i <= beaten ? 'beaten' : (i === next ? 'next' : 'locked');
    var badge = state === 'beaten' ? '✅' : (state === 'next' ? '▶️' : '🔒');
    var locked = state === 'locked';
    var border = state === 'next' ? 'var(--accent)' : (state === 'beaten' ? 'rgba(80,200,120,.45)' : 'var(--line, #2d3a52)');
    var dim = locked ? 'opacity:.55;' : '';
    var btn = '';
    if (state === 'next') {
      btn = '<button class="btn" data-rung="' + i + '" style="white-space:nowrap">Challenge ' + esc(ch.name) + '</button>';
    } else if (state === 'beaten') {
      btn = '<button class="btn btn-ghost small" data-rung="' + i + '" style="white-space:nowrap">Replay</button>';
    } else {
      btn = '<span class="pill muted small" style="white-space:nowrap">Locked</span>';
    }
    return '' +
      '<div class="card row between" style="padding:12px;margin-bottom:8px;border:1px solid ' + border + ';' + dim + '">' +
        '<div style="display:flex;align-items:center;gap:12px;min-width:0">' +
          '<div style="font-size:30px;width:40px;text-align:center">' + esc(ch.emoji) + '</div>' +
          '<div style="min-width:0">' +
            '<div style="font-weight:800;overflow:hidden;text-overflow:ellipsis">' +
              badge + ' ' + esc(ch.name) +
              ' <span class="pill muted small" style="vertical-align:middle">' + esc(ch.elo) + ' ELO</span>' +
            '</div>' +
            '<div class="muted small" style="margin-top:3px">' + esc(ch.blurb) + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin-left:10px">' + btn + '</div>' +
      '</div>';
  }

  // Paint the ladder into #gauntlet-list (+ progress / complete banner).
  function render() {
    var list = $('gauntlet-list');
    if (!list) return;
    var beaten = beatenIndex();
    var next = nextIndex();
    var defeated = beaten + 1; // number of rungs cleared
    var total = ROSTER.length;

    var header = '';
    if (isComplete()) {
      header =
        '<div class="card" style="text-align:center;margin-bottom:12px;border:1px solid var(--accent);' +
        'background:linear-gradient(135deg, rgba(245,196,81,.18), var(--panel))">' +
          '<div style="font-size:20px;font-weight:800">🏆 Gauntlet complete!</div>' +
          '<div class="muted small" style="margin-top:4px">You toppled all ' + total + ' challengers. Replay any rung for a rematch.</div>' +
        '</div>';
    } else {
      header =
        '<div class="muted small" style="text-align:center;margin-bottom:12px;font-weight:700">' +
          defeated + ' of ' + total + ' defeated' +
        '</div>';
    }

    var rows = ROSTER.map(function (ch, i) { return rowHTML(ch, i, beaten, next); }).join('');
    list.innerHTML = header + rows;
  }

  // Fill the optional lobby card with the next target (defensive if absent).
  function renderLobbyCard() {
    var card = $('lobby-gauntlet-card');
    if (!card) return;
    var title = $('lobby-gauntlet-title');
    var sub = $('lobby-gauntlet-sub');
    var pill = $('lobby-gauntlet-pill');
    if (isComplete()) {
      if (title) title.textContent = '⚔️ Beat the bots';
      if (sub) sub.textContent = '🏆 Complete — you beat every bot! Replay any challenger.';
      if (pill) pill.textContent = 'Replay';
    } else {
      var t = currentTarget();
      if (title) title.textContent = '⚔️ Beat the bots';
      if (sub) sub.textContent = t ? ('Next up: ' + t.name + ' ' + t.emoji + ' — each bot is tougher than the last') : 'A line-up of computers, each tougher than the last.';
      if (pill) pill.textContent = 'Climb';
    }
    card.style.display = '';
  }

  // ---- result hook -----------------------------------------------------------
  // Called by app.js after a gauntlet game ends with the rung that was played and
  // whether the player won. Advances `beaten` only when the player WON the NEXT
  // unbeaten rung (replays + losses never advance). Returns a result object so
  // app.js can celebrate.
  //
  // app.js sets state._gauntlet = { rung: <index>, ... } when starting the game,
  // so we read the played rung from there (falling back to currentTarget()).
  function onResult(won) {
    var c = CT();
    var ctx = c && c.state && c.state._gauntlet;
    var playedRung = ctx && typeof ctx.rung === 'number' ? ctx.rung : nextIndex();
    var next = nextIndex();
    var result = { advanced: false, beatenName: null, unlockedName: null, complete: false };

    // Advance only on a WIN of the exact next unbeaten rung.
    if (won && playedRung === next && next < ROSTER.length) {
      var newBeaten = next;
      persist(newBeaten);
      result.advanced = true;
      result.beatenName = ROSTER[newBeaten].name;
      result.complete = newBeaten >= ROSTER.length - 1;
      result.unlockedName = result.complete ? null : ROSTER[newBeaten + 1].name;
    }
    // Keep the lobby card + ladder in sync if they're on screen.
    try { render(); } catch (e) {}
    try { renderLobbyCard(); } catch (e) {}
    return result;
  }

  // ---- screen lifecycle ------------------------------------------------------
  function enter() { render(); }

  // ---- click delegation (CSP-safe) ------------------------------------------
  // One delegated handler on the list container; reads data-rung off the button.
  function onListClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-rung]') : null;
    if (!btn) return;
    var i = parseInt(btn.getAttribute('data-rung'), 10);
    if (isNaN(i) || i < 0 || i >= ROSTER.length) return;
    // Guard: only unlocked rungs (i <= beaten + 1) are playable.
    if (i > beatenIndex() + 1) { toast('Beat the rung above this one first.'); return; }
    var c = CT();
    if (c && typeof c.startGauntletGame === 'function') {
      c.startGauntletGame(ROSTER[i]);
    } else {
      toast('Gauntlet is unavailable right now.');
    }
  }

  function init() {
    var list = $('gauntlet-list');
    if (list) list.addEventListener('click', onListClick);
    var back = $('btn-gauntlet-back');
    if (back) back.addEventListener('click', function () {
      var c = CT();
      if (c && c.showScreen) c.showScreen('lobby');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.CT_Gauntlet = {
    ROSTER: ROSTER,
    render: render,
    renderLobbyCard: renderLobbyCard,
    enter: enter,
    onResult: onResult,
    currentTarget: currentTarget,
    // Exposed for app.js / testing.
    beatenIndex: beatenIndex,
    nextIndex: nextIndex,
    isComplete: isComplete,
  };
})();
