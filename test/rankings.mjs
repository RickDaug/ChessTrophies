#!/usr/bin/env node
/*
 * rankings.mjs — integration test for the global rankings leaderboard.
 *
 * Regression guard for "I only see myself + local guests in rankings": the
 * client used to read only the per-device localStorage DB. The server endpoint
 * GET /api/rankings must return ALL registered users for every metric the
 * leaderboard UI offers (elo, wins, trophies, streak), sorted.
 *
 * Boots the real backend on a throwaway DB, signs up several users, and checks
 * the endpoint. Run: npm run test:rankings. Exit 0 = PASS.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[rankings]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function waitForHealth(url, t = 15000) {
  const end = Date.now() + t;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  fail('health timeout');
}

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-rankings-${process.pid}-${port}.db`);
  const post = (p, b) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
  const get = (p) => fetch(`${BASE}${p}`);

  let proc, err = '';
  try {
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development' }, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { err += d; });
    proc.on('exit', c => { if (c) log('server exited', c, err); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-5);
    const names = ['Alpha', 'Bravo', 'Charlie'].map(n => `${n}_${RUN}`);
    for (let i = 0; i < names.length; i++) {
      const r = await post('/api/auth/signup', { email: `r${RUN}_${i}@rank.local`, username: names[i], password: 'passw0rd', region: 'Testland' });
      assert(r.ok, `signup ${i} failed: ${r.status}`);
    }
    log(`signed up ${names.length} users`);

    // Every metric the leaderboard offers must return 200 + an array containing
    // ALL signed-up users (proving it's the shared server DB, not one device).
    for (const metric of ['elo', 'wins', 'trophies', 'streak']) {
      const res = await get(`/api/rankings?metric=${metric}&limit=100`);
      if (!res.ok) fail(`rankings ${metric} failed: ${res.status}`);
      const body = await res.json();
      assert(Array.isArray(body.players), `rankings ${metric}: players not an array`);
      const got = body.players.map(p => p.username);
      for (const n of names) assert(got.includes(n), `rankings ${metric}: missing user ${n} (got ${got.join(',')})`);
      // trophies field is present and numeric (computed server-side)
      assert(body.players.every(p => typeof p.trophies === 'number'), `rankings ${metric}: missing numeric trophies field`);
      log(`metric ${metric}: ${body.players.length} players, all signups present ✓`);
    }

    // Sorting sanity: default elo metric is non-increasing.
    const elo = (await (await get('/api/rankings?metric=elo&limit=100')).json()).players.map(p => p.elo);
    for (let i = 1; i < elo.length; i++) assert(elo[i - 1] >= elo[i], 'elo not sorted descending');
    log('elo sorted descending ✓');

    log('PASS — global rankings return all registered users across every metric');
    return 0;
  } finally {
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch { await new Promise(r => setTimeout(r, 250)); } } }
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[rankings] FAIL:', e.message); process.exit(1); });
