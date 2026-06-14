#!/usr/bin/env node
/*
 * loadtest.mjs — real concurrency load test for the ChessTrophies backend.
 *
 * WHAT IT MEASURES. The identified bottleneck is the server-side chess AI
 * (server/bot.js): bot-backfill moves are a synchronous alpha-beta search run on
 * the main Node event loop, so while one game's bot is "thinking" the whole
 * server is blocked. This harness ramps the number of CONCURRENT bot games and
 * measures, at each level:
 *   - bot-reply latency  — emit('move') -> receive the bot's reply (what a PLAYER
 *                          feels per move; inflates as searches contend for the
 *                          one thread).
 *   - /health latency    — a background pinger; a proxy for EVENT-LOOP BLOCKING,
 *                          i.e. how much every other user/request is starved.
 *   - throughput (moves/sec) and errors/timeouts.
 *
 * It guarantees every game is a BOT game (not human-vs-human, which is cheap) via
 * a global join-mutex: only one synthetic user is ever in the matchmaking queue
 * at a time, so each is bot-backfilled.
 *
 * USAGE (boots a throwaway local server by default):
 *   node scripts/loadtest.mjs
 *   CT_LOAD_LEVELS=1,4,8,16,32 CT_LOAD_SECONDS=15 node scripts/loadtest.mjs
 *   CT_LOAD_ELO=2000 node scripts/loadtest.mjs      # test the heavy (deep-search) case
 *   CT_LOAD_BASE=https://your-app.up.railway.app node scripts/loadtest.mjs  # hit a running server
 *
 * ENV:
 *   CT_LOAD_LEVELS    comma list of concurrency levels (default 1,2,4,8,16,24)
 *   CT_LOAD_SECONDS   measurement window per level, seconds (default 12)
 *   CT_LOAD_BACKFILL_MS  bot-backfill window for the booted server (default 400)
 *   CT_LOAD_ELO       if set, patch each synthetic user's elo (local boot only) so
 *                     the bot searches deeper — use to find the high-rating ceiling
 *   CT_LOAD_THINK_MS  pause between a worker's moves (default 0 = max stress)
 *   CT_LOAD_MOVE_TIMEOUT  ms to wait for a bot reply before counting a timeout (default 25000)
 *   CT_LOAD_BASE      hit an already-running server instead of booting one (creates
 *                     synthetic accounts there — do NOT point at production)
 *
 * NOTE: numbers are for THIS machine. A Railway shared-CPU instance is typically
 * weaker, so treat local results as the shape of degradation + an optimistic bound.
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
const serverRequire = createRequire(path.join(SERVER_DIR, 'package.json'));
const CLIENT_PKG = pathToFileURL(serverRequire.resolve('socket.io-client')).href;
const Chess = serverRequire('chess.js').Chess;

const log = (...a) => console.log(...a);
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const LEVELS = String(env('CT_LOAD_LEVELS', '1,2,4,8,16,24')).split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
const WINDOW_MS = Math.round(parseFloat(env('CT_LOAD_SECONDS', '12')) * 1000);
const BACKFILL_MS = parseInt(env('CT_LOAD_BACKFILL_MS', '400'), 10);
const FORCE_ELO = env('CT_LOAD_ELO', '') ? parseInt(env('CT_LOAD_ELO'), 10) : null;
const THINK_MS = parseInt(env('CT_LOAD_THINK_MS', '0'), 10);
const MOVE_TIMEOUT = parseInt(env('CT_LOAD_MOVE_TIMEOUT', '25000'), 10);
const REMOTE_BASE = env('CT_LOAD_BASE', '');
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ---- small utils -----------------------------------------------------------
function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitForHealth(url, t = 20000) {
  const end = Date.now() + t;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await sleep(250); }
  throw new Error('health timeout');
}
function once(sock, event, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { sock.off(event, h); reject(new Error(`timeout waiting for "${event}"`)); }, timeoutMs);
    const h = (data) => { clearTimeout(t); resolve(data); };
    sock.once(event, h);
  });
}
function pct(arr, p) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1));
  return a[i];
}
const ms = (n) => (Number.isFinite(n) ? Math.round(n).toString() : '—');

// ---- server lifecycle ------------------------------------------------------
async function bootServer(port, dbPath) {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*',
      NODE_ENV: 'development', LOAD_TEST_NO_RATELIMIT: '1', BOT_BACKFILL_MS: String(BACKFILL_MS),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errOut = '';
  proc.stderr.on('data', d => { errOut += d; });
  proc.on('exit', c => { if (c) log('server exited', c, errOut.slice(-500)); });
  await waitForHealth(`http://127.0.0.1:${port}/health`);
  return proc;
}
async function killServer(proc) {
  if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
}
function rmDb(dbPath) { for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} } }

// ---- global join mutex: only one user queues at a time => always a bot game --
let joinChain = Promise.resolve();
function withJoinLock(fn) {
  const run = joinChain.then(fn, fn);
  joinChain = run.then(() => {}, () => {});
  return run;
}

// ---- a synthetic player ----------------------------------------------------
async function makeWorker(io, BASE, dbPath, idx) {
  const post = (p, body, token) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const RUN = `${Date.now().toString(36).slice(-4)}${idx}`;
  const r = await post('/api/auth/signup', { email: `lt${RUN}@load.local`, username: `LT${RUN}`, password: 'passw0rd', region: 'Load' });
  if (!r.ok) throw new Error(`signup failed for worker ${idx}: ${r.status}`);
  const token = (await r.json()).token;
  const me = await (await get('/api/me', token)).json();

  // Optional: patch starting elo directly in the local SQLite so the bot (which
  // plays at the human's rating) searches deeper — for the high-rating ceiling.
  if (FORCE_ELO && dbPath) {
    try {
      const Database = serverRequire('better-sqlite3');
      const db = new Database(dbPath);
      db.prepare('UPDATE users SET elo = ? WHERE id = ?').run(FORCE_ELO, me.id);
      db.close();
    } catch (e) { /* best-effort; the matched opp.elo in the report shows the truth */ }
  }

  const sock = io(BASE, { transports: ['websocket'], forceNew: true });
  await once(sock, 'connect', 12000);
  sock.emit('auth', { token });
  await once(sock, 'auth_ok', 12000);

  const w = {
    idx, token, sock, id: me.id, eloStart: me.elo,
    gameId: null, botColor: null, myColor: null, fen: START_FEN, botElo: null,
    active: false, ended: false,
    pendingBot: null,   // deferred resolved on the bot's reply / game over
  };

  sock.on('move_made', (d) => {
    if (!d || d.gameId !== w.gameId) return;
    if (d.fen) w.fen = d.fen;
    if (w.pendingBot && d.move && d.move.color === w.botColor) { const p = w.pendingBot; w.pendingBot = null; p.resolve({ ended: false }); }
  });
  sock.on('game_over', (d) => {
    if (!d || d.gameId !== w.gameId) return;
    w.ended = true;
    if (w.pendingBot) { const p = w.pendingBot; w.pendingBot = null; p.resolve({ ended: true }); }
  });
  return w;
}

