#!/usr/bin/env node
/*
 * reconnect.mjs — end-to-end test for the 1v1 DISCONNECT GRACE + RESUME path.
 *
 * Real-time online play must survive a transient socket drop mid-game instead of
 * instantly forfeiting. This test boots the REAL backend (server/) on a throwaway
 * SQLite DB + ephemeral port, signs up TWO humans, matches them in a casual 1v1,
 * plays a couple of moves to advance the board, then:
 *
 *   1) DROPS one player's socket mid-game and asserts the OPPONENT receives the
 *      `opponent_disconnected` grace event (with a positive graceMs countdown) —
 *      i.e. the server starts the grace window instead of forfeiting immediately.
 *   2) RECONNECTS the dropped player (new socket, same token) within the grace
 *      window and asserts:
 *        a) the reconnecting client gets `game_state` that RESTORES the live board
 *           (same fen, same gameId, correct yourColor + seats), and
 *        b) the OPPONENT receives `opponent_reconnected` (grace cancelled).
 *   3) Confirms the game is still LIVE after the reconnect: the reconnected player
 *      can make a legal move and it broadcasts as `move_made` (board not forfeited).
 *
 * Guards the app.js:3094-3127 reconnect handlers against the server resume path
 * (ct-net.js game_state + server/game.js auth-resume / disconnect-grace).
 *
 * Run:   node test/reconnect.mjs   (exit 0 = PASS, 1 = FAIL)
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
const log = (...a) => console.log('[reconnect]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

const serverRequire = createRequire(path.join(SERVER_DIR, 'package.json'));
const CLIENT_PKG = pathToFileURL(serverRequire.resolve('socket.io-client')).href;

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function waitForHealth(url, t = 15000) {
  const end = Date.now() + t;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  fail('health timeout');
}
function once(sock, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { sock.off(event, h); reject(new Error(`timeout waiting for "${event}"`)); }, timeoutMs);
    const h = (data) => { clearTimeout(t); resolve(data); };
    sock.once(event, h);
  });
}
// Wait for an event whose payload satisfies `pred` (skips stale/duplicate frames).
function waitFor(sock, event, pred, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { sock.off(event, h); reject(new Error(`timeout waiting for "${event}"`)); }, timeoutMs);
    const h = (data) => { if (!pred(data)) return; clearTimeout(t); sock.off(event, h); resolve(data); };
    sock.on(event, h);
  });
}

async function bootServer(port, dbPath, extraEnv) {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', ...extraEnv },
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
function rmDb(dbPath) {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} }
}

async function main() {
  const { io } = await import(CLIENT_PKG);
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-reconnect-${process.pid}-${port}.db`);
  const post = (p, body, token) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const sockets = [];
  const mkSock = () => { const s = io(BASE, { transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
  let proc;

  try {
    proc = await bootServer(port, dbPath, {});
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-5);
    async function signup(tag) {
      const r = await post('/api/auth/signup', { email: `${tag}${RUN}@rc.local`, username: `${tag}${RUN}`, password: 'passw0rd', region: 'Test' });
      assert(r.ok, `signup ${tag} failed: ${r.status}`);
      const token = (await r.json()).token;
      const me = await (await get('/api/me', token)).json();
      return { token, id: me.id, username: me.username };
    }
    const a = await signup('A');
    const b = await signup('B');
    log(`signed up ${a.username} and ${b.username}`);

    // Connect + authenticate both sockets.
    const sa = mkSock();
    await once(sa, 'connect');
    sa.emit('auth', { token: a.token });
    await once(sa, 'auth_ok');
    const sb = mkSock();
    await once(sb, 'connect');
    sb.emit('auth', { token: b.token });
    await once(sb, 'auth_ok');
    log('both sockets authenticated');

    // Match A and B in a CASUAL 1v1 (no ranked gating, no bot-backfill).
    const matchA = once(sa, 'match_found', 10000);
    const matchB = once(sb, 'match_found', 10000);
    sa.emit('mm_join', { mode: 'casual' });
    sb.emit('mm_join', { mode: 'casual' });
    const [mA, mB] = await Promise.all([matchA, matchB]);
    assert(mA && mA.gameId && mA.gameId === mB.gameId, 'both should join the SAME game');
    const gameId = mA.gameId;
    assert(!mA.isBot, 'should be a human-vs-human game, not a bot game');

    // Work out colors from A's match_found.
    const aColor = (mA.white && mA.white.id === a.id) ? 'w' : 'b';
    const bColor = aColor === 'w' ? 'b' : 'w';
    log(`matched game ${gameId}: A=${aColor}, B=${bColor}`);

    // Live fen is taken from each move's OWN echo (authoritative), not a shared
    // listener — avoids any ordering race between the listener and the awaited echo.
    let fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

    const Chess = serverRequire('chess.js').Chess;
    const sockFor = (color) => (color === aColor ? sa : sb);
    async function playOne() {
      const c = new Chess(fen);
      const mover = c.turn();
      const legal = c.moves({ verbose: true });
      assert(legal.length, 'no legal move available');
      const mv = legal[0];
      const before = fen;
      // Wait for the move_made whose fen actually CHANGED (ignore any late/dup frame).
      const echo = waitFor(sockFor(mover), 'move_made', (d) => d && d.gameId === gameId && d.fen && d.fen !== before, 8000);
      sockFor(mover).emit('move', { gameId, from: mv.from, to: mv.to, promotion: 'q' });
      const d = await echo;
      fen = d.fen; // authoritative server fen after this move
      return mv.san;
    }
    // Advance the board a couple of plies so resume must restore a NON-initial fen.
    const m1 = await playOne();
    const m2 = await playOne();
    const fenBeforeDrop = fen;
    assert(fenBeforeDrop !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'board should have advanced before the drop');
    log(`played ${m1}, ${m2}; live fen advanced ✓`);

    // === 1) DROP player A's socket; opponent B must get the grace event. ======
    const oppDisc = once(sb, 'opponent_disconnected', 8000);
    sa.disconnect();
    sockets.splice(sockets.indexOf(sa), 1); // we replace this socket below
    const disc = await oppDisc;
    assert(disc && disc.gameId === gameId, `opponent_disconnected should carry our gameId, got ${JSON.stringify(disc)}`);
    assert(Number(disc.graceMs) > 0, `grace window should be positive, got ${disc.graceMs}`);
    log(`B saw opponent_disconnected (grace ${disc.graceMs}ms) ✓`);

    // === 2) RECONNECT A within the grace window; expect game_state + opp event. =
    const oppRecon = once(sb, 'opponent_reconnected', 8000);
    const sa2 = mkSock();
    await once(sa2, 'connect');
    const stateP = once(sa2, 'game_state', 8000);
    sa2.emit('auth', { token: a.token });
    await once(sa2, 'auth_ok');
    const gs = await stateP;
    assert(gs && gs.gameId === gameId, `game_state should restore our gameId, got ${JSON.stringify(gs && gs.gameId)}`);
    assert(gs.fen === fenBeforeDrop, `game_state should RESTORE the live board\n  want ${fenBeforeDrop}\n  got  ${gs.fen}`);
    assert(gs.yourColor === aColor, `game_state yourColor should be ${aColor}, got ${gs.yourColor}`);
    const mineSeat = aColor === 'w' ? gs.white : gs.black;
    assert(mineSeat && mineSeat.id === a.id, 'game_state should seat the reconnecting user as themselves');
    log(`A reconnected; game_state restored board (${gs.fen}) as ${gs.yourColor} ✓`);

    const recon = await oppRecon;
    assert(recon && recon.gameId === gameId, 'B should see opponent_reconnected for our game');
    log('B saw opponent_reconnected (grace cancelled) ✓');

    // === 3) Game is still LIVE: the reconnected player can keep playing. ========
    const c = new Chess(fen);
    const mover = c.turn();
    const moverSock = mover === aColor ? sa2 : sb;
    const legal = c.moves({ verbose: true });
    assert(legal.length, 'no legal move after reconnect');
    const mv = legal[0];
    const echo = waitFor(moverSock, 'move_made', (d) => d && d.gameId === gameId && d.fen && d.fen !== fenBeforeDrop, 8000);
    moverSock.emit('move', { gameId, from: mv.from, to: mv.to, promotion: 'q' });
    const after = await echo;
    assert(after && after.gameId === gameId && after.fen && after.fen !== fenBeforeDrop,
      'a move after reconnect should advance the live (non-forfeited) game');
    log(`post-reconnect move ${mv.san} applied — game resumed, not forfeited ✓`);

    log('PASS — disconnect grace fires, reconnect restores board state, game resumes');
    return 0;
  } finally {
    for (const s of sockets) { try { s.close(); } catch {} }
    await killServer(proc);
    rmDb(dbPath);
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[reconnect] FAIL:', e.message); process.exit(1); });
