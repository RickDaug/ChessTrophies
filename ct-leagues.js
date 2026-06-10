/*
 * ct-leagues.js — Friend Leagues UI (window.CT_Leagues).
 *
 * Private clubs with a join code + a members-only leaderboard. Renders into the
 * static #screen-leagues shell (added to index.html) — this module owns the
 * inner content. Leagues are for REAL accounts only, so guests get a friendly
 * "sign in" prompt instead of the league list.
 *
 * Self-contained + CSP-safe: NO inline handlers; one delegated click listener on
 * the screen root dispatches on data-act/data-id. Degrades gracefully (a toast,
 * never a throw) if the API or any CT helper is missing.
 *
 * Depends on (all optional):
 *   • window.CT_Auth.api(path)                      — authed GET
 *   • window.CT_Auth.api(path,{method,body})        — authed POST
 *   • window.CT_Auth.isServerLoggedIn()             — real-account check
 *   • window.CT.{toast,escapeHTML,showScreen}
 */
(function () {
  'use strict';

  var view = 'list';     // 'list' | 'board'
  var boardId = null;    // league id when viewing a leaderboard

  function api(path, opts) {
    if (window.CT_Auth && typeof window.CT_Auth.api === 'function') return window.CT_Auth.api(path, opts);
    return Promise.reject(new Error('CT_Auth.api unavailable'));
  }
  function esc(s) { return (window.CT && window.CT.escapeHTML) ? window.CT.escapeHTML(String(s == null ? '' : s)) : String(s == null ? '' : s); }
  function toast(m, ok) { if (window.CT && window.CT.toast) window.CT.toast(m, ok); }
  function show(id) { if (window.CT && window.CT.showScreen) window.CT.showScreen(id); }
  function $(id) { return document.getElementById(id); }
  function root() { return $('leagues-body'); }
  function isSignedIn() {
    try { return !!(window.CT_Auth && window.CT_Auth.isServerLoggedIn && window.CT_Auth.isServerLoggedIn()); } catch (e) { return false; }
  }

  // --- Render: signed-out prompt ---------------------------------------------
  function renderSignedOut() {
    var el = root(); if (!el) return;
    view = 'list'; boardId = null;
    el.innerHTML =
      '<div class="card" style="text-align:center;padding:22px 16px">' +
        '<div style="font-size:30px;margin-bottom:8px">🛡️</div>' +
        '<div style="font-weight:800;font-size:17px;margin-bottom:6px">Sign in to join a league</div>' +
        '<div class="muted small" style="margin-bottom:14px">Friend Leagues are private clubs for ChessTrophies accounts. Create an account or sign in to start or join one.</div>' +
        '<button class="btn" data-act="signin">Sign in</button>' +
      '</div>';
  }

  // --- Render: my leagues + create/join forms --------------------------------
  function renderList() {
    var el = root(); if (!el) return;
    view = 'list'; boardId = null;
    el.innerHTML =
      '<div class="card" style="margin-bottom:12px">' +
        '<div style="font-weight:700;margin-bottom:8px">Create a league</div>' +
        '<div style="display:flex;gap:8px">' +
          '<input id="league-name-input" class="input" type="text" maxlength="40" placeholder="League name" style="flex:1" autocomplete="off">' +
          '<button class="btn" data-act="create">Create</button>' +
        '</div>' +
      '</div>' +
      '<div class="card" style="margin-bottom:14px">' +
        '<div style="font-weight:700;margin-bottom:8px">Join with a code</div>' +
        '<div style="display:flex;gap:8px">' +
          '<input id="league-code-input" class="input" type="text" maxlength="5" placeholder="CODE" style="flex:1;text-transform:uppercase;letter-spacing:2px" autocomplete="off">' +
          '<button class="btn btn-secondary" data-act="join">Join</button>' +
        '</div>' +
      '</div>' +
      '<h3 style="margin:8px 0">Your leagues</h3>' +
      '<div id="leagues-mine"><div class="muted small" style="text-align:center;padding:8px">Loading…</div></div>';

    loadMine();
  }

  function loadMine() {
    var box = $('leagues-mine');
    return api('/api/leagues/mine').then(function (d) {
      if (!box) return;
      var leagues = (d && d.leagues) || [];
      if (!leagues.length) {
        box.innerHTML = '<div class="card muted small" style="text-align:center">You\'re not in any leagues yet. Create one or join with a friend\'s code.</div>';
        return;
      }
      box.innerHTML = leagues.map(function (l) {
        return '<div class="card row between" data-act="open-board" data-id="' + esc(l.id) + '" style="cursor:pointer;padding:12px;margin-bottom:8px">' +
          '<div style="min-width:0">' +
            '<div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(l.name) +
              (l.isOwner ? ' <span class="muted small">(owner)</span>' : '') + '</div>' +
            '<div class="muted small" style="margin-top:2px">' + (l.members || 0) + ' member' + (l.members === 1 ? '' : 's') + ' · code ' + esc(l.code) + '</div>' +
          '</div>' +
          '<div class="pill gold">View</div>' +
        '</div>';
      }).join('');
    }).catch(function () {
      if (box) box.innerHTML = '<div class="card muted small" style="text-align:center">Could not load your leagues.</div>';
    });
  }

  // --- Render: one league's member leaderboard -------------------------------
  function renderLeaderboard(id) {
    var el = root(); if (!el) return;
    view = 'board'; boardId = id;
    el.innerHTML =
      '<div class="row between" style="margin-bottom:10px">' +
        '<button class="btn btn-ghost small" data-act="back">← My leagues</button>' +
      '</div>' +
      '<div id="league-board"><div class="muted small" style="text-align:center;padding:8px">Loading…</div></div>';

    return api('/api/leagues/' + encodeURIComponent(id) + '/leaderboard').then(function (d) {
      var box = $('league-board'); if (!box) return;
      var members = (d && d.members) || [];
      var rows = members.map(function (m, i) {
        return '<div class="card row between" style="padding:10px 12px;margin-bottom:6px">' +
          '<div style="display:flex;align-items:center;gap:10px;min-width:0">' +
            '<div class="pill" style="min-width:26px;text-align:center">' + (i + 1) + '</div>' +
            '<div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(m.username) +
              (m.isOwner ? ' <span class="muted small">👑</span>' : '') + '</div>' +
          '</div>' +
          '<div style="text-align:right;white-space:nowrap"><b>' + (m.elo || 0) + '</b> <span class="muted small">elo · ' + (m.wins || 0) + 'W ' + (m.losses || 0) + 'L</span></div>' +
        '</div>';
      }).join('');
      box.innerHTML =
        '<div class="card" style="margin-bottom:12px;text-align:center">' +
          '<div style="font-weight:800;font-size:18px">' + esc(d && d.name) + '</div>' +
          '<div class="muted small" style="margin-top:4px">Share code <b style="letter-spacing:2px">' + esc(d && d.code) + '</b> to invite friends</div>' +
          '<div style="margin-top:10px;display:flex;gap:8px;justify-content:center">' +
            '<button class="btn btn-secondary small" data-act="copy-code" data-code="' + esc(d && d.code) + '">Copy code</button>' +
            '<button class="btn btn-ghost small" data-act="leave" data-id="' + esc(boardId) + '">Leave</button>' +
          '</div>' +
        '</div>' +
        '<h3 style="margin:8px 0">Members</h3>' +
        (rows || '<div class="card muted small" style="text-align:center">No members yet.</div>');
    }).catch(function (e) {
      var box = $('league-board');
      var msg = (e && e.status === 403) ? 'You\'re not a member of this league.' : 'Could not load the leaderboard.';
      if (box) box.innerHTML = '<div class="card muted small" style="text-align:center">' + msg + '</div>';
    });
  }

  // --- Actions ---------------------------------------------------------------
  function doCreate() {
    var input = $('league-name-input');
    var name = (input && input.value || '').trim();
    if (name.length < 2) { toast('Enter a league name.'); return; }
    api('/api/leagues', { method: 'POST', body: JSON.stringify({ name: name }) }).then(function (d) {
      toast('League created! Code: ' + (d && d.code), true);
      renderLeaderboard(d.id);
    }).catch(function (e) { toast((e && e.message) || 'Could not create the league.'); });
  }

  function doJoin() {
    var input = $('league-code-input');
    var code = (input && input.value || '').trim().toUpperCase();
    if (!code) { toast('Enter a join code.'); return; }
    api('/api/leagues/join', { method: 'POST', body: JSON.stringify({ code: code }) }).then(function (d) {
      toast('Joined ' + (d && d.name) + '!', true);
      renderLeaderboard(d.id);
    }).catch(function (e) {
      var msg = (e && e.status === 404) ? 'No league found with that code.' : ((e && e.message) || 'Could not join.');
      toast(msg);
    });
  }

  function doLeave(id) {
    if (!id) return;
    api('/api/leagues/' + encodeURIComponent(id) + '/leave', { method: 'POST', body: JSON.stringify({}) }).then(function () {
      toast('You left the league.', true);
      renderList();
    }).catch(function () { toast('Could not leave the league.'); });
  }

  function copyCode(code) {
    if (!code) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(function () { toast('Code copied!', true); }, function () { toast('Code: ' + code); });
        return;
      }
    } catch (e) {}
    toast('Code: ' + code);
  }

  // --- Entry + lifecycle -----------------------------------------------------
  function render() {
    if (!isSignedIn()) { renderSignedOut(); return; }
    if (view === 'board' && boardId) { renderLeaderboard(boardId); return; }
    renderList();
  }

  function enter() { render(); }

  // The lobby card: show it once the user is signed in (leagues are account-only).
  function renderLobbyCard() {
    var card = $('lobby-leagues-card');
    if (!card) return;
    card.style.display = isSignedIn() ? '' : 'none';
  }

  // --- Delegated clicks (CSP-safe) -------------------------------------------
  function onClick(e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    if (act === 'signin') { show('auth'); return; }
    if (act === 'create') { doCreate(); return; }
    if (act === 'join') { doJoin(); return; }
    if (act === 'back') { renderList(); return; }
    if (act === 'open-board') { renderLeaderboard(t.getAttribute('data-id')); return; }
    if (act === 'leave') { doLeave(t.getAttribute('data-id')); return; }
    if (act === 'copy-code') { copyCode(t.getAttribute('data-code')); return; }
  }

  function init() {
    var screen = $('screen-leagues');
    if (screen) screen.addEventListener('click', onClick);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.CT_Leagues = {
    render: render,
    renderLeaderboard: renderLeaderboard,
    renderLobbyCard: renderLobbyCard,
    enter: enter,
  };
})();