// Get (or re-acquire) a fresh bot game for a worker. Serialized via the join lock.
async function startGame(w) {
  await withJoinLock(async () => {
    w.ended = false; w.active = false; w.gameId = null; w.fen = START_FEN;
    const matchP = once(w.sock, 'match_found', Math.max(8000, BACKFILL_MS + 6000));
    w.sock.emit('mm_join', { mode: 'ranked' });
    const m = await matchP;
    w.gameId = m.gameId;
    const iAmWhite = m.white && m.white.id === w.id;
    w.myColor = iAmWhite ? 'w' : 'b';
    w.botColor = m.botColor || (iAmWhite ? 'b' : 'w');
    const opp = iAmWhite ? m.black : m.white;
    w.botElo = opp && opp.elo;
    w.fen = START_FEN;
    // If the bot is White it opens first; wait so it's our turn before we play.
    if (w.botColor === 'w') {
      try { await once(w.sock, 'move_made', 12000); } catch {}
    }
    w.active = true;
  });
}

// One move + wait for the bot's reply. Returns latency ms, or null on timeout/error.
async function playOneMove(w, stats) {
  const c = new Chess(w.fen);
  const over = (typeof c.isGameOver === 'function') ? c.isGameOver() : c.game_over();
  if (over) { w.ended = true; return null; }
  if (c.turn() !== w.myColor) { stats.errors++; await sleep(50); return null; }
  const legal = c.moves({ verbose: true });
  if (!legal.length) { w.ended = true; return null; }
  const mv = legal[(Math.random() * legal.length) | 0];

  const t0 = performance.now();
  const replyP = new Promise((resolve) => { w.pendingBot = { resolve }; });
  const timeoutP = sleep(MOVE_TIMEOUT).then(() => 'timeout');
  w.sock.emit('move', { gameId: w.gameId, from: mv.from, to: mv.to, promotion: 'q' });
  const res = await Promise.race([replyP, timeoutP]);
  if (res === 'timeout') { w.pendingBot = null; stats.timeouts++; return null; }
  if (res.ended) { return null; } // game finished (our move mated/drew, or resign elsewhere)
  return performance.now() - t0;
}

