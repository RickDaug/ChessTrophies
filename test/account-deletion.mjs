#!/usr/bin/env node
/*
 * account-deletion.mjs — self-serve account deletion (audit QA-M3: didn't exist).
 *
 * POST /api/me/delete erases the caller's PII, revokes every session, and drops
 * the social graph; the anonymized users row is retained so game/leaderboard FKs
 * stay valid (it holds no PII and can't be logged into). Boots the REAL backend on
 * a throwaway SQLite DB and asserts over real HTTP:
 *   - the wrong password is rejected (account survives);
 *   - the correct password deletes: the JWT is revoked, login no longer works,
 *     the public profile is anonymized, and the freed email can be re-registered.
 *
 * Run:  node test/account-deletion.mjs   (exit 0 = PASS, 1 = FAIL)
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[account-deletion]', ...a);
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
function rmDb(p) { for (const f of [p, `${p}-wal`, `${p}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch {} } } }

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-acctdel-${process.pid}-${port}.db`);
  const post = (p, body, headers = {}) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
  const get = (p, headers = {}) => fetch(`${BASE}${p}`, { headers });
  const RUN = Date.now().toString(36).slice(-5);
  const email = `d${RUN}@delete.local`, PW = 'deletepw1';

  let proc, errOut = '';
  try {
    const env = { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', LOAD_TEST_NO_RATELIMIT: '1' };
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut.slice(-600)); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    const token = (await (await post('/api/auth/signup', { email, username: `D${RUN}`, password: PW })).json()).token;
    assert(token, 'signup should return a token');
    const auth = { Authorization: `Bearer ${token}` };
    const userId = (await (await get('/api/me', auth)).json()).id;
    assert(userId, '/api/me should return the user id');
    log('signup ✓');

    // Wrong password -> rejected; the account must SURVIVE.
    const wrong = await post('/api/me/delete', { password: 'not-my-password' }, auth);
    assert(wrong.status === 400, `delete with wrong password should be 400, got ${wrong.status}`);
    const stillThere = await get('/api/me', auth);
    assert(stillThere.ok, 'the account must survive a wrong-password delete attempt');
    log('wrong password -> rejected, account intact ✓');

    // Correct password -> deletion.
    const del = await post('/api/me/delete', { password: PW }, auth);
    assert(del.ok, `delete with correct password should 200, got ${del.status} ${await del.text().catch(() => '')}`);
    log('correct password -> account deleted (200) ✓');

    // The JWT is revoked (token_version bumped).
    const meAfter = await get('/api/me', auth);
    assert(meAfter.status === 401, `the JWT must be revoked after deletion, got ${meAfter.status}`);
    // Login no longer works (pw cleared + email tombstoned).
    const relogin = await post('/api/auth/login', { email, password: PW });
    assert(!relogin.ok, `login must fail after deletion, got ${relogin.status}`);
    log('session revoked + login disabled ✓');

    // The public profile is anonymized (PII erased).
    const prof = await get(`/api/users/${userId}/profile`);
    if (prof.ok) {
      const pj = await prof.json();
      assert(/^deleted_/.test(pj.username || ''), `deleted user's profile should be anonymized, got username "${pj.username}"`);
      log('public profile anonymized (username -> deleted_*) ✓');
    } else {
      log(`public profile returns ${prof.status} after deletion (also acceptable) ✓`);
    }

    // The freed email can be registered again.
    const resignup = await post('/api/auth/signup', { email, username: `E${RUN}`, password: 'brandnew1' });
    assert(resignup.ok, `the freed email should be re-registerable, got ${resignup.status}`);
    log('freed email is re-registerable ✓');

    log('PASS — account deletion erases PII, revokes sessions, disables login, frees the email');
    return 0;
  } finally {
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    rmDb(dbPath);
  }
}

main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[account-deletion] FAIL:', e.message); process.exit(1); });
