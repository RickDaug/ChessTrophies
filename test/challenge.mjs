#!/usr/bin/env node
/*
 * challenge.mjs — end-to-end test for the online 1v1 FRIENDLY challenge (unrated).
 *
 * Boots the REAL backend on a throwaway SQLite DB and drives TWO Socket.IO
 * clients (via socket.io-client, the canonical Node client) through:
 *   signup A + B -> become friends -> socket auth ->
 *   A challenge_invite(B) -> B challenge_received -> B challenge_accept ->
 *   BOTH match_found (mode MUST be 'casual') -> play a Fool's-Mate sequence ->
 *   game_over (checkmate).
 *
 * The load-bearing assertion: challenge games are ALWAYS unrated. We snapshot
 * both players' ELO before the game and assert it is UNCHANGED afterwards, and
 * that match_found reports mode==='casual'.
 *
 * Run:   node test/challenge.mjs
 * Needs: server deps installed (cd server && npm i) incl. socket.io-client.
 *        Exits 0 on PASS, 1 on FAIL.
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
const log = (...a) => console.log('[challenge]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

// socket.io-client lives in the server's node_modules (devDependency there).
// Resolve its proper Node entry from the server dir (the browser dist bundle
// isn't a valid Node ESM import), then import that file URL.
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
// Wait for a specific socket event (or reject on timeout).
function once(sock, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { sock.off(event, h); reject(new Error(`timeout waiting for "${event}"`)); }, timeoutMs);
    const h = (data) => { clearTimeout(t); resolve(data); };
    sock.once(event, h);
  });
}

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-challenge-${process.pid}-${port}.db`);
  const post = (p, body, token) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  const { io } = await import(CLIENT_PKG);

  let proc, errOut = '';
  const sockets = [];
  try {
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development' }, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-5);
    async function signup(n) {
      const r = await post('/api/auth/signup', { email: `c${RUN}_${n}@chal.local`, username: `C${RUN}_${n}`, password: 'passw0rd', region: 'Test' });
      assert(r.ok, `signup ${n} failed: ${r.status}`);
      const body = await r.json();
      const me = await (await get('/api/me', body.token)).json();
      return { token: body.token, id: me.id, username: me.username, elo: me.elo };
    }
    const A = await signup('A');
    const B = await signup('B');
    log(`signed up A=${A.username} (elo ${A.elo}) and B=${B.username} (elo ${B.elo})`);

    // Become friends: A requests B, then B requests A -> mutual auto-accept.
    let r = await post('/api/friends/add', { username: B.username }, A.token);
    assert(r.ok, `A->B friend add failed: ${r.status}`);
    r = await post('/api/friends/add', { username: A.username }, B.token);
    const rb = await r.json();
    assert(r.ok && rb.accepted, `B->A friend add should auto-accept (got ${JSON.stringify(rb)})`);
    log('A and B are now friends ✓');

    // Connect + auth both sockets.
    async function connect(user) {
      const sock = io(BASE, { transports: ['websocket'], forceNew: true });
      sockets.push(sock);
      await once(sock, 'connect');
      sock.emit('auth', { token: user.token });
      await once(sock, 'auth_ok');
      return sock;
    }
    const sa = await connect(A);
    const sb = await connect(B);
    log('both sockets authenticated ✓');

    // A challenges B (unlimited tc). B should receive challenge_received.
    const recvP = once(sb, 'challenge_received');
    const sentP = once(sa, 'challenge_sent');
    sa.emit('challenge_invite', { friendId: B.id, tc: 'unlimited' });
    const recv = await recvP;
    const sent = await sentP;
    assert(recv && recv.inviteId, 'challenge_received missing inviteId');
    assert(recv.fromId === A.id, `challenge_received fromId should be A (${A.id}), got ${recv.fromId}`);
    assert(recv.fromName === A.username, 'challenge_received fromName mismatch');
    assert(typeof recv.fromElo === 'number', 'challenge_received fromElo should be a number');
    assert(sent.inviteId === recv.inviteId, 'challenge_sent/received inviteId mismatch');
    log(`B received challenge ${recv.inviteId} from ${recv.fromName} ✓`);

    // B accepts -> BOTH get match_found with mode === 'casual'.
    const mfA = once(sa, 'match_found');
    const mfB = once(sb, 'match_found');
    sb.emit('challenge_accept', { inviteId: recv.inviteId });
    const [matchA, matchB] = await Promise.all([mfA, mfB]);
    assert(matchA.gameId && matchA.gameId === matchB.gameId, 'players landed in different games');
    assert(matchA.mode === 'casual', `match_found mode MUST be casual (unrated), got "${matchA.mode}"`);
    assert(matchB.mode === 'casual', `match_found mode MUST be casual for B, got "${matchB.mode}"`);
    const gameId = matchA.gameId;
    // Figure out which socket is white (white moves first).
    const whiteId = matchA.white.id;
    const blackId = matchA.black.id;
    const sockById = { [A.id]: sa, [B.id]: sb };
    const whiteSock = sockById[whiteId];
    const blackSock = sockById[blackId];
    log(`match_found ${gameId}, mode=${matchA.mode} (unrated), white=${whiteId} ✓`);

    // Drive Fool's Mate: 1. f3 e5 2. g4 Qh4# (white is mated).
    async function move(sock, from, to) {
      const p = waitMoveMade(sock, from, to);
      sock.emit('move', { gameId, from, to });
      await p;
    }
    function waitMoveMade(sock, from, to, timeoutMs = 8000) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { sock.off('move_made', h); reject(new Error(`timeout: move ${from}${to} did not propagate`)); }, timeoutMs);
        const h = (d) => { if (d.move && d.move.from === from && d.move.to === to) { clearTimeout(t); sock.off('move_made', h); resolve(d); } };
        sock.on('move_made', h);
      });
    }
    const overA = once(sa, 'game_over');
    const overB = once(sb, 'game_over');
    await move(whiteSock, 'f2', 'f3');  // 1. f3
    await move(blackSock, 'e7', 'e5');  // 1... e5
    await move(whiteSock, 'g2', 'g4');  // 2. g4
    await move(blackSock, 'd8', 'h4');  // 2... Qh4#  (checkmate)
    const [goA, goB] = await Promise.all([overA, overB]);
    assert(goA.gameId === gameId && goB.gameId === gameId, 'game_over gameId mismatch');
    assert(goA.reason === 'checkmate', `expected checkmate, got "${goA.reason}"`);
    // For a casual game, no ELO deltas should be applied.
    assert(goA.whiteDelta === 0 && goA.blackDelta === 0, `casual game must have zero ELO deltas, got w=${goA.whiteDelta} b=${goA.blackDelta}`);
    log(`game over: ${goA.reason}, deltas w=${goA.whiteDelta} b=${goA.blackDelta} ✓`);

    // Definitive integrity check: re-read both players' ELO from the DB (via /api/me).
    const meA = await (await get('/api/me', A.token)).json();
    const meB = await (await get('/api/me', B.token)).json();
    assert(meA.elo === A.elo, `A ELO changed by a casual game! before=${A.elo} after=${meA.elo}`);
    assert(meB.elo === B.elo, `B ELO changed by a casual game! before=${B.elo} after=${meB.elo}`);
    // Casual games must also not touch the win/loss record.
    assert(meA.wins === 0 && meA.losses === 0 && meB.wins === 0 && meB.losses === 0,
      `casual game must not affect W/L: A(${meA.wins}/${meA.losses}) B(${meB.wins}/${meB.losses})`);
    log(`ELO UNCHANGED after casual challenge: A ${A.elo}->${meA.elo}, B ${B.elo}->${meB.elo} ✓`);

    log('PASS — 1v1 friendly challenge plays out and stays UNRATED (ELO untouched)');
    return 0;
  } finally {
    for (const s of sockets) { try { s.close(); } catch {} }
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch { await new Promise(r => setTimeout(r, 250)); } } }
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[challenge] FAIL:', e.message); process.exit(1); });