// Worker run-loop for a measurement window: play continuously, record latencies.
async function runWorker(w, deadline, stats) {
  while (Date.now() < deadline) {
    if (!w.active || w.ended) { try { await startGame(w); } catch { stats.errors++; await sleep(200); continue; } }
    const lat = await playOneMove(w, stats);
    if (lat != null) { stats.lat.push(lat); stats.moves++; }
    if (THINK_MS) await sleep(THINK_MS);
  }
}

// Background /health pinger -> event-loop responsiveness during the window.
function startHealthPinger(BASE, deadline, out) {
  let stop = false;
  const loop = (async () => {
    while (!stop && Date.now() < deadline) {
      const t0 = performance.now();
      try { const r = await fetch(`${BASE}/health`); await r.text(); out.push(performance.now() - t0); }
      catch { out.push(NaN); }
      await sleep(250);
    }
  })();
  return { done: () => { stop = true; return loop; } };
}

function classify(healthP90, botP90) {
  if (!Number.isFinite(healthP90) || !Number.isFinite(botP90)) return 'n/a';
  if (healthP90 > 1500 || botP90 > 4000) return 'DRASTIC';
  if (healthP90 > 400 || botP90 > 1500) return 'degraded';
  return 'ok';
}

async function main() {
  const { io } = await import(CLIENT_PKG);
  let proc = null, BASE = REMOTE_BASE, dbPath = null;
  if (!REMOTE_BASE) {
    const port = await freePort();
    BASE = `http://127.0.0.1:${port}`;
    dbPath = path.join(os.tmpdir(), `ct-loadtest-${process.pid}-${port}.db`);
    proc = await bootServer(port, dbPath);
  } else {
    log(`Using remote server ${BASE} (creating synthetic accounts there — do NOT use prod).`);
  }

  const cpu = os.cpus();
  log('');
  log('=== ChessTrophies load test ===');
  log(`target        : ${BASE}${proc ? ' (booted locally)' : ' (remote)'}`);
  log(`machine       : ${cpu.length} x ${cpu[0] ? cpu[0].model.trim() : '?'}, ${(os.totalmem() / 1e9).toFixed(1)} GB`);
  log(`levels        : ${LEVELS.join(', ')} concurrent bot games`);
  log(`window/level  : ${WINDOW_MS / 1000}s   backfill: ${BACKFILL_MS}ms   think: ${THINK_MS}ms`);
  log(`bot strength  : ${FORCE_ELO ? `forced elo ${FORCE_ELO}` : 'default new-user rating (~realistic average)'}`);
  log('');

  const workers = [];
  const rows = [];
  try {
    for (const N of LEVELS) {
      // Scale up to N workers (reuse existing; each new one starts a bot game).
      while (workers.length < N) {
        const w = await makeWorker(io, BASE, dbPath, workers.length);
        workers.push(w);
        try { await startGame(w); } catch { /* counted during the run */ }
      }
      const active = workers.slice(0, N);
      // Make sure everyone has a live game before we start timing.
      await Promise.all(active.map(w => (w.active && !w.ended) ? Promise.resolve() : startGame(w).catch(() => {})));

      const stats = { lat: [], moves: 0, errors: 0, timeouts: 0 };
      const health = [];
      const deadline = Date.now() + WINDOW_MS;
      const pinger = startHealthPinger(BASE, deadline, health);
      await Promise.all(active.map(w => runWorker(w, deadline, stats)));
      await pinger.done();

      const botElo = active.map(w => w.botElo).find(Number.isFinite);
      const thru = (stats.moves / (WINDOW_MS / 1000));
      const row = {
        N, moves: stats.moves, thru,
        p50: pct(stats.lat, 50), p90: pct(stats.lat, 90), p99: pct(stats.lat, 99), max: Math.max(0, ...stats.lat),
        h50: pct(health, 50), h90: pct(health, 90), hmax: Math.max(0, ...health.filter(Number.isFinite)),
        errors: stats.errors + stats.timeouts, timeouts: stats.timeouts, botElo,
      };
      row.verdict = classify(row.h90, row.p90);
      rows.push(row);
      log(`N=${String(N).padStart(3)} | bot~${ms(botElo)} elo | moves ${String(stats.moves).padStart(5)} (${thru.toFixed(1)}/s) | ` +
          `bot-reply p50/p90/max ${ms(row.p50)}/${ms(row.p90)}/${ms(row.max)}ms | ` +
          `health p50/p90/max ${ms(row.h50)}/${ms(row.h90)}/${ms(row.hmax)}ms | ` +
          `err ${row.errors} | ${row.verdict}`);
    }
  } finally {
    for (const w of workers) { try { if (w.gameId) w.sock.emit('resign', { gameId: w.gameId }); } catch {} }
    await sleep(200);
    for (const w of workers) { try { w.sock.close(); } catch {} }
    if (proc) await killServer(proc);
    if (dbPath) rmDb(dbPath);
  }

  // ---- summary ----
  log('');
  log('=== summary ===');
  log('  N = concurrent bot games. bot-reply = per-move latency a player feels.');
  log('  health = /health round-trip = event-loop responsiveness for ALL users.');
  log('');
  log('  N   | bot-reply p90 | health p90 | moves/s | verdict');
  log('  ----+---------------+------------+---------+--------');
  for (const r of rows) log(`  ${String(r.N).padStart(3)} | ${ms(r.p90).padStart(10)}ms | ${ms(r.h90).padStart(7)}ms | ${r.thru.toFixed(1).padStart(7)} | ${r.verdict}`);
  const firstDeg = rows.find(r => r.verdict === 'degraded' || r.verdict === 'DRASTIC');
  const firstDrastic = rows.find(r => r.verdict === 'DRASTIC');
  log('');
  if (firstDeg) log(`  Latency starts to degrade around N≈${firstDeg.N} concurrent bot games.`);
  else log(`  No degradation observed up to N=${LEVELS[LEVELS.length - 1]} — raise CT_LOAD_LEVELS to find the ceiling.`);
  if (firstDrastic) log(`  DRASTIC slowdown by N≈${firstDrastic.N}.`);
  log(`  Reminder: this is THIS machine (${cpu.length} cores). Railway shared CPU is usually weaker — expect a lower ceiling there.`);
  if (!FORCE_ELO) log(`  Tested at the default ~1200 rating (cheap searches). Re-run with CT_LOAD_ELO=2000 for the heavy, deep-search worst case.`);
  log('');
}

main().then(() => process.exit(0)).catch(e => { console.error('loadtest FAILED:', e && e.stack || e); process.exit(1); });
