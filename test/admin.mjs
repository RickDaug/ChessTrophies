#!/usr/bin/env node
/*
 * admin.mjs — integration test for the admin usage-stats endpoint.
 *
 * Boots the REAL backend on a throwaway SQLite DB with ADMIN_KEY set, signs up +
 * logs in a user (which stamps last_seen), then proves:
 *   - GET /api/admin/stats with the key returns sane counts (totalUsers >= 1,
 *     activeUsers24h >= 1 after login, all expected fields present);
 *   - no key / wrong key is rejected with 403.
 *
 * Run:   node test/admin.mjs   (exit 0 = PASS, 1 = FAIL)
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const ADMIN_KEY = 'test-admin-key-123';
const log = (...a) => console.log('[admin]', ...a);
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
  const dbPath = path.join(os.tmpdir(), `ct-admin-${process.pid}-${port}.db`);
  const post = (p, body) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  let proc, errOut = '';
  try {
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', ADMIN_KEY }, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-5);
    const email = `a${RUN}@admin.local`;
    const username = `A${RUN}`;
    const password = 'passw0rd';
    const su = await post('/api/auth/signup', { email, username, password });
    assert(su.ok, `signup failed: ${su.status}`);
    // Login stamps last_seen -> the user counts as active.
    const li = await post('/api/auth/login', { identifier: username, password });
    assert(li.ok, `login failed: ${li.status}`);
    log('signed up + logged in a user');

    // No key -> 403.
    const noKey = await fetch(`${BASE}/api/admin/stats`);
    assert(noKey.status === 403, `expected 403 without key, got ${noKey.status}`);
    // Wrong key -> 403.
    const wrong = await fetch(`${BASE}/api/admin/stats?key=nope`);
    assert(wrong.status === 403, `expected 403 with wrong key, got ${wrong.status}`);
    log('admin endpoint rejects missing/wrong key (403) ✓');

    // Correct key (header) -> stats.
    const ok = await fetch(`${BASE}/api/admin/stats`, { headers: { 'x-admin-key': ADMIN_KEY } });
    assert(ok.ok, `stats with key failed: ${ok.status}`);
    const s = await ok.json();
    const fields = ['totalUsers','verifiedUsers','premiumUsers','newUsers24h','newUsers7d','newUsers30d','activeUsers24h','activeUsers7d','onlineNow','gamesTotal','games24h','serverTime'];
    for (const f of fields) assert(typeof s[f] === 'number', `missing/non-numeric stat: ${f} (${s[f]})`);
    assert(s.totalUsers >= 1, `totalUsers should be >= 1, got ${s.totalUsers}`);
    assert(s.newUsers24h >= 1, `newUsers24h should be >= 1, got ${s.newUsers24h}`);
    assert(s.activeUsers24h >= 1, `activeUsers24h should be >= 1 after login, got ${s.activeUsers24h}`);
    log(`stats OK — total=${s.totalUsers} active24h=${s.activeUsers24h} online=${s.onlineNow} games=${s.gamesTotal} ✓`);

    // Also accept ?key= query form.
    const viaQuery = await fetch(`${BASE}/api/admin/stats?key=${encodeURIComponent(ADMIN_KEY)}`);
    assert(viaQuery.ok, `stats via ?key= failed: ${viaQuery.status}`);
    log('?key= query form works ✓');

    log('PASS — admin stats endpoint gated + returns sane usage numbers');
    return 0;
  } finally {
    if (proc) try { proc.kill(); } catch {}
  }
}

main().then(c => process.exit(c ?? 0)).catch(err => { console.error('[admin] FAIL:', err.message); process.exit(1); });
