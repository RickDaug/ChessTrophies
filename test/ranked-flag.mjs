#!/usr/bin/env node
/*
 * ranked-flag.mjs — tests the ranked on/off seasonal switch (RANKED_ENABLED).
 *
 * Ranked is now ON BY DEFAULT (live, with engine bot-backfill). The env override
 * still disables it. Boots the REAL backend on throwaway SQLite DBs in two
 * configurations:
 *
 *   1) RANKED_ENABLED=0 (explicitly OFF):
 *        - GET /api/config -> { rankedEnabled: false }
 *        - ranked socket matchmaking is REJECTED, never queues:
 *            mm_join {mode:'ranked'}          -> mm_err "Ranked play is coming soon."
 *            team_mm_join {}                  -> team_mm_err (2v2 is always ranked)
 *            checkers_mm_join {mode:'ranked'} -> checkers_err
 *          and NO match is found within a window.
 *
 *   2) DEFAULT (RANKED_ENABLED unset) AND RANKED_ENABLED=1:
 *        - GET /api/config -> { rankedEnabled: true } in BOTH cases.
 *
 * Run:   node test/ranked-flag.mjs   (exit 0 = PASS, 1 = FAIL)
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
const log = (...a) => console.log('[ranked-flag]', ...a);
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
function once(sock, event, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { sock.off(event, h); reject(new Error(`timeout waiting for "${event}"`)); }, timeoutMs);
    const h = (data) => { clearTimeout(t); resolve(data); };
    sock.once(event, h);
  });
}
// Resolve with the FIRST of several events to fire, or reject on timeout.
function firstOf(sock, events, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const handlers = [];
    const cleanup = () => { for (const [e, h] of handlers) sock.off(e, h); clearTimeout(t); };
    const t = setTimeout(() => { cleanup(); reject(new Error(`timeout waiting for any of [${events.join(', ')}]`)); }, timeoutMs);
    for (const e of events) {
      const h = (data) => { cleanup(); resolve({ event: e, data }); };
      handlers.push([e, h]);
      sock.once(e, h);
    }
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

  // ===================================================================
  // PART 1 — RANKED_ENABLED=0 (explicitly OFF): /api/config false + rejected.
  // ===================================================================
  {
    const port = await freePort();
    const BASE = `http://localhost:${port}`;
    const dbPath = path.join(os.tmpdir(), `ct-ranked-off-${process.pid}-${port}.db`);
    const post = (p, body, token) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
    const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const sockets = [];
    let proc;
    try {
      proc = await bootServer(port, dbPath, { RANKED_ENABLED: '0' }); // explicit OFF
      log('PART 1: backend healthy (RANKED_ENABLED=0)');

      // /api/config is PUBLIC (no auth) and reports rankedEnabled:false.
      const cfgRes = await get('/api/config');
      assert(cfgRes.ok, `/api/config failed: ${cfgRes.status}`);
      const cfg = await cfgRes.json();
      assert(cfg.rankedEnabled === false, `/api/config should be {rankedEnabled:false} with RANKED_ENABLED=0, got ${JSON.stringify(cfg)}`);
      log('GET /api/config -> { rankedEnabled:false } (RANKED_ENABLED=0) ✓');

      const RUN = Date.now().toString(36).slice(-5);
      async function signup(n) {
        const r = await post('/api/auth/signup', { email: `r${RUN}_${n}@ranked.local`, username: `R${RUN}_${n}`, password: 'passw0rd', region: 'Test' });
        assert(r.ok, `signup ${n} failed: ${r.status}`);
        return (await r.json()).token;
      }
      async function connect(token) {
        const sock = io(BASE, { transports: ['websocket'], forceNew: true });
        sockets.push(sock);
        await once(sock, 'connect');
        sock.emit('auth', { token });
        await once(sock, 'auth_ok');
        return sock;
      }
      const tokA = await signup('A');
      const tokB = await signup('B');
      const sa = await connect(tokA);
      const sb = await connect(tokB);
      log('two sockets authenticated ✓');

      // 1v1 ranked mm_join -> mm_err, and NO match_found (would only fire if a
      // second player also queued). We queue BOTH and assert both get errors.
      const eA = firstOf(sa, ['mm_err', 'match_found']);
      const eB = firstOf(sb, ['mm_err', 'match_found']);
      sa.emit('mm_join', { mode: 'ranked' });
      sb.emit('mm_join', { mode: 'ranked' });
      const [rA, rB] = await Promise.all([eA, eB]);
      assert(rA.event === 'mm_err', `ranked mm_join should emit mm_err, got ${rA.event}`);
      assert(rB.event === 'mm_err', `ranked mm_join should emit mm_err, got ${rB.event}`);
      assert(/coming soon/i.test(rA.data && rA.data.error || ''), `mm_err should explain ranked is coming soon, got ${JSON.stringify(rA.data)}`);
      log('ranked 1v1 mm_join rejected (mm_err, no match) ✓');

      // 2v2 team_mm_join is ALWAYS ranked -> team_mm_err.
      const t = firstOf(sa, ['team_mm_err', 'team_mm_queued', 'team_match_found']);
      sa.emit('team_mm_join', {});
      const rt = await t;
      assert(rt.event === 'team_mm_err', `team_mm_join should emit team_mm_err when ranked off, got ${rt.event}`);
      assert(/coming soon/i.test(rt.data && rt.data.error || ''), 'team_mm_err should explain ranked is coming soon');
      log('ranked 2v2 team_mm_join rejected (team_mm_err, not queued) ✓');

      // Checkers ranked mm_join -> checkers_err.
      const ckA = firstOf(sa, ['checkers_err', 'checkers_match_found']);
      const ckB = firstOf(sb, ['checkers_err', 'checkers_match_found']);
      sa.emit('checkers_mm_join', { mode: 'ranked', size: 8, rules: 'acf' });
      sb.emit('checkers_mm_join', { mode: 'ranked', size: 8, rules: 'acf' });
      const [rckA, rckB] = await Promise.all([ckA, ckB]);
      assert(rckA.event === 'checkers_err' && rckB.event === 'checkers_err', 'ranked checkers_mm_join should emit checkers_err');
      assert(/coming soon/i.test(rckA.data && rckA.data.error || ''), 'checkers_err should explain ranked is coming soon');
      log('ranked checkers checkers_mm_join rejected (checkers_err, no match) ✓');
    } finally {
      for (const s of sockets) { try { s.close(); } catch {} }
      await killServer(proc);
      rmDb(dbPath);
    }
  }

  // ===================================================================
  // PART 2 — DEFAULT (unset) and RANKED_ENABLED=1: /api/config reports true.
  // ===================================================================
  for (const env of [{}, { RANKED_ENABLED: '1' }]) {
    const label = env.RANKED_ENABLED ? 'RANKED_ENABLED=1' : 'DEFAULT (unset)';
    const port = await freePort();
    const BASE = `http://localhost:${port}`;
    const dbPath = path.join(os.tmpdir(), `ct-ranked-on-${process.pid}-${port}.db`);
    let proc;
    try {
      proc = await bootServer(port, dbPath, env);
      log(`PART 2: backend healthy (${label})`);
      const cfg = await (await fetch(`${BASE}/api/config`)).json();
      assert(cfg.rankedEnabled === true, `/api/config should be {rankedEnabled:true} with ${label}, got ${JSON.stringify(cfg)}`);
      log(`GET /api/config -> { rankedEnabled:true } with ${label} ✓`);
    } finally {
      await killServer(proc);
      rmDb(dbPath);
    }
  }

  log('PASS — ranked seasonal switch: ON by default, RANKED_ENABLED=0 disables; /api/config + server-side rejection verified');
  return 0;
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[ranked-flag] FAIL:', e.message); process.exit(1); });
