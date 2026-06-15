#!/usr/bin/env node
/*
 * concurrent-games.mjs — socket.io ROOM ISOLATION across two live games.
 *
 * The server runs many simultaneous 1v1 games over one socket.io server, each in
 * its own room (per gameId). A room-scoping bug (broadcasting to the namespace
 * instead of the game room, or a shared mutable game-state reference) would leak
 * one game's moves into another — corrupting unrelated players' boards. The
 * single-game tests (reconnect.mjs, smoke) never exercise TWO games at once, so
 * this isolation was unguarded.
 *
 * This boots ONE real backend (server/) on a throwaway SQLite DB, signs up FOUR
 * humans, matches them into TWO independent casual 1v1 games (A vs B, C vs D),
 * then plays moves in BOTH and asserts:
 *   1) the two games have DISTINCT gameIds;
 *   2) a move in game 1 broadcasts move_made ONLY to game-1 sockets — game-2
 *      sockets receive NO move_made for it (and vice-versa);
 *   3) both games stay independently playable (each advances its own board);
 *   4) a move targeting the WRONG game id is rejected (can't reach across rooms).
 *
 * Run:   node test/concurrent-games.mjs   (exit 0 = PASS, 1 = FAIL)
 * Needs: server deps installed (cd server && npm i) incl. socket.io-client.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[concurrent-games]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

const serverRequire = createRequire(path.join(SERVER_DIR, 'package.json'));
const CLIENT_PKG = pathToFileURL(serverRequire.resolve('socket.io-client')).href;
const Chess = serverRequire('chess.js').Chess;

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function waitForHealth(url, t = 15000) {
  const end = Date.now() + t;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  fail('health timeout');
}
function once(sock, event, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { sock.off(event, h); reject(new Error(`timeout waiting for "${event}"`)); }, timeoutMs);
    const h = (data) => { clearTimeout(t); resolve(data); };
    sock.once(event, h);
  });
}
function waitFor(sock, event, pred, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { sock.off(event, h); reject(new Error(`timeout waiting for "${event}"`)); }, timeoutMs);
    const h = (data) => { if (!pred(data)) return; clearTimeout(t); sock.off(event, h); resolve(data); };
    sock.on(event, h);
  });
}
async function bootServer(port, dbPath) {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errOut = '';
  proc.stderr.on('data', d => { errOut += d; });
  proc.on('exit', c => { if (c) log('server exited', c, errOut); });
  await waitForHealth(`http://localhost:${port}/health`);
  return proc;
}
async function killServer(proc) {
  if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
}
function rmDb(p) { for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} } }

async function main() {
  const { io } = await import(CLIENT_PKG);
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-concurrent-${process.pid}-${port}.db`);
  const post = (p, body, token) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const sockets = [];
  const mkSock = () => { const s = io(BASE, { transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
  let proc;

  try {
    proc = await bootServer(port, dbPath);
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-5);
    async function signup(tag) {
      const r = await post('/api/auth/signup', { email: `${tag}${RUN}@cc.local`, username: `${tag}${RUN}`, password: 'passw0rd', region: 'Test' });
      assert(r.ok, `signup ${tag} failed: ${r.status}`);
      const token = (await r.json()).token;
      const me = await (await get('/api/me', token)).json();
      return { token, id: me.id, username: me.username };
    }
    const players = {};
    for (const tag of ['A', 'B', 'C', 'D']) players[tag] = await signup(tag);
    log('signed up A,B,C,D');

    // Connect + authenticate all four sockets.
    const sock = {};
    for (const tag of ['A', 'B', 'C', 'D']) {
      const s = mkSock();
      await once(s, 'connect');
      s.emit('auth', { token: players[tag].token });
      await once(s, 'auth_ok');
      sock[tag] = s;
    }
    log('all four sockets authenticated');

    // --- Match into TWO independent casual games: (A,B) then (C,D). -----------
    async function matchPair(t1, t2) {
      const m1 = once(sock[t1], 'match_found', 12000);
      const m2 = once(sock[t2], 'match_found', 12000);
      sock[t1].emit('mm_join', { mode: 'casual' });
      sock[t2].emit('mm_join', { mode: 'casual' });
      const [a, b] = await Promise.all([m1, m2]);
      assert(a && a.gameId && a.gameId === b.gameId, `${t1}/${t2} should join the SAME game`);
      assert(!a.isBot, `${t1}/${t2} should be a human game, not a bot`);
      // colors
      const t1Color = (a.white && a.white.id === players[t1].id) ? 'w' : 'b';
      return { gameId: a.gameId, white: a.white, black: a.black, t1Color };
    }
    const g1 = await matchPair('A', 'B');
    const g2 = await matchPair('C', 'D');
    assert(g1.gameId !== g2.gameId, `the two games must have DISTINCT ids, got ${g1.gameId} for both`);
    log(`game1 ${g1.gameId} (A vs B), game2 ${g2.gameId} (C vs D) — distinct ✓`);

    // Per-game move helper. Tracks the live fen from each move echo (authoritative).
    const fens = { [g1.gameId]: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [g2.gameId]: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' };
    const seatColor = (g, tag) => {
      const white = g.white, black = g.black;
      if (white && white.id === players[tag].id) return 'w';
      if (black && black.id === players[tag].id) return 'b';
      return null;
    };
    const sockForMover = (g, mover) => {
      // whichever of g's two players holds the side-to-move
      for (const tag of Object.keys(players)) {
        if (seatColor(g, tag) === mover) return sock[tag];
      }
      return null;
    };
    const memberTags = (g) => Object.keys(players).filter(tag => seatColor(g, tag) !== null);

    // === Isolation: a move in game1 must NOT reach game2 sockets. =============
    // pickLast=true makes game2 choose a DIFFERENT legal move than game1 so the
    // two boards visibly diverge (proving independent state, not a shared board).
    async function playInAndAssertIsolation(g, otherG, pickLast = false) {
      const c = new Chess(fens[g.gameId]);
      const mover = c.turn();
      const moverSock = sockForMover(g, mover);
      assert(moverSock, 'could not find the side-to-move socket');
      const legal = c.moves({ verbose: true });
      assert(legal.length, 'no legal move');
      const mv = pickLast ? legal[legal.length - 1] : legal[0];
      const before = fens[g.gameId];

      // Listen on the OTHER game's sockets for ANY move_made tagged with THIS
      // game's id — that would be a room leak. Must stay silent.
      const leaks = [];
      const otherSocks = memberTags(otherG).map(tag => sock[tag]);
      const leakHandlers = otherSocks.map(s => {
        const h = (d) => { if (d && d.gameId === g.gameId) leaks.push(d); };
        s.on('move_made', h);
        return [s, h];
      });

      const echo = waitFor(moverSock, 'move_made', (d) => d && d.gameId === g.gameId && d.fen && d.fen !== before, 10000);
      moverSock.emit('move', { gameId: g.gameId, from: mv.from, to: mv.to, promotion: 'q' });
      const d = await echo;
      fens[g.gameId] = d.fen;

      // Give any (erroneous) cross-room broadcast a beat to arrive, then detach.
      await new Promise(r => setTimeout(r, 300));
      for (const [s, h] of leakHandlers) s.off('move_made', h);
      assert(leaks.length === 0, `game ${g.gameId}'s move LEAKED into game ${otherG.gameId}'s sockets (${leaks.length} stray move_made) — room isolation broken`);
      return mv.san;
    }

    const s1 = await playInAndAssertIsolation(g1, g2, false);
    log(`game1 move ${s1} echoed to game1 ONLY — no leak into game2 ✓`);
    const s2 = await playInAndAssertIsolation(g2, g1, true);
    log(`game2 move ${s2} echoed to game2 ONLY — no leak into game1 ✓`);
    // Play another ply in each so both clearly progressed independently.
    const s1b = await playInAndAssertIsolation(g1, g2, false);
    const s2b = await playInAndAssertIsolation(g2, g1, true);
    assert(fens[g1.gameId] !== fens[g2.gameId], 'the two games should hold DIFFERENT board states');
    log(`both games advanced independently (g1:${s1},${s1b} | g2:${s2},${s2b}); board states differ ✓`);

    // === A move with the WRONG game id must not cross rooms. ==================
    // Player A (in game1) tries to move in game2's id — should be rejected and
    // must NOT broadcast to game2's players.
    {
      const c2 = new Chess(fens[g2.gameId]);
      const legal = c2.moves({ verbose: true });
      const mv = legal[0];
      const g2Socks = memberTags(g2).map(tag => sock[tag]);
      const strays = [];
      const handlers = g2Socks.map(s => { const h = (d) => { if (d && d.gameId === g2.gameId) strays.push(d); }; s.on('move_made', h); return [s, h]; });
      // A is NOT a member of game2; emitting its move into game2 must do nothing.
      sock.A.emit('move', { gameId: g2.gameId, from: mv.from, to: mv.to, promotion: 'q' });
      await new Promise(r => setTimeout(r, 500));
      for (const [s, h] of handlers) s.off('move_made', h);
      assert(strays.length === 0, `a non-member's move into game2 was broadcast (${strays.length}) — cross-room authorization broken`);
      log('a non-member move into another game is rejected (no cross-room broadcast) ✓');
    }

    log('PASS — concurrent games are room-isolated: no move/broadcast bleed across independent games');
    return 0;
  } finally {
    for (const s of sockets) { try { s.close(); } catch {} }
    await killServer(proc);
    rmDb(dbPath);
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[concurrent-games] FAIL:', e.message); process.exit(1); });
