#!/usr/bin/env node
/*
 * admin-tier3.mjs — verifies the tier-3 dashboard server additions:
 *   1) /api/admin/stats returns a weekly `retention` cohort array (size/returned/
 *      active/pct...), with this week's cohort populated by fresh signups;
 *   2) GET /api/admin/user/:id (ADMIN_KEY-gated) returns a profile snapshot with
 *      derived geo + recentGames; 403 without key; 404 for unknown id.
 *
 * Boots the real backend on a throwaway DB. Run: node test/admin-tier3.mjs. Exit 0 = PASS.
 */
import { spawn } from 'node:child_process';
import net from 'node:net'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[admin-tier3]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };
const KEY = 'tier3key';

function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
async function waitForHealth(url, t = 15000) { const end = Date.now() + t; while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); } fail('health timeout'); }

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-tier3-${process.pid}-${port}.db`);
  let proc, err = '';
  try {
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', ADMIN_KEY: KEY }, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { err += d; });
    proc.on('exit', c => { if (c) log('server exited', c, err); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-4);
    // Sign up a few users (this week's cohort) with a US/WA IP.
    let token = '';
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${BASE}/api/auth/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '98.137.27.103' },
        body: JSON.stringify({ email: `t3_${RUN}_${i}@x.local`, username: `t3${RUN}${i}`, password: 'passw0rd', region: 'Testland' }),
      });
      assert(r.ok, `signup ${i} failed`);
      if (i === 0) token = (await r.json()).token;
    }
    const me = await (await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const id = me.id;
    log('seeded 3 signups (this-week cohort)');

    // 1) Retention cohort block.
    const stats = await (await fetch(`${BASE}/api/admin/stats?key=${KEY}`)).json();
    assert(Array.isArray(stats.retention) && stats.retention.length === 8, `retention should be an 8-week array, got ${stats.retention && stats.retention.length}`);
    const last = stats.retention[stats.retention.length - 1]; // current week
    assert(last && last.size >= 3, `current-week cohort should have >=3 signups, got ${last && last.size}`);
    assert(typeof last.pctReturned === 'number' && typeof last.pctActive === 'number' && typeof last.returned === 'number' && typeof last.active === 'number', 'cohort should carry returned/active/pct fields');
    // D1/D7/D30 retention fields present; a brand-new cohort is too young -> null.
    assert('d1' in last && 'd7' in last && 'd30' in last, 'cohort should carry d1/d7/d30 fields');
    assert(last.d7 === null, `a fresh cohort should have null D7 (too young), got ${last.d7}`);
    for (const r of stats.retention) {
      for (const k of ['d1', 'd7', 'd30']) assert(r[k] === null || typeof r[k] === 'number', `${k} must be null or a number, got ${r[k]}`);
    }
    log(`retention: 8-week cohorts + D1/D7/D30 (young cohort D7=null), size=${last.size} ✓`);

    // Interval retention CURVES (cohort triangle from the activity log).
    assert(stats.retentionCurves && Array.isArray(stats.retentionCurves.cohorts), 'retentionCurves.cohorts should be an array');
    const cc = stats.retentionCurves.cohorts.find(c => c.size >= 3);
    assert(cc && Array.isArray(cc.curve) && cc.curve[0] === 100, `this-week cohort curve[0] should be 100, got ${cc && JSON.stringify(cc.curve)}`);
    log('retention curves: endpoint returns the cohort triangle (week 0 = 100%) ✓');

    // 2) User-detail endpoint.
    const noKey = await fetch(`${BASE}/api/admin/user/${id}`);
    assert(noKey.status === 403, `user-detail without key should 403, got ${noKey.status}`);
    const u = await (await fetch(`${BASE}/api/admin/user/${id}?key=${KEY}`)).json();
    assert(u.username === `t3${RUN}0`, `user-detail should return the username, got ${u.username}`);
    assert(u.geoCountry === 'US' && u.geoRegion === 'WA', `user-detail should include derived geo US/WA, got ${u.geoCountry}/${u.geoRegion}`);
    assert(Array.isArray(u.recentGames), 'user-detail should include recentGames array');
    assert(u.pw_hash === undefined && u.password === undefined, 'user-detail must not leak password');
    const notFound = await fetch(`${BASE}/api/admin/user/nope?key=${KEY}`);
    assert(notFound.status === 404, `unknown user should 404, got ${notFound.status}`);
    log('user-detail: gated + geo + recentGames + no secrets + 404 ✓');

    log('PASS — tier-3 retention cohorts + user-detail endpoint work');
    return 0;
  } finally {
    try { if (proc) proc.kill(); } catch {}
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} }
  }
}

main().then((code) => process.exit(code ?? 0)).catch((e) => { console.error('[admin-tier3] FAIL:', e.message); process.exit(1); });
