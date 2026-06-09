/*
 * ct-net.js - thin socket.io-client wrapper for ChessTrophies online play.
 *
 * Exposes window.CTNet with:
 *   connect(serverUrl, token, { onAuthOk, onAuthErr, onDisconnect, onReconnectFailed })
 *   disconnect()
 *   isReady()                     -- connected AND auth_ok received
 *   joinQueue(mode)               -- emit mm_join
 *   leaveQueue()                  -- emit mm_leave
 *   sendMove({ gameId, from, to, promotion })
 *   resign(gameId)
 *   offerRematch(gameId) / acceptRematch(gameId) / declineRematch(gameId)
 *   on(event, handler)            -- events: matchFound, moveMade, illegalMove,
 *                                   gameOver, rateLimited, rematchOffered,
 *                                   rematchDeclined, rematchExpired,
 *                                   opponentDisconnected, opponentReconnected,
 *                                   gameState
 *   off(event, handler)
 *
 * Depends on window.io (socket.io-client global, loaded via <script> tag).
 */
(function () {
  'use strict';

  var socket = null;
  var ready = false;
  var listeners = Object.create(null); // event -> [handler, ...]

  function emit(event, payload) {
    var arr = listeners[event];
    if (!arr) return;
    arr.slice().forEach(function (h) {
      try { h(payload); } catch (e) { console.error('[CTNet]', event, e); }
    });
  }

  function on(event, handler) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(handler);
  }

  function off(event, handler) {
    var arr = listeners[event];
    if (!arr) return;
    var i = arr.indexOf(handler);
    if (i !== -1) arr.splice(i, 1);
  }

  function connect(serverUrl, token, opts) {
    opts = opts || {};
    if (typeof window.io !== 'function') {
      console.error('[CTNet] socket.io-client (window.io) not loaded');
      if (opts.onAuthErr) opts.onAuthErr({ error: 'socket.io-client missing' });
      return;
    }
    if (socket) {
      try { socket.disconnect(); } catch (e) {}
      socket = null;
      ready = false;
    }
    socket = window.io(serverUrl, {
      // Try WebSocket first, but allow HTTP long-polling as a fallback. Without
      // polling, networks/proxies that block the WS upgrade leave the socket
      // permanently unconnected (never authed -> isReady() stays false), which
      // silently kicks online matchmaking back to broken single-device pairing.
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 8000,
    });

    socket.on('connect', function () {
      socket.emit('auth', { token: token });
    });

    socket.on('auth_ok', function (data) {
      ready = true;
      if (opts.onAuthOk) opts.onAuthOk(data);
    });

    socket.on('auth_err', function (data) {
      ready = false;
      if (opts.onAuthErr) opts.onAuthErr(data);
    });

    socket.on('disconnect', function (reason) {
      ready = false;
      if (opts.onDisconnect) opts.onDisconnect(reason);
    });

    // socket.io manager exhausted reconnectionAttempts -- it will not retry again.
    if (socket.io && typeof socket.io.on === 'function') {
      socket.io.on('reconnect_failed', function () {
        ready = false;
        if (opts.onReconnectFailed) opts.onReconnectFailed();
      });
    }

    // match_found carries white/black public-user objects. For a RANKED bot-
    // backfill game the opponent's object is the labeled bot: username 'Computer
    // 🤖', isBot:true and its elo (== the human's rating at match time); a
    // top-level isBot/botColor also rides along. We forward the payload verbatim
    // so the existing opponent display renders "Computer 🤖 (ELO N)" unchanged.
    socket.on('match_found', function (data) { emit('matchFound', data); });
    socket.on('move_made', function (data) { emit('moveMade', data); });
    socket.on('illegal_move', function (data) { emit('illegalMove', data); });
    socket.on('game_over', function (data) { emit('gameOver', data); });
    socket.on('rate_limited', function (data) { emit('rateLimited', data); });
    // 2v2 team events
    socket.on('team_match_found', function (data) { emit('teamMatchFound', data); });
    socket.on('team_mm_queued', function (data) { emit('teamQueued', data); });
    socket.on('team_mm_left', function (data) { emit('teamLeft', data); });
    socket.on('team_mm_err', function (data) { emit('teamErr', data); });
    // Rematch (1v1) lifecycle
    socket.on('rematch_offered', function (data) { emit('rematchOffered', data); });
    socket.on('rematch_declined', function (data) { emit('rematchDeclined', data); });
    socket.on('rematch_expired', function (data) { emit('rematchExpired', data); });
    // Disconnect grace + reconnect/resume (1v1)
    socket.on('opponent_disconnected', function (data) { emit('opponentDisconnected', data); });
    socket.on('opponent_reconnected', function (data) { emit('opponentReconnected', data); });
    socket.on('game_state', function (data) { emit('gameState', data); });
    // Duo invite lifecycle
    socket.on('duo_invite_received', function (data) { emit('duoInviteReceived', data); });
    socket.on('duo_invite_sent', function (data) { emit('duoInviteSent', data); });
    socket.on('duo_accepted', function (data) { emit('duoAccepted', data); });
    socket.on('duo_ready', function (data) { emit('duoReady', data); });
    socket.on('duo_declined', function (data) { emit('duoDeclined', data); });
    socket.on('duo_cancelled', function (data) { emit('duoCancelled', data); });
    socket.on('duo_invite_expired', function (data) { emit('duoInviteExpired', data); });
    socket.on('duo_err', function (data) { emit('duoErr', data); });

    // Friendly 1v1 challenge lifecycle (the accepted match arrives via match_found)
    socket.on('challenge_received', function (data) { emit('challengeReceived', data); });
    socket.on('challenge_declined', function (data) { emit('challengeDeclined', data); });
    socket.on('challenge_cancelled', function (data) { emit('challengeCancelled', data); });

    socket.on('friend_request', function (data) { emit('friendRequest', data); });
    socket.on('friend_accepted', function (data) { emit('friendAccepted', data); });

    // VICTIM WALL / revenge loop: the server fires `defeated` to a player who was
    // just beaten during the winner's win streak ({ by, streakLen, rank }).
    socket.on('defeated', function (data) { emit('defeated', data); });

    // ARENA tournaments: join/leave acks + errors. Arena games themselves arrive
    // via the normal `match_found` (mode:'arena'), so no separate match event.
    socket.on('arena_joined', function (data) { emit('arenaJoined', data); });
    socket.on('arena_left', function (data) { emit('arenaLeft', data); });
    socket.on('arena_err', function (data) { emit('arenaErr', data); });

    // --- CHECKERS / DRAUGHTS online contract (additive; mirrors chess 1v1) ---
    // Event names are centralized here so a differing server contract is a 1-line
    // change per event. The checkers UI (ct-checkers.js) subscribes to the
    // camelCased CTNet events emitted below.
    socket.on('checkers_match_found', function (data) { emit('checkersMatchFound', data); });
    socket.on('checkers_move_made', function (data) { emit('checkersMoveMade', data); });
    socket.on('checkers_game_over', function (data) { emit('checkersGameOver', data); });
    socket.on('checkers_err', function (data) { emit('checkersErr', data); });
    // Friendly checkers challenge lifecycle (the accepted match arrives via
    // checkers_match_found). These mirror the chess challenge_* events.
    socket.on('checkers_challenge_received', function (data) { emit('checkersChallengeReceived', data); });
    socket.on('checkers_challenge_declined', function (data) { emit('checkersChallengeDeclined', data); });
    socket.on('checkers_challenge_cancelled', function (data) { emit('checkersChallengeCancelled', data); });
  }

  function disconnect() {
    ready = false;
    if (socket) {
      try { socket.disconnect(); } catch (e) {}
      socket = null;
    }
    // Clear all CTNet-level subscriptions so a subsequent connect+register
    // doesn't accidentally fire stale handlers (the per-socket listeners
    // get cleared automatically when the socket dies, but our listeners[]
    // map is separate and would otherwise leak across login sessions).
    listeners = Object.create(null);
  }

  function isReady() { return ready; }

  function joinQueue(mode, tc) {
    if (!ready) return false;
    socket.emit('mm_join', { mode: mode || 'ranked', tc: tc || 'unlimited' });
    return true;
  }

  function leaveQueue() {
    if (!ready) return false;
    socket.emit('mm_leave', {});
    return true;
  }

  // --- Arena tournaments: join/leave the live arena's pairing pool ---
  function joinArena(arenaId) {
    if (!ready) return false;
    socket.emit('arena_join', { arenaId: arenaId });
    return true;
  }
  function leaveArena() {
    if (!ready) return false;
    socket.emit('arena_leave', {});
    return true;
  }

  function sendMove(payload) {
    if (!ready) return false;
    socket.emit('move', payload);
    return true;
  }

  function resign(gameId) {
    if (!ready) return false;
    socket.emit('resign', { gameId: gameId });
    return true;
  }

  // --- Rematch (1v1) ---
  function offerRematch(gameId) {
    if (!ready) return false;
    socket.emit('rematch_offer', { gameId: gameId });
    return true;
  }
  function acceptRematch(gameId) {
    if (!ready) return false;
    socket.emit('rematch_accept', { gameId: gameId });
    return true;
  }
  function declineRematch(gameId) {
    if (!ready) return false;
    socket.emit('rematch_decline', { gameId: gameId });
    return true;
  }

  // --- 2v2 team play ---
  function joinTeamQueue(inviteId, tc) {
    if (!ready) return false;
    var payload = inviteId ? { inviteId: inviteId } : {};
    payload.tc = tc || 'unlimited';
    socket.emit('team_mm_join', payload);
    return true;
  }
  function leaveTeamQueue() {
    if (!ready) return false;
    socket.emit('team_mm_leave', {});
    return true;
  }
  function inviteDuo(friendId) {
    if (!ready) return false;
    socket.emit('duo_invite', { friendId: friendId });
    return true;
  }
  function acceptDuo(inviteId) {
    if (!ready) return false;
    socket.emit('duo_accept', { inviteId: inviteId });
    return true;
  }
  function declineDuo(inviteId) {
    if (!ready) return false;
    socket.emit('duo_decline', { inviteId: inviteId });
    return true;
  }
  function cancelDuo(inviteId) {
    if (!ready) return false;
    socket.emit('duo_cancel', { inviteId: inviteId });
    return true;
  }

  // --- Friendly 1v1 challenge (online, unrated) ---
  // The accept handshake makes the server emit the SAME `match_found` event the
  // matchmaker uses, so the existing matchFound handler starts the game.
  function inviteChallenge(friendId, tc) {
    if (!ready) return false;
    socket.emit('challenge_invite', { friendId: friendId, tc: tc || 'unlimited' });
    return true;
  }
  function acceptChallenge(inviteId) {
    if (!ready) return false;
    socket.emit('challenge_accept', { inviteId: inviteId });
    return true;
  }
  function declineChallenge(inviteId) {
    if (!ready) return false;
    socket.emit('challenge_decline', { inviteId: inviteId });
    return true;
  }
  function cancelChallenge(inviteId) {
    if (!ready) return false;
    socket.emit('challenge_cancel', { inviteId: inviteId });
    return true;
  }

  // --- CHECKERS / DRAUGHTS emit helpers (additive; mirror chess 1v1) ---
  // Contract:
  //   checkers_mm_join   { mode, size, rules, tc }
  //   checkers_mm_leave  {}
  //   checkers_move      { gameId, move }
  //   checkers_resign    { gameId }
  //   checkers_challenge_invite/accept/decline/cancel { ..., game:'checkers', size, rules }
  function joinCheckersQueue(mode, size, rules, tc) {
    if (!ready) return false;
    socket.emit('checkers_mm_join', { mode: mode || 'ranked', size: size || 8, rules: rules || 'acf', tc: tc || 'unlimited' });
    return true;
  }
  function leaveCheckersQueue() {
    if (!ready) return false;
    socket.emit('checkers_mm_leave', {});
    return true;
  }
  function sendCheckersMove(payload) {
    if (!ready) return false;
    socket.emit('checkers_move', payload);
    return true;
  }
  function resignCheckers(gameId) {
    if (!ready) return false;
    socket.emit('checkers_resign', { gameId: gameId });
    return true;
  }
  function inviteCheckersChallenge(friendId, size, rules, tc) {
    if (!ready) return false;
    socket.emit('checkers_challenge_invite', { friendId: friendId, game: 'checkers', size: size || 8, rules: rules || 'acf', tc: tc || 'unlimited' });
    return true;
  }
  function acceptCheckersChallenge(inviteId) {
    if (!ready) return false;
    socket.emit('checkers_challenge_accept', { inviteId: inviteId });
    return true;
  }
  function declineCheckersChallenge(inviteId) {
    if (!ready) return false;
    socket.emit('checkers_challenge_decline', { inviteId: inviteId });
    return true;
  }
  function cancelCheckersChallenge(inviteId) {
    if (!ready) return false;
    socket.emit('checkers_challenge_cancel', { inviteId: inviteId });
    return true;
  }

  window.CTNet = {
    connect: connect,
    disconnect: disconnect,
    isReady: isReady,
    joinQueue: joinQueue,
    leaveQueue: leaveQueue,
    joinArena: joinArena,
    leaveArena: leaveArena,
    sendMove: sendMove,
    resign: resign,
    // checkers (additive)
    joinCheckersQueue: joinCheckersQueue,
    leaveCheckersQueue: leaveCheckersQueue,
    sendCheckersMove: sendCheckersMove,
    resignCheckers: resignCheckers,
    inviteCheckersChallenge: inviteCheckersChallenge,
    acceptCheckersChallenge: acceptCheckersChallenge,
    declineCheckersChallenge: declineCheckersChallenge,
    cancelCheckersChallenge: cancelCheckersChallenge,
    offerRematch: offerRematch,
    acceptRematch: acceptRematch,
    declineRematch: declineRematch,
    joinTeamQueue: joinTeamQueue,
    leaveTeamQueue: leaveTeamQueue,
    inviteDuo: inviteDuo,
    acceptDuo: acceptDuo,
    declineDuo: declineDuo,
    cancelDuo: cancelDuo,
    inviteChallenge: inviteChallenge,
    acceptChallenge: acceptChallenge,
    declineChallenge: declineChallenge,
    cancelChallenge: cancelChallenge,
    on: on,
    off: off,
  };
})();
