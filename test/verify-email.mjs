#!/usr/bin/env node
/*
 * verify-email.mjs — integration test for email verification (6-digit code).
 *
 * Boots the REAL backend on a throwaway SQLite DB with EXPOSE_VERIFY_TOKEN=1
 * (so the 6-digit code is returned instead of emailed), then drives the flow:
 *   signup -> emailVerified:false -> POST /api/auth/verify {code} (authed)
 *          -> emailVerified:true
 * plus the negative paths: wrong codes are throttled (5 tries then burned),
 * a consumed code can't be replayed, and resend on a verified account is a no-op.
 *
 * Run:   npm run test:verify
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
const log = (...a) => console.log('[verify-email]', ...a);
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
  const dbPath = path.join(os.tmpdir(), `ct-verify-${process.pid}-${port}.db`);
  const post = (p, body, token) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  let proc, errOut = '';
  try {
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', EXPOSE_VERIFY_TOKEN: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-5);
    async function signup(n) {
      const r = await post('/api/auth/signup', { email: `v${RUN}_${n}@verify.local`, username: `V${RUN}_${n}`, password: 'passw0rd', region: 'Test' });
      assert(r.ok, `signup ${n} failed: ${r.status}`);
      return r.json();
    }

    // --- Happy path -------------------------------------------------------
    const s = await signup(1);
    assert(typeof s.token === 'string' && s.token, 'signup did not return a JWT');
    assert(s.emailVerificationSent === false, 'emailVerificationSent should be false with no RESEND key');
    assert(/^\d{6}$/.test(s.devVerifyCode || ''), `expected a 6-digit devVerifyCode, got ${s.devVerifyCode}`);
    const jwt = s.token, code = s.devVerifyCode;
    log(`signup ok — 6-digit code issued (${code}), email not sent (no provider)`);

    let me = await (await get('/api/me', jwt)).json();
    assert(me.emailVerified === false, '/api/me should be emailVerified=false before verifying');

    // Verify requires auth: without a token it should be rejected.
    const noAuth = await post('/api/auth/verify', { code });
    assert(noAuth.status === 401, `verify without auth should be 401 (got ${noAuth.status})`);
    log('verify requires authentication ✓');

    const v = await post('/api/auth/verify', { code }, jwt);
    if (!v.ok) fail(`verify failed: ${v.status}`);
    me = await (await get('/api/me', jwt)).json();
    assert(me.emailVerified === true, '/api/me should be emailVerified=true after verifying');
    log('correct code verifies the account ✓');

    // Replay: the code was consumed, so it can't be used again.
    const replay = await post('/api/auth/verify', { code }, jwt);
    assert(replay.status === 400, `consumed code replay should be 400 (got ${replay.status})`);
    log('consumed code cannot be replayed ✓');

    // Resend on an already-verified account is a no-op.
    const resend = await post('/api/auth/resend-verification', {}, jwt);
    const rb = await resend.json();
    assert(resend.ok && rb.alreadyVerified === true, 'resend on verified account should report alreadyVerified');
    log('resend on verified account is a no-op ✓');

    // --- Throttling: 5 wrong tries burn the code -------------------------
    const s2 = await signup(2);
    const jwt2 = s2.token, realCode = s2.devVerifyCode;
    const wrong = realCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await post('/api/auth/verify', { code: wrong }, jwt2);
      assert(r.status === 400, `wrong-code try ${i + 1} should be 400 (got ${r.status})`);
    }
    // 6th try, even with the CORRECT code, must fail — the code is burned.
    const burned = await post('/api/auth/verify', { code: realCode }, jwt2);
    assert(burned.status === 400, `correct code after 5 wrong tries should be rejected (got ${burned.status})`);
    let me2 = await (await get('/api/me', jwt2)).json();
    assert(me2.emailVerified === false, 'account should still be unverified after burning the code');
    log('5 wrong tries burn the code (brute-force throttle) ✓');

    // Resend gives a fresh code that works.
    const fresh = await (await post('/api/auth/resend-verification', {}, jwt2)).json();
    assert(/^\d{6}$/.test(fresh.devVerifyCode || ''), 'resend should issue a new 6-digit code');
    const v2 = await post('/api/auth/verify', { code: fresh.devVerifyCode }, jwt2);
    assert(v2.ok, `verify with fresh code failed: ${v2.status}`);
    me2 = await (await get('/api/me', jwt2)).json();
    assert(me2.emailVerified === true, 'account should be verified after using the fresh code');
    log('resend issues a new working code ✓');

    log('PASS — 6-digit email verification (authed, throttled) verified end-to-end');
    return 0;
  } finally {
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch { await new Promise(r => setTimeout(r, 250)); } } }
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[verify-email] FAIL:', e.message); process.exit(1); });
