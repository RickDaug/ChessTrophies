#!/usr/bin/env node
/*
 * checkers-online.mjs — end-to-end test for SERVER-SIDE online checkers.
 *
 * Boots the REAL backend on a throwaway SQLite DB and drives TWO Socket.IO
 * clients (socket.io-client) through a full RANKED checkers lifecycle:
 *   signup A + B -> socket auth ->
 *   both checkers_mm_join {mode:'ranked', size:8, rules:'acf'} ->
 *   BOTH get checkers_match_found with consistent colors + a valid start position ->
 *   play several legal checkers_move's (validated + synced to both) ->
 *   assert the server REJECTS an illegal move via checkers_err ->
 *   resign -> checkers_game_over.
 *
 * Load-bearing assertions (integrity):
 *   - winner's elo_checkers_8 went UP, loser's went DOWN (ranked checkers Elo);
 *   - BOTH players' chess `elo` is UNCHANGED (re-read via /api/me);
 *   - an illegal move is rejected by the server (checkers_err), never applied.
 *
 * Run:   node test/checkers-online.mjs    (npm run test:checkers-online)
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
const log = (...a) => console.log('[checkers-online]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

const serverRequire = createRequire(path.join(SERVER_DIR, 'package.json'));
const CLIENT_PKG = pathToFileURL(serverRequire.resolve('socket.io-client')).href;
// Load the engine the same way the server does, to compute legal moves for the test.
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
  const dbPath = path.join(os.tmpdir(), `ct-checkers-online-${process.pid}-${port}.db`);
  const post = (p, body, token) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  const { io } = await import(CLIENT_PKG);

  let proc, errOut = '';
  const sockets = [];
  try {
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', RANKED_ENABLED: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-5);
    async function signup(n) {
      const r = await post('/api/auth/signup', { email: `ck${RUN}_${n}@chk.local`, username: `CK${RUN}_${n}`, password: 'passw0rd', region: 'Test' });
      assert(r.ok, `signup ${n} failed: ${r.status}`);
      const body = await r.json();
      const me = await (await get('/api/me', body.token)).json();
      return { token: body.token, id: me.id, username: me.username, elo: me.elo, eloC8: me.eloCheckers8 };
    }
    const A = await signup('A');
    const B = await signup('B');
    assert(typeof A.eloC8 === 'number' && typeof B.eloC8 === 'number', '/api/me must expose eloCheckers8');
    log(`signed up A (chessElo ${A.elo}, ck8 ${A.eloC8}) and B (chessElo ${B.elo}, ck8 ${B.eloC8})`);

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

    // Both join RANKED 8x8 ACF matchmaking -> both get checkers_match_found.
    const mfA = once(sa, 'checkers_match_found');
    const mfB = once(sb, 'checkers_match_found');
    sa.emit('checkers_mm_join', { mode: 'ranked', size: 8, rules: 'acf' });
    sb.emit('checkers_mm_join', { mode: 'ranked', size: 8, rules: 'acf' });
    const [matchA, matchB] = await Promise.all([mfA, mfB]);
    assert(matchA.gameId && matchA.gameId === matchB.gameId, 'players landed in different checkers games');
    assert(matchA.mode === 'ranked' && matchB.mode === 'ranked', 'checkers_match_found mode must be ranked');
    assert(matchA.size === 8 && matchA.rules === 'acf', 'checkers_match_found size/rules mismatch');
    // Colors must be consistent: exactly one white, one black.
    const colors = [matchA.color, matchB.color].sort().join('');
    assert(colors === 'bw', `colors must be one w + one b, got "${matchA.color}/${matchB.color}"`);
    // Both must receive the SAME valid starting position that loads in the engine.
    assert(matchA.position && matchA.position === matchB.position, 'start position must match for both players');
    const startGame = CK.load(matchA.position);
    assert(startGame.turn() === 'w', 'fresh checkers game: white to move');
    assert(startGame.legalMoves().length > 0, 'start position must have legal moves');
    const gameId = matchA.gameId;
    const sockByColor = { [matchA.color]: sa, [matchB.color]: sb };
    const whiteSock = sockByColor.w;
    const blackSock = sockByColor.b;
    log(`checkers_match_found ${gameId} (size 8 acf, ranked), colors consistent, valid start ✓`);

    // Helper: send a legal move for the side to move and wait for the synced
    // checkers_move_made on BOTH sockets. We track a local engine mirror to pick a
    // legal move and to verify the server's serialized position matches ours.
    const mirror = CK.load(matchA.position);
    async function playLegal(sock) {
      const legal = mirror.legalMoves();
      assert(legal.length > 0, 'no legal moves to play');
      const chosen = legal[0];
      const onA = once(sa, 'checkers_move_made');
      const onB = once(sb, 'checkers_move_made');
      sock.emit('checkers_move', { gameId, move: { from: chosen.from, to: chosen.to, notation: chosen.notation } });
      const [ra, rb] = await Promise.all([onA, onB]);
      assert(ra.gameId === gameId && rb.gameId === gameId, 'move_made gameId mismatch');
      assert(ra.position === rb.position, 'move_made position must be identical for both players');
      // Apply to our mirror and assert the server agrees byte-for-byte.
      mirror.move(chosen);
      assert(ra.position === mirror.serialize(), `server position diverged from engine after ${chosen.notation}`);
      assert(ra.turn === mirror.turn(), 'server turn diverged from engine');
      return chosen.notation;
    }

    // Play several legal moves, alternating sides (white moves first).
    let mover = whiteSock;
    for (let i = 0; i < 4; i++) {
      const not = await playLegal(mover);
      log(`move ${i + 1}: ${not} applied + synced ✓`);
      mover = mover === whiteSock ? blackSock : whiteSock;
    }

    // Illegal move MUST be rejected via checkers_err and NOT applied. Send a move
    // for the side to move that is not in the legal set (a bogus square pair).
    {
      const errP = once(mover, 'checkers_err');
      // Listening for a (wrong) move_made would indicate the server applied it.
      let leaked = false;
      const leakH = () => { leaked = true; };
      sa.on('checkers_move_made', leakH);
      sb.on('checkers_move_made', leakH);
      mover.emit('checkers_move', { gameId, move: { from: 99, to: 88, notation: '99-88' } });
      const err = await errP;
      assert(err && err.error, 'illegal move should produce checkers_err with an error');
      await new Promise(r => setTimeout(r, 200));
      sa.off('checkers_move_made', leakH);
      sb.off('checkers_move_made', leakH);
      assert(!leaked, 'server must NOT broadcast move_made for an illegal move');
      log(`illegal move 99-88 rejected via checkers_err ("${err.error}"), not applied ✓`);
    }

    // Resign: the side to move resigns -> the OTHER side wins. Determine winner.
    const moverColor = mover === whiteSock ? 'w' : 'b';
    const winnerColor = moverColor === 'w' ? 'b' : 'w';
    const winnerUserId = winnerColor === matchA.color ? A.id : B.id;
    const goA = once(sa, 'checkers_game_over');
    const goB = once(sb, 'checkers_game_over');
    mover.emit('checkers_resign', { gameId });
    const [overA, overB] = await Promise.all([goA, goB]);
    assert(overA.gameId === gameId && overB.gameId === gameId, 'game_over gameId mismatch');
    assert(overA.reason === 'resignation', `expected resignation, got "${overA.reason}"`);
    assert(overA.winner === winnerColor, `winner color should be ${winnerColor}, got ${overA.winner}`);
    assert(overA.winnerId === winnerUserId, 'winnerId should be the non-resigning player');
    assert(overA.whiteDelta !== 0 || overA.blackDelta !== 0, 'ranked checkers must produce non-zero Elo deltas');
    log(`checkers_game_over: ${overA.reason}, winner=${overA.winner}, deltas w=${overA.whiteDelta} b=${overA.blackDelta} ✓`);

    // Integrity: re-read both players. Winner's ck8 UP, loser's ck8 DOWN, chess
    // elo UNCHANGED for both.
    const meA = await (await get('/api/me', A.token)).json();
    const meB = await (await get('/api/me', B.token)).json();
    const winner = winnerUserId === A.id ? { before: A, after: meA, name: 'A' } : { before: B, after: meB, name: 'B' };
    const loser = winnerUserId === A.id ? { before: B, after: meB, name: 'B' } : { before: A, after: meA, name: 'A' };
    assert(winner.after.eloCheckers8 > winner.before.eloC8,
      `winner ${winner.name} ck8 should rise: ${winner.before.eloC8} -> ${winner.after.eloCheckers8}`);
    assert(loser.after.eloCheckers8 < loser.before.eloC8,
      `loser ${loser.name} ck8 should fall: ${loser.before.eloC8} -> ${loser.after.eloCheckers8}`);
    log(`checkers Elo updated: ${winner.name} ${winner.before.eloC8}->${winner.after.eloCheckers8} (UP), ${loser.name} ${loser.before.eloC8}->${loser.after.eloCheckers8} (DOWN) ✓`);
    assert(meA.elo === A.elo, `A chess ELO changed by a checkers game! ${A.elo} -> ${meA.elo}`);
    assert(meB.elo === B.elo, `B chess ELO changed by a checkers game! ${B.elo} -> ${meB.elo}`);
    log(`chess ELO UNCHANGED for both (isolation): A ${A.elo}->${meA.elo}, B ${B.elo}->${meB.elo} ✓`);

    // Rankings exposes the checkers8 metric and returns elo_checkers_8.
    const rk = await (await get('/api/rankings?metric=checkers8&limit=100')).json();
    assert(Array.isArray(rk.players) && rk.players.length >= 2, 'rankings checkers8 must return players');
    assert(rk.players.every(p => typeof p.elo_checkers_8 === 'number'), 'rankings must include elo_checkers_8');
    log('rankings metric checkers8 returns elo_checkers_8 ✓');

    log('PASS — online checkers plays out, ranked checkers Elo updates, chess Elo untouched');
    return 0;
  } finally {
    for (const s of sockets) { try { s.close(); } catch {} }
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch { await new Promise(r => setTimeout(r, 250)); } } }
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[checkers-online] FAIL:', e.message); process.exit(1); });
