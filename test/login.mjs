#!/usr/bin/env node
/*
 * login.mjs — integration test for login by USERNAME or EMAIL.
 *
 * Boots the REAL backend on a throwaway SQLite DB, signs a user up, then proves
 * the login route accepts BOTH an email and a username as the `identifier`
 * (and still honors the legacy `{ email, password }` body), while a wrong
 * password is rejected with the generic error.
 *
 * Run:   node test/login.mjs
 * Needs: server deps installed (cd server && npm i). Exits 0 on PASS, 1 on FAIL.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[login]', ...a);
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
  const dbPath = path.join(os.tmpdir(), `ct-login-${process.pid}-${port}.db`);
  const post = (p, body) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  let proc, errOut = '';
  try {
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development' }, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-5);
    const email = `l${RUN}@login.local`;
    const username = `L${RUN}`;
    const password = 'passw0rd';

    const su = await post('/api/auth/signup', { email, username, password, region: 'Test' });
    assert(su.ok, `signup failed: ${su.status}`);
    const suBody = await su.json();
    assert(typeof suBody.token === 'string' && suBody.token, 'signup did not return a JWT');
    log('signup ok');

    // Login by EMAIL (as identifier).
    const byEmail = await post('/api/auth/login', { identifier: email, password });
    assert(byEmail.ok, `login by email failed: ${byEmail.status}`);
    assert(typeof (await byEmail.json()).token === 'string', 'login by email returned no token');
    log('login by email (identifier) ✓');

    // Login by USERNAME (as identifier) — and case-insensitive.
    const byUser = await post('/api/auth/login', { identifier: username.toUpperCase(), password });
    assert(byUser.ok, `login by username failed: ${byUser.status}`);
    assert(typeof (await byUser.json()).token === 'string', 'login by username returned no token');
    log('login by username (identifier, case-insensitive) ✓');

    // Legacy body shape `{ email, password }` still works (email is the identifier).
    const legacy = await post('/api/auth/login', { email, password });
    assert(legacy.ok, `legacy {email,password} login failed: ${legacy.status}`);
    assert(typeof (await legacy.json()).token === 'string', 'legacy login returned no token');
    log('legacy {email,password} body still works ✓');

    // Wrong password is rejected (generic error, no token).
    const wrong = await post('/api/auth/login', { identifier: username, password: 'nope-wrong' });
    assert(!wrong.ok, `wrong password should be rejected (got ${wrong.status})`);
    log('wrong password rejected ✓');

    // Unknown identifier is rejected too (account-enumeration hardening: generic).
    const unknown = await post('/api/auth/login', { identifier: 'nobody_here_xyz', password });
    assert(!unknown.ok, `unknown identifier should be rejected (got ${unknown.status})`);
    log('unknown identifier rejected ✓');

    log('PASS — login by username OR email verified end-to-end');
    return 0;
  } finally {
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch { await new Promise(r => setTimeout(r, 250)); } } }
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[login] FAIL:', e.message); process.exit(1); });
