/*
 * ct-net.js - thin socket.io-client wrapper for ChessTrophies online play.
 *
 * Exposes window.CTNet with:
 *   connect(serverUrl, token, { onAuthOk, onAuthErr, onDisconnect })
 *   disconnect()
 *   isReady()                     -- connected AND auth_ok received
 *   joinQueue(mode)               -- emit mm_join
 *   leaveQueue()                  -- emit mm_leave
 *   sendMove({ gameId, from, to, promotion })
 *   resign(gameId)
 *   on(event, handler)            -- events: matchFound, moveMade, illegalMove,
 *                                   gameOver, rateLimited
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
      transports: ['websocket'],
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

    socket.on('match_found', function (data) { emit('matchFound', data); });
    socket.on('move_made', function (data) { emit('moveMade', data); });
    socket.on('illegal_move', function (data) { emit('illegalMove', data); });
    socket.on('game_over', function (data) { emit('gameOver', data); });
    socket.on('rate_limited', function (data) { emit('rateLimited', data); });
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

  function joinQueue(mode) {
    if (!ready) return false;
    socket.emit('mm_join', { mode: mode || 'ranked' });
    return true;
  }

  function leaveQueue() {
    if (!ready) return false;
    socket.emit('mm_leave', {});
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

  window.CTNet = {
    connect: connect,
    disconnect: disconnect,
    isReady: isReady,
    joinQueue: joinQueue,
    leaveQueue: leaveQueue,
    sendMove: sendMove,
    resign: resign,
    on: on,
    off: off,
  };
})();
