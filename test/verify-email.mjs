#!/usr/bin/env node
/*
 * verify-email.mjs — integration test for email verification on signup.
 *
 * Boots the REAL backend (server/) on a throwaway SQLite DB with
 * EXPOSE_VERIFY_TOKEN=1 (so the raw token is returned instead of emailed), then
 * drives the full flow over HTTP:
 *   signup -> emailVerified:false -> verify(token) -> emailVerified:true
 * plus the negative paths: token replay is rejected, and resend on an already
 * verified account is a no-op.
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
const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');

const log = (...a) => console.log('[verify-email]', ...a);
const fail = (msg) => { throw new Error(msg); };
const assert = (cond, msg) => { if (!cond) fail(msg); };

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
async function waitForHealth(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  fail(`server health check timed out (${url})`);
}

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-verify-${process.pid}-${port}.db`);

  const post = (p, body, token) => fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  let serverProc, serverStderr = '';
  try {
    log(`starting backend on :${port}`);
    serverProc = spawn(process.execPath, ['server.js'], {
      cwd: SERVER_DIR,
      env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', EXPOSE_VERIFY_TOKEN: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    serverProc.stderr.on('data', d => { serverStderr += d.toString(); });
    serverProc.on('exit', (code) => { if (code) log(`backend exited early (code ${code}):\n${serverStderr}`); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-5);
    const cred = { email: `v${RUN}@verify.local`, username: `V${RUN}`, password: 'passw0rd', region: 'Test' };

    // 1) Signup returns a JWT + dev verification token; email is not yet verified.
    const sRes = await post('/api/auth/signup', cred);
    assert(sRes.ok, `signup failed: ${sRes.status}`);
    const s = await sRes.json();
    assert(typeof s.token === 'string' && s.token, 'signup did not return a JWT');
    assert('emailVerificationSent' in s, 'signup response missing emailVerificationSent');
    assert(s.emailVerificationSent === false, 'emailVerificationSent should be false with no RESEND key');
    assert(typeof s.devVerifyToken === 'string' && s.devVerifyToken, 'EXPOSE_VERIFY_TOKEN=1 should return devVerifyToken');
    const jwt = s.token, verifyToken = s.devVerifyToken;
    log('signup ok — JWT + devVerifyToken issued, email not sent (no provider)');

    // 2) /api/me reflects unverified.
    let me = await (await get('/api/me', jwt)).json();
    assert(me.emailVerified === false, '/api/me should report emailVerified=false before verifying');
    log('/api/me emailVerified=false before verify ✓');

    // 3) Verify with the token -> success.
    const vRes = await post('/api/auth/verify', { token: verifyToken });
    assert(vRes.ok, `verify failed: ${vRes.status} ${await vRes.text()}`);
    log('verify(token) ok ✓');

    // 4) /api/me now reflects verified.
    me = await (await get('/api/me', jwt)).json();
    assert(me.emailVerified === true, '/api/me should report emailVerified=true after verifying');
    log('/api/me emailVerified=true after verify ✓');

    // 5) Replaying the same token is rejected (token was consumed).
    const replay = await post('/api/auth/verify', { token: verifyToken });
    assert(replay.status === 400, `token replay should be rejected (got ${replay.status})`);
    log('token replay rejected ✓');

    // 6) Resend on an already-verified account is a no-op.
    const resend = await post('/api/auth/resend-verification', {}, jwt);
    assert(resend.ok, `resend failed: ${resend.status}`);
    const rBody = await resend.json();
    assert(rBody.alreadyVerified === true, 'resend on verified account should report alreadyVerified');
    log('resend on verified account is a no-op ✓');

    // 7) An invalid token is rejected too.
    const bad = await post('/api/auth/verify', { token: 'not-a-real-token' });
    assert(bad.status === 400, `invalid token should be rejected (got ${bad.status})`);
    log('invalid token rejected ✓');

    log('PASS — email verification signup flow verified end-to-end');
    return 0;
  } finally {
    if (serverProc && serverProc.exitCode === null) {
      await new Promise(res => { serverProc.once('exit', res); try { serverProc.kill(); } catch { res(); } setTimeout(res, 3000); });
    }
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      for (let i = 0; i < 6; i++) {
        try { fs.rmSync(f, { force: true }); break; }
        catch { await new Promise(r => setTimeout(r, 250)); }
      }
    }
  }
}

main().then(code => process.exit(code ?? 0)).catch(err => { console.error('[verify-email] FAIL:', err.message); process.exit(1); });
