#!/usr/bin/env node
/*
 * admin-geo.mjs — verifies the dashboard's new geo + raw-data layer:
 *   1) signup derives country/US-state from the IP (X-Forwarded-For) and stores
 *      only the derived codes (never the IP) → stats.userGeo;
 *   2) analytics 'land' events derive visitor geo → stats.analytics.geo;
 *   3) new stat blocks exist (gameTypes, gamesByHour[24], regions, windowDays);
 *   4) the ?days window param flows through;
 *   5) the CSV export (events/users) is ADMIN_KEY-gated and includes geo columns.
 *
 * Boots the real backend on a throwaway DB. geoip-lite is offline (bundled data).
 * Run: node test/admin-geo.mjs. Exit 0 = PASS.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[admin-geo]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };
const KEY = 'testadminkey';
// Known geoip-lite results: 98.137.27.103 -> US/WA, 81.2.69.142 -> GB/ENG.
const IP_US = '98.137.27.103';
const IP_GB = '81.2.69.142';

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
  const dbPath = path.join(os.tmpdir(), `ct-admingeo-${process.pid}-${port}.db`);
  let proc, err = '';
  try {
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', ADMIN_KEY: KEY }, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { err += d; });
    proc.on('exit', c => { if (c) log('server exited', c, err); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-4);
    const signup = (uname, ip) => fetch(`${BASE}/api/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ email: `${uname}@geo.local`, username: uname, password: 'passw0rd', region: 'Testland' }),
    });
    assert((await signup(`us${RUN}`, IP_US)).ok, 'US signup failed');
    assert((await signup(`gb${RUN}`, IP_GB)).ok, 'GB signup failed');

    const ev = (visitorId, ip) => fetch(`${BASE}/api/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ name: 'land', visitorId, meta: { src: { ref: 'direct' } } }),
    });
    assert((await ev(`v_us_${RUN}`, IP_US)).ok, 'US land event failed');
    assert((await ev(`v_gb_${RUN}`, IP_GB)).ok, 'GB land event failed');
    log('seeded 2 signups + 2 land events with US/GB IPs');

    const stats = await (await fetch(`${BASE}/api/admin/stats?key=${KEY}&days=7`)).json();

    // 1) Registered-player geo.
    const ugCountries = (stats.userGeo.topCountries || []).map(x => x.country);
    assert(ugCountries.includes('US') && ugCountries.includes('GB'), `userGeo countries should include US+GB, got ${JSON.stringify(ugCountries)}`);
    const ugStates = (stats.userGeo.topStates || []).map(x => x.region);
    assert(ugStates.includes('WA'), `userGeo states should include WA, got ${JSON.stringify(ugStates)}`);
    log('userGeo: registered players by country (US/GB) + US state (WA) ✓');

    // 2) Visitor geo from analytics.
    const agCountries = (stats.analytics.geo.topCountries || []).map(x => x.country);
    assert(agCountries.includes('US') && agCountries.includes('GB'), `analytics geo should include US+GB, got ${JSON.stringify(agCountries)}`);
    assert((stats.analytics.geo.topStates || []).some(x => x.region === 'WA'), 'analytics geo states should include WA');
    log('analytics.geo: visitor traffic by country + US state ✓');

    // 3) New blocks present.
    assert(stats.gameTypes && typeof stats.gameTypes.chess === 'number' && typeof stats.gameTypes.checkers === 'number', 'gameTypes block missing');
    assert(Array.isArray(stats.gamesByHour) && stats.gamesByHour.length === 24, `gamesByHour should be a 24-length array, got ${stats.gamesByHour && stats.gamesByHour.length}`);
    assert(Array.isArray(stats.regions), 'regions block missing');
    log('new blocks: gameTypes + gamesByHour[24] + regions ✓');

    // 4) Window param flows through.
    assert(stats.windowDays === 7 && stats.analytics.windowDays === 7, `windowDays should be 7, got ${stats.windowDays}/${stats.analytics.windowDays}`);
    log('window: ?days=7 flows into stats + analytics ✓');

    // 5) CSV export.
    const noKey = await fetch(`${BASE}/api/admin/export?type=events`);
    assert(noKey.status === 403, `export without key should 403, got ${noKey.status}`);
    const evCsv = await (await fetch(`${BASE}/api/admin/export?type=events&key=${KEY}`)).text();
    assert(/^id,name,visitor_id,user_id,country,region,day_key,created_at/.test(evCsv), 'events CSV header missing geo columns');
    assert(/,US,/.test(evCsv), 'events CSV should contain a US row');
    const usersCsv = await (await fetch(`${BASE}/api/admin/export?type=users&key=${KEY}`)).text();
    assert(/geo_country/.test(usersCsv) && /geo_region/.test(usersCsv), 'users CSV missing geo columns');
    log('export: CSV gated + includes geo columns + US data ✓');

    log('PASS — geo + raw-data dashboard layer works end-to-end');
    return 0;
  } finally {
    try { if (proc) proc.kill(); } catch {}
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} }
  }
}

main().then((code) => process.exit(code ?? 0)).catch((e) => { console.error('[admin-geo] FAIL:', e.message); process.exit(1); });
