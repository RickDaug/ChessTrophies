#!/usr/bin/env node
/*
 * arena-realtime.mjs — Layer 2 end-to-end test for ARENA tournaments.
 *
 * Boots the REAL backend on a throwaway SQLite DB with a SHORT arena bot-wait +
 * pairing interval, connects ONE authed socket, joins the live arena, and
 * verifies the realtime loop:
 *
 *   1) GET /api/arena/current shows a live arena (the scheduler created it).
 *   2) emit 'arena_join' -> 'arena_joined'; after the bot-wait the lone player
 *      is bot-backfilled into a mode:'arena' game (match_found isBot:true).
 *   3) the arena game is server-authoritative (bot replies to human moves).
 *   4) on finish (resign): the human's GLOBAL elo + W/L/D are UNCHANGED (arena
 *      never touches the rating system), while the ARENA leaderboard records the
 *      game (games:1) for the player — proving the scoring hook ran in isolation.
 *   5) re-pool: after the game ends the player is put back in the pool and gets
 *      paired again (a SECOND match_found arrives) — the continuous-play loop.
 *
 * Run:  node test/arena-realtime.mjs   (exit 0 = PASS)
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
const log = (...a) => console.log('[arena-rt]', ...a);
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
function once(sock, event, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { sock.off(event, h); reject(new Error(`timeout waiting for "${event}"`)); }, timeoutMs);
    const h = (data) => { clearTimeout(t); resolve(data); };
    sock.once(event, h);
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
function rmDb(dbPath) { for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} } }

async function main() {
  const { io } = await import(CLIENT_PKG);
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-arena-rt-${process.pid}-${port}.db`);
  const post = (p, body, token) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let proc, sock;
  try {
    // Fast arena: bot-backfill a lone joiner after 300ms, pairing pass every 500ms.
    proc = await bootServer(port, dbPath, { ARENA_BOT_WAIT_MS: '300', ARENA_PAIR_INTERVAL_MS: '500' });
    log('backend healthy (arena bot-wait 300ms, pairing 500ms)');

    const cur0 = await (await get('/api/arena/current')).json();
    assert(cur0.enabled === true && cur0.live && cur0.live.status === 'live', `expected a live arena, got ${JSON.stringify(cur0).slice(0, 160)}`);
    const arenaId = cur0.live.id;
    log(`live arena: ${cur0.live.name} (${arenaId}), tc ${cur0.live.tc} ✓`);

    const RUN = Date.now().toString(36).slice(-5);
    const r = await post('/api/auth/signup', { email: `a${RUN}@arena.local`, username: `A${RUN}`, password: 'passw0rd', region: 'Test' });
    assert(r.ok, `signup failed: ${r.status}`);
    const token = (await r.json()).token;
    const me0 = await (await get('/api/me', token)).json();
    const eloBefore = me0.elo, lossesBefore = me0.losses, winsBefore = me0.wins, drawsBefore = me0.draws;
    const myId = me0.id;
    log(`signed up ${me0.username} (elo ${eloBefore}, W/L/D ${winsBefore}/${lossesBefore}/${drawsBefore})`);

    sock = io(BASE, { transports: ['websocket'], forceNew: true });
    await once(sock, 'connect');
    sock.emit('auth', { token });
    await once(sock, 'auth_ok');
    log('socket authenticated ✓');

    // 1) Join the arena -> arena_joined, then bot-backfill into an arena game.
    const joinedP = once(sock, 'arena_joined', 6000);
    const matchP = once(sock, 'match_found', 10000);
    sock.emit('arena_join', { arenaId });
    const joined = await joinedP;
    assert(joined && joined.arenaId === arenaId, 'arena_joined should echo the arena id');
    log('arena_join -> arena_joined ✓');
    const match = await matchP;
    assert(match && match.gameId, 'match_found missing gameId');
    assert(match.isBot === true, `lone arena joiner should be bot-backfilled (isBot), got ${JSON.stringify({ isBot: match.isBot })}`);
    assert(match.mode === 'arena', `arena game should have mode 'arena', got ${match.mode}`);
    const myColor = (match.white && match.white.id === myId) ? 'w' : 'b';
    log(`bot-backfilled into an arena game; I am ${myColor}, bot is ${match.botColor} ✓`);

    // 2) Server-authoritative: if the bot is White it opens; play one human move.
    let fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    sock.on('move_made', (d) => { if (d && d.gameId === match.gameId && d.fen) fen = d.fen; });
    const Chess = serverRequire('chess.js').Chess;
    const gameOver = (c) => (typeof c.isGameOver === 'function' ? c.isGameOver() : c.game_over());
    if (match.botColor === 'w') {
      const first = await once(sock, 'move_made', 12000);
      assert(first && first.move && first.move.color === 'w', 'bot (white) should open');
    }
    {
      const c = new Chess(fen);
      if (!gameOver(c) && c.turn() === myColor) {
        const legal = c.moves({ verbose: true });
        const mv = legal[Math.floor(Math.random() * legal.length)];
        const echoP = once(sock, 'move_made', 8000);
        sock.emit('move', { gameId: match.gameId, from: mv.from, to: mv.to, promotion: 'q' });
        const echo = await echoP;
        assert(echo && echo.move && echo.move.color === myColor, 'our move should echo');
        if (!gameOver(new Chess(echo.fen))) {
          const botReply = await once(sock, 'move_made', 12000);
          assert(botReply && botReply.move && botReply.move.color === match.botColor, 'bot must reply (server-authoritative)');
          log(`server-authoritative bot reply ✓`);
        }
      }
    }

    // 3) Finish (resign => human loses the arena game). game_over flagged isBot.
    const overP = once(sock, 'game_over', 8000);
    sock.emit('resign', { gameId: match.gameId });
    const over = await overP;
    assert(over && over.gameId === match.gameId, 'game_over missing/mismatched gameId');
    log(`arena game over (${over.reason}) ✓`);

    // Register the re-pool listener NOW (before the slower HTTP checks below) —
    // the next pairing can fire within ~1s of the resign.
    const match2P = once(sock, 'match_found', 12000);

    // 4) ISOLATION: global elo + W/L/D are UNCHANGED by the arena game.
    const me1 = await (await get('/api/me', token)).json();
    assert(me1.elo === eloBefore, `arena must NOT change global elo (was ${eloBefore}, got ${me1.elo})`);
    assert(me1.wins === winsBefore && me1.losses === lossesBefore && me1.draws === drawsBefore,
      `arena must NOT change global W/L/D (was ${winsBefore}/${lossesBefore}/${drawsBefore}, got ${me1.wins}/${me1.losses}/${me1.draws})`);
    log(`isolation: global elo + W/L/D untouched by the arena game ✓`);

    // ...but the ARENA leaderboard recorded the game for this player.
    const standing = await (await get(`/api/arena/${arenaId}/standing`, token)).json();
    assert(standing.joined === true && standing.standing, 'player should have an arena standing');
    assert(standing.standing.games >= 1, `arena standing should record >=1 game, got ${standing.standing.games}`);
    log(`arena leaderboard recorded the game (games=${standing.standing.games}, points=${standing.standing.points}) ✓`);

    // 5) RE-POOL: after the game the player is paired again (continuous play).
    const match2 = await match2P;
    assert(match2 && match2.gameId && match2.gameId !== match.gameId && match2.mode === 'arena',
      're-pool should produce a NEW arena game after the previous one ended');
    log('re-pool: player paired into a new arena game after finishing ✓');

    log('PASS — arena realtime: join, bot-backfill, server-authoritative play, ELO isolation, leaderboard scoring, re-pool');
    return 0;
  } finally {
    try { if (sock) sock.close(); } catch {}
    await killServer(proc);
    rmDb(dbPath);
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[arena-rt] FAIL:', e.message); process.exit(1); });
