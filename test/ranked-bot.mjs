#!/usr/bin/env node
/*
 * ranked-bot.mjs — end-to-end test for RANKED engine BOT-BACKFILL.
 *
 * Cold-start problem: a player queues ranked with no humans online. After a
 * backfill window the server starts a game against a SERVER-AUTHORITATIVE engine
 * bot so they never sit stuck. This test boots the REAL backend (server/) on a
 * throwaway SQLite DB with a SHORT backfill window, connects ONE socket client,
 * and verifies:
 *
 *   1) queue ranked 1v1 -> after the window, match_found with the opponent
 *      clearly LABELED as a bot (isBot:true, username 'Computer 🤖', its elo),
 *      a valid seat (the human's white/black object is the real user), and a
 *      well-formed start position.
 *   2) the game is server-authoritative: the human's moves are validated, and
 *      after each human move the server applies + broadcasts the BOT's reply
 *      (move_made with a move by the bot's color).
 *   3) the game can FINISH with a server-side ELO update for the human (we
 *      resign; game_over carries the human's delta and /api/me reflects it).
 *
 * Run:   node test/ranked-bot.mjs   (exit 0 = PASS, 1 = FAIL)
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
const log = (...a) => console.log('[ranked-bot]', ...a);
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
  const dbPath = path.join(os.tmpdir(), `ct-ranked-bot-${process.pid}-${port}.db`);
  const post = (p, body, token) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let proc, sock;
  try {
    // Short backfill so the test is fast; ranked is on by default.
    proc = await bootServer(port, dbPath, { BOT_BACKFILL_MS: '600' });
    log('backend healthy (bot-backfill 600ms)');

    // /api/config now reports ranked ON by default.
    const cfg = await (await get('/api/config')).json();
    assert(cfg.rankedEnabled === true, `ranked should be ON by default, got ${JSON.stringify(cfg)}`);
    log('GET /api/config -> { rankedEnabled:true } ✓');

    const RUN = Date.now().toString(36).slice(-5);
    const r = await post('/api/auth/signup', { email: `b${RUN}@bot.local`, username: `B${RUN}`, password: 'passw0rd', region: 'Test' });
    assert(r.ok, `signup failed: ${r.status}`);
    const token = (await r.json()).token;

    const me0 = await (await get('/api/me', token)).json();
    const eloBefore = me0.elo;
    const myId = me0.id;
    log(`signed up ${me0.username} (id ${myId}, elo ${eloBefore})`);

    sock = io(BASE, { transports: ['websocket'], forceNew: true });
    await once(sock, 'connect');
    sock.emit('auth', { token });
    await once(sock, 'auth_ok');
    log('socket authenticated ✓');

    // 1) Queue ranked 1v1 with no other humans -> bot-backfill match.
    const matchP = once(sock, 'match_found', 10000);
    sock.emit('mm_join', { mode: 'ranked' });
    const match = await matchP;
    assert(match && match.gameId, 'match_found missing gameId');
    assert(match.isBot === true, `match should be flagged isBot, got ${JSON.stringify({ isBot: match.isBot })}`);
    assert(match.mode === 'ranked', `bot game should be ranked, got ${match.mode}`);

    // Identify seats: my object is the real user, the other is the labeled bot.
    const mine = match.white && match.white.id === myId ? match.white : match.black;
    const opp = match.white && match.white.id === myId ? match.black : match.white;
    const myColor = (match.white && match.white.id === myId) ? 'w' : 'b';
    assert(mine && mine.id === myId, 'my seat should be my real user object');
    assert(opp && opp.isBot === true, 'opponent object must be flagged isBot:true');
    assert(typeof opp.username === 'string' && /computer/i.test(opp.username), `bot must be labeled "Computer", got "${opp && opp.username}"`);
    assert(Number.isFinite(opp.elo), `bot must carry an elo, got ${opp && opp.elo}`);
    assert(opp.elo === eloBefore, `bot should play at the human's current rating (${eloBefore}), got ${opp.elo}`);
    assert(match.botColor === (myColor === 'w' ? 'b' : 'w'), 'botColor should be the seat opposite the human');
    log(`matched vs ${opp.username} (rated ~${opp.elo}); I am ${myColor}, bot is ${match.botColor} ✓`);

    // Track the live position from move_made broadcasts.
    let fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    sock.on('move_made', (d) => { if (d && d.gameId === match.gameId && d.fen) fen = d.fen; });

    // If the bot is White it opens first — wait for its move so it's our turn.
    if (match.botColor === 'w') {
      const first = await once(sock, 'move_made', 10000);
      assert(first && first.move, 'bot (white) should make the opening move');
      assert(first.move.color === 'w', `opening move should be by white (the bot), got ${first.move.color}`);
      log(`bot opened: ${first.move.san || first.move.from + first.move.to} ✓`);
    }

    // 2) Play a few human moves; after each, the server must reply with the bot's
    //    move (server-authoritative). Use a local chess engine to pick legal moves.
    const Chess = serverRequire('chess.js').Chess;
    const gameOver = (c) => (typeof c.isGameOver === 'function' ? c.isGameOver() : c.game_over());
    const HUMAN_MOVES = 3;
    for (let i = 0; i < HUMAN_MOVES; i++) {
      const c = new Chess(fen);
      if (gameOver(c)) { log('game ended early (mate/draw) — fine'); break; }
      assert(c.turn() === myColor, `expected it to be my (${myColor}) turn, fen turn is ${c.turn()}`);
      const legal = c.moves({ verbose: true });
      assert(legal.length, 'no legal move for the human');
      const mv = legal[Math.floor(Math.random() * legal.length)];
      const beforeFen = fen;
      // Expect TWO move_made: ours echoed, then the bot's reply.
      const humanEcho = once(sock, 'move_made', 8000);
      sock.emit('move', { gameId: match.gameId, from: mv.from, to: mv.to, promotion: 'q' });
      const echo = await humanEcho;
      assert(echo && echo.move && echo.move.color === myColor, `our move should echo as ${myColor}`);
      // The bot replies unless our move ended the game.
      const ended = gameOver(new Chess(echo.fen));
      if (ended) { fen = echo.fen; log(`human move ${i + 1} ended the game`); break; }
      const botReply = await once(sock, 'move_made', 12000);
      assert(botReply && botReply.move, 'bot must reply after the human move');
      assert(botReply.move.color === match.botColor, `bot reply should be by ${match.botColor}, got ${botReply.move.color}`);
      assert(botReply.fen && botReply.fen !== beforeFen, 'position must advance after the bot reply');
      fen = botReply.fen;
      log(`human ${i + 1}: ${mv.san} -> bot: ${botReply.move.san || botReply.move.from + botReply.move.to} ✓`);
    }

    // 3) Finish the game with a server-side ELO update (resign => human loses).
    const over = once(sock, 'game_over', 8000);
    sock.emit('resign', { gameId: match.gameId });
    const result = await over;
    assert(result && result.gameId === match.gameId, 'game_over missing/mismatched gameId');
    assert(result.isBot === true, 'game_over should be flagged isBot for a bot game');
    const myDelta = myColor === 'w' ? result.whiteDelta : result.blackDelta;
    assert(Number.isFinite(myDelta), `game_over should carry my elo delta, got ${myDelta}`);
    assert(myDelta < 0, `resigning should LOSE rating, got delta ${myDelta}`);
    log(`game over (${result.reason}); my elo delta ${myDelta} ✓`);

    // Persisted: /api/me elo moved by exactly the delta.
    const me1 = await (await get('/api/me', token)).json();
    assert(me1.elo === eloBefore + myDelta, `persisted elo should be ${eloBefore + myDelta} (was ${eloBefore} + ${myDelta}), got ${me1.elo}`);
    assert(me1.losses === me0.losses + 1, `loss should be recorded (was ${me0.losses}, got ${me1.losses})`);
    log(`persisted: elo ${eloBefore} -> ${me1.elo}, losses ${me0.losses} -> ${me1.losses} ✓`);

    log('PASS — ranked bot-backfill: labeled bot match, server-authoritative bot replies, server-side ELO update');
    return 0;
  } finally {
    try { if (sock) sock.close(); } catch {}
    await killServer(proc);
    rmDb(dbPath);
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[ranked-bot] FAIL:', e.message); process.exit(1); });
