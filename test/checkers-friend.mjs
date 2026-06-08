#!/usr/bin/env node
/*
 * checkers-friend.mjs — end-to-end test for the SERVER-SIDE online FRIEND
 * checkers challenge (the `checkers_challenge_*` lifecycle). Always UNRATED.
 *
 * Boots the REAL backend on a throwaway SQLite DB and drives TWO Socket.IO
 * clients (socket.io-client) through:
 *   signup A + B -> become MUTUAL friends (POST /api/friends/add both ways) ->
 *   socket auth ->
 *   A checkers_challenge_invite {friendId:B, game:'checkers', size:8, rules:'acf'} ->
 *   B receives checkers_challenge_received ->
 *   B checkers_challenge_accept {inviteId} ->
 *   BOTH receive checkers_match_found (mode MUST be 'casual'/unrated) ->
 *   play one legal move synced to both ->
 *   B resigns -> checkers_game_over.
 *
 * Then a SECOND mini-flow: A invites B again -> B declines -> A receives
 * checkers_challenge_declined.
 *
 * Load-bearing assertions (integrity):
 *   - checkers_match_found mode === 'casual' for BOTH players (UNRATED);
 *   - after the game, NEITHER player's elo_checkers_8 NOR chess `elo` changed
 *     (casual = unrated; re-read via /api/me);
 *   - decline emits checkers_challenge_declined to the INVITER.
 *
 * Run:   node test/checkers-friend.mjs    (npm run test:checkers-friend)
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
const log = (...a) => console.log('[checkers-friend]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

const serverRequire = createRequire(path.join(SERVER_DIR, 'package.json'));
const CLIENT_PKG = pathToFileURL(serverRequire.resolve('socket.io-client')).href;
// Load the engine the same way the server does, to compute a legal move.
const CK = serverRequire(path.resolve(__dirname, '..', 'checkers.js'));

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

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-checkers-friend-${process.pid}-${port}.db`);
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
      const r = await post('/api/auth/signup', { email: `cf${RUN}_${n}@chk.local`, username: `CF${RUN}_${n}`, password: 'passw0rd', region: 'Test' });
      assert(r.ok, `signup ${n} failed: ${r.status}`);
      const body = await r.json();
      const me = await (await get('/api/me', body.token)).json();
      return { token: body.token, id: me.id, username: me.username, elo: me.elo, eloC8: me.eloCheckers8 };
    }
    const A = await signup('A');
    const B = await signup('B');
    assert(typeof A.eloC8 === 'number' && typeof B.eloC8 === 'number', '/api/me must expose eloCheckers8');
    log(`signed up A (chessElo ${A.elo}, ck8 ${A.eloC8}) and B (chessElo ${B.elo}, ck8 ${B.eloC8})`);

    // Become friends: A requests B, then B requests A -> mutual auto-accept.
    let r = await post('/api/friends/add', { username: B.username }, A.token);
    assert(r.ok, `A->B friend add failed: ${r.status}`);
    r = await post('/api/friends/add', { username: A.username }, B.token);
    const rb = await r.json();
    assert(r.ok && rb.accepted, `B->A friend add should auto-accept (got ${JSON.stringify(rb)})`);
    log('A and B are now mutual friends ✓');

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

    // A challenges B to a FRIEND checkers game (size 8, ACF). B should receive
    // checkers_challenge_received with the inviter's checkers Elo.
    const recvP = once(sb, 'checkers_challenge_received');
    sa.emit('checkers_challenge_invite', { friendId: B.id, game: 'checkers', size: 8, rules: 'acf' });
    const recv = await recvP;
    assert(recv && recv.inviteId, 'checkers_challenge_received missing inviteId');
    assert(recv.fromId === A.id, `checkers_challenge_received fromId should be A (${A.id}), got ${recv.fromId}`);
    assert(recv.fromName === A.username, 'checkers_challenge_received fromName mismatch');
    assert(typeof recv.fromElo === 'number', 'checkers_challenge_received fromElo should be a number');
    assert(recv.fromElo === A.eloC8, `fromElo should be inviter's checkers8 Elo (${A.eloC8}), got ${recv.fromElo}`);
    assert(recv.size === 8 && recv.rules === 'acf', `received size/rules mismatch: ${recv.size}/${recv.rules}`);
    log(`B received checkers challenge ${recv.inviteId} from ${recv.fromName} (fromElo ${recv.fromElo}, size ${recv.size} ${recv.rules}) ✓`);

    // B accepts -> BOTH get checkers_match_found with mode === 'casual'.
    const mfA = once(sa, 'checkers_match_found');
    const mfB = once(sb, 'checkers_match_found');
    sb.emit('checkers_challenge_accept', { inviteId: recv.inviteId });
    const [matchA, matchB] = await Promise.all([mfA, mfB]);
    assert(matchA.gameId && matchA.gameId === matchB.gameId, 'players landed in different checkers games');
    assert(matchA.mode === 'casual' && matchB.mode === 'casual', `checkers_match_found mode MUST be casual (unrated), got A=${matchA.mode} B=${matchB.mode}`);
    assert(matchA.size === 8 && matchA.rules === 'acf', 'checkers_match_found size/rules mismatch');
    const colors = [matchA.color, matchB.color].sort().join('');
    assert(colors === 'bw', `colors must be one w + one b, got "${matchA.color}/${matchB.color}"`);
    assert(matchA.position && matchA.position === matchB.position, 'start position must match for both players');
    const gameId = matchA.gameId;
    const sockByColor = { [matchA.color]: sa, [matchB.color]: sb };
    const blackSock = sockByColor.b;
    log(`checkers_match_found ${gameId} (size 8 acf, mode=${matchA.mode} UNRATED), colors consistent ✓`);

    // Play ONE legal move (BLACK moves first in ACF 8x8) synced to BOTH players.
    const mirror = CK.load(matchA.position);
    {
      const legal = mirror.legalMoves();
      assert(legal.length > 0, 'no legal moves at start');
      const chosen = legal[0];
      const onA = once(sa, 'checkers_move_made');
      const onB = once(sb, 'checkers_move_made');
      blackSock.emit('checkers_move', { gameId, move: { from: chosen.from, to: chosen.to, notation: chosen.notation } });
      const [ra, rb] = await Promise.all([onA, onB]);
      assert(ra.gameId === gameId && rb.gameId === gameId, 'move_made gameId mismatch');
      assert(ra.position === rb.position, 'move_made position must be identical for both players');
      mirror.move(chosen);
      assert(ra.position === mirror.serialize(), `server position diverged from engine after ${chosen.notation}`);
      log(`move ${chosen.notation} applied + synced to both ✓`);
    }

    // B resigns to end the game cleanly.
    const goA = once(sa, 'checkers_game_over');
    const goB = once(sb, 'checkers_game_over');
    sb.emit('checkers_resign', { gameId });
    const [overA] = await Promise.all([goA, goB]);
    assert(overA.gameId === gameId, 'game_over gameId mismatch');
    assert(overA.reason === 'resignation', `expected resignation, got "${overA.reason}"`);
    // CASUAL => zero Elo deltas reported.
    assert(overA.whiteDelta === 0 && overA.blackDelta === 0, `casual checkers must report zero Elo deltas, got w=${overA.whiteDelta} b=${overA.blackDelta}`);
    log(`checkers_game_over: ${overA.reason}, deltas w=${overA.whiteDelta} b=${overA.blackDelta} (UNRATED) ✓`);

    // INTEGRITY: re-read both players. NEITHER elo_checkers_8 NOR chess elo moved.
    const meA = await (await get('/api/me', A.token)).json();
    const meB = await (await get('/api/me', B.token)).json();
    assert(meA.eloCheckers8 === A.eloC8, `A checkers8 changed by a casual game! ${A.eloC8} -> ${meA.eloCheckers8}`);
    assert(meB.eloCheckers8 === B.eloC8, `B checkers8 changed by a casual game! ${B.eloC8} -> ${meB.eloCheckers8}`);
    assert(meA.elo === A.elo, `A chess ELO changed by a checkers game! ${A.elo} -> ${meA.elo}`);
    assert(meB.elo === B.elo, `B chess ELO changed by a checkers game! ${B.elo} -> ${meB.elo}`);
    log(`UNRATED isolation: A ck8 ${A.eloC8}->${meA.eloCheckers8}, chess ${A.elo}->${meA.elo}; B ck8 ${B.eloC8}->${meB.eloCheckers8}, chess ${B.elo}->${meB.elo} ✓`);

    // DECLINE flow: A invites B again, B declines -> A gets checkers_challenge_declined.
    const recv2P = once(sb, 'checkers_challenge_received');
    sa.emit('checkers_challenge_invite', { friendId: B.id, game: 'checkers', size: 8, rules: 'acf' });
    const recv2 = await recv2P;
    assert(recv2 && recv2.inviteId, 'second checkers_challenge_received missing inviteId');
    const declP = once(sa, 'checkers_challenge_declined');
    sb.emit('checkers_challenge_decline', { inviteId: recv2.inviteId });
    const decl = await declP;
    assert(decl && decl.inviteId === recv2.inviteId, `checkers_challenge_declined inviteId mismatch: ${JSON.stringify(decl)}`);
    log(`decline flow: B declined ${recv2.inviteId} -> A received checkers_challenge_declined ✓`);

    log('PASS — FRIEND checkers challenge plays out UNRATED (no Elo touched), decline notifies the inviter');
    return 0;
  } finally {
    for (const s of sockets) { try { s.close(); } catch {} }
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch { await new Promise(r => setTimeout(r, 250)); } } }
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[checkers-friend] FAIL:', e.message); process.exit(1); });
