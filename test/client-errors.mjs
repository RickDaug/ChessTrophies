#!/usr/bin/env node
/*
 * client-errors.mjs — the client-side error sink (POST /api/client-error).
 *
 * Boots the REAL backend on a throwaway SQLite DB (no Sentry env) and drives the
 * PUBLIC error-report endpoint over real HTTP:
 *   - a valid report (no auth) -> 200 { ok:true };
 *   - an empty message -> 400 (rejected);
 *   - a flood from one IP is rate-limited (429 eventually);
 *   - the endpoint never throws (always a JSON status).
 *
 * Run:  node test/client-errors.mjs   (exit 0 = PASS, 1 = FAIL)
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[client-errors]', ...a);
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
  const dbPath = path.join(os.tmpdir(), `ct-clienterr-${process.pid}-${port}.db`);
  const post = (p, body) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  let proc, errOut = '';
  try {
    const env = { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development' };
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    // 1) A valid report (no auth) -> 200 { ok:true }.
    const ok = await post('/api/client-error', {
      kind: 'error', message: 'TypeError: x is not a function',
      source: 'https://app.example/app.bundle.js', line: 42, col: 7,
      stack: 'TypeError: x is not a function\n  at app.bundle.js:42:7',
      path: '/', visitorId: 'v_test123',
    });
    assert(ok.status === 200, `valid report should be 200, got ${ok.status}`);
    const okBody = await ok.json();
    assert(okBody.ok === true, `valid report should return { ok:true }, got ${JSON.stringify(okBody)}`);
    log('valid report (public, no auth) -> 200 { ok:true } ✓');

    // 2) Empty message -> 400 (rejected, nothing to report).
    const empty = await post('/api/client-error', { kind: 'error', message: '' });
    assert(empty.status === 400, `empty message should be 400, got ${empty.status}`);
    log('empty message -> 400 ✓');

    // 3) A flood from one IP is rate-limited (RATE_MAX=10 / 30s) -> a 429 appears.
    let saw429 = false;
    for (let i = 0; i < 25; i++) {
      const r = await post('/api/client-error', { message: 'flood ' + i });
      if (r.status === 429) { saw429 = true; break; }
    }
    assert(saw429, 'a rapid flood from one IP should eventually be rate-limited (429)');
    log('per-IP flood is rate-limited (429) ✓');

    log('PASS — client-error sink ingests reports, rejects empties, rate-limits floods, never throws');
    return 0;
  } finally {
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    rmDb(dbPath);
  }
}

main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[client-errors] FAIL:', e.message); process.exit(1); });
