#!/usr/bin/env node
/*
 * auth-recovery.mjs — the account RE-ENTRY paths (audit QA-M2: untested).
 *
 * Password reset and change-password are the only ways a locked-out user gets
 * back in (directly tied to return-visit / day-7), and nothing exercised them.
 * Boots the REAL backend on a throwaway SQLite DB and drives both flows over real
 * HTTP, asserting the security-critical behaviors:
 *
 *   RESET:  forgot -> devToken -> reset -> old password REJECTED, new one works;
 *           the reset token is SINGLE-USE; a garbage token is rejected.
 *   CHANGE: wrong current password REJECTED; a successful change bumps
 *           token_version so the OLD JWT is revoked while the returned fresh JWT
 *           keeps the session alive.
 *
 * EXPOSE_RESET_TOKEN=1 returns the reset token in the forgot response (the same
 * dev-fallback the app documents) so the flow is end-to-end without email.
 *
 * Run:  node test/auth-recovery.mjs   (exit 0 = PASS, 1 = FAIL)
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[auth-recovery]', ...a);
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
  const dbPath = path.join(os.tmpdir(), `ct-authrec-${process.pid}-${port}.db`);
  const post = (p, body, headers = {}) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
  const get = (p, headers = {}) => fetch(`${BASE}${p}`, { headers });
  const RUN = Date.now().toString(36).slice(-5);
  const email = `r${RUN}@recover.local`;
  const ORIG = 'origpass1', NEW1 = 'newpass1x', NEW2 = 'newpass2y';

  let proc, errOut = '';
  try {
    const env = { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', EXPOSE_RESET_TOKEN: '1', LOAD_TEST_NO_RATELIMIT: '1' };
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut.slice(-600)); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    const su = await post('/api/auth/signup', { email, username: `R${RUN}`, password: ORIG });
    assert(su.ok, `signup failed: ${su.status}`);
    log('signup ✓');

    // --- RESET FLOW -----------------------------------------------------------
    const forgot = await post('/api/auth/forgot', { email });
    assert(forgot.ok, `forgot should 200, got ${forgot.status}`);
    const devToken = (await forgot.json()).devToken;
    assert(typeof devToken === 'string' && devToken, 'forgot should expose devToken under EXPOSE_RESET_TOKEN=1');

    // Unknown email STILL returns 200 (anti-enumeration) and no token.
    const forgotUnknown = await post('/api/auth/forgot', { email: `nobody${RUN}@nope.local` });
    const fuBody = await forgotUnknown.json();
    assert(forgotUnknown.ok && !fuBody.devToken, 'forgot for an unknown email should 200 with no token (anti-enumeration)');
    log('forgot -> devToken issued; unknown email is indistinguishable ✓');

    const reset = await post('/api/auth/reset', { token: devToken, newPassword: NEW1 });
    assert(reset.ok, `reset should 200, got ${reset.status} ${await reset.text().catch(() => '')}`);

    const loginOld = await post('/api/auth/login', { email, password: ORIG });
    assert(!loginOld.ok && loginOld.status >= 400 && loginOld.status < 500, `old password should be REJECTED (4xx) after reset, got ${loginOld.status}`);
    const loginNew = await post('/api/auth/login', { email, password: NEW1 });
    assert(loginNew.ok, `new password should work after reset, got ${loginNew.status}`);
    log('reset -> old password rejected, new password works ✓');

    const reuse = await post('/api/auth/reset', { token: devToken, newPassword: 'shouldfail' });
    assert(reuse.status === 400, `a reset token must be SINGLE-USE (got ${reuse.status} on reuse)`);
    const garbage = await post('/api/auth/reset', { token: 'not-a-real-token-' + RUN, newPassword: 'shouldfail' });
    assert(garbage.status === 400, `a garbage reset token must be rejected (got ${garbage.status})`);
    log('reset token is single-use + garbage rejected ✓');

    // --- CHANGE-PASSWORD FLOW -------------------------------------------------
    const token1 = (await (await post('/api/auth/login', { email, password: NEW1 })).json()).token;
    assert(token1, 'login should return a token');
    const auth1 = { Authorization: `Bearer ${token1}` };

    const wrongCur = await post('/api/auth/change-password', { currentPassword: 'definitely-wrong', newPassword: NEW2 }, auth1);
    assert(wrongCur.status === 400, `change-password with the WRONG current password must be rejected, got ${wrongCur.status}`);
    log('change-password rejects a wrong current password ✓');

    const change = await post('/api/auth/change-password', { currentPassword: NEW1, newPassword: NEW2 }, auth1);
    const changeText = await change.text(); // read ONCE
    assert(change.ok, `change-password should 200, got ${change.status} ${changeText}`);
    const token2 = JSON.parse(changeText).token;
    assert(token2, 'change-password should return a fresh token (token_version was bumped)');

    // The OLD token must now be revoked (token_version bumped); the fresh one works.
    const meOld = await get('/api/me', auth1);
    assert(meOld.status === 401, `the OLD JWT must be revoked after change-password, got ${meOld.status}`);
    const meNew = await get('/api/me', { Authorization: `Bearer ${token2}` });
    assert(meNew.ok, `the fresh JWT must keep the session alive, got ${meNew.status}`);
    log('change-password revokes the old JWT, keeps the session on the fresh one ✓');

    const finalLogin = await post('/api/auth/login', { email, password: NEW2 });
    assert(finalLogin.ok, `login with the newest password should work, got ${finalLogin.status}`);
    log('login with the changed password works ✓');

    log('PASS — password reset + change-password behave securely (single-use token, old-password rejection, JWT revocation)');
    return 0;
  } finally {
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    rmDb(dbPath);
  }
}

main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[auth-recovery] FAIL:', e.message); process.exit(1); });
