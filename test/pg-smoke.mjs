#!/usr/bin/env node
/*
 * pg-smoke.mjs — backend-parameterized smoke test for the persistence layer.
 *
 * Audit finding QA-M1: db-pg.js (the pending Postgres cutover) is HAND-MIRRORED
 * from db.js and NOTHING co-tests it — the whole suite runs SQLite. This test
 * drives the dialect-sensitive paths over real HTTP against WHICHEVER backend the
 * environment selects:
 *   - DB_BACKEND=postgres + DATABASE_URL  -> exercises db-pg.js against real PG
 *     (this is what .github/workflows/postgres.yml runs);
 *   - otherwise                            -> SQLite on a throwaway file, which is
 *     how it runs in the default suite (so the TEST LOGIC itself is always
 *     verified; only the PG SQL execution is the fresh coverage in CI).
 *
 * Flows (the parts most likely to drift between the two SQL dialects):
 *   - signup -> login -> GET /api/me           (users table, premium/trophy fields)
 *   - POST then GET /api/progress              (flags JSON + achievements/trophy
 *                                               columns round-trip — the exact
 *                                               /api/progress forwarding hazard)
 *   - GET /api/rankings?metric=trophies        (topByMetric: json_array_length on
 *                                               SQLite vs jsonb_array_length on PG)
 *
 * Run:  node test/pg-smoke.mjs                       # SQLite
 *       DB_BACKEND=postgres DATABASE_URL=... node test/pg-smoke.mjs   # Postgres
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const PG = process.env.DB_BACKEND === 'postgres';
const TAG = PG ? 'pg-smoke/postgres' : 'pg-smoke/sqlite';
const log = (...a) => console.log(`[${TAG}]`, ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function waitForHealth(url, t = 20000) {
  const end = Date.now() + t;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  fail('health timeout');
}
function rmDb(p) { if (!p) return; for (const f of [p, `${p}-wal`, `${p}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch {} } } }

async function main() {
  if (PG && !process.env.DATABASE_URL) fail('DB_BACKEND=postgres requires DATABASE_URL');
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = PG ? null : path.join(os.tmpdir(), `ct-pgsmoke-${process.pid}-${port}.db`);
  const RUN = Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 5);
  const get = (p, headers = {}) => fetch(`${BASE}${p}`, { headers });
  const post = (p, body, headers = {}) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });

  let proc, errOut = '';
  try {
    const env = { ...process.env, PORT: String(port), CORS_ORIGIN: '*', NODE_ENV: 'development' };
    if (PG) { env.DB_BACKEND = 'postgres'; /* DATABASE_URL inherited */ }
    else { env.DATABASE_PATH = dbPath; delete env.DB_BACKEND; }
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut.slice(-800)); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    // signup -> token + user.
    const su = await post('/api/auth/signup', { email: `p${RUN}@smoke.local`, username: `P${RUN}`, password: 'passw0rd' });
    const suText = await su.text(); // read ONCE (interpolating it in an assert msg would consume the body)
    assert(su.ok, `signup failed: ${su.status} ${suText}`);
    const token = JSON.parse(suText).token;
    const auth = { Authorization: `Bearer ${token}` };
    const me0 = await (await get('/api/me', auth)).json();
    assert(me0.id && me0.isPremium === false, `fresh /api/me wrong: ${JSON.stringify(me0)}`);
    const userId = me0.id;
    log('signup -> /api/me (users table read/write) ✓');

    // login with the same credentials -> a fresh token.
    const li = await post('/api/auth/login', { email: `p${RUN}@smoke.local`, password: 'passw0rd' });
    assert(li.ok, `login failed: ${li.status}`);
    assert(typeof (await li.json()).token === 'string', 'login should return a token');
    log('login ✓');

    // progress sync round-trip: flags JSON + achievements/trophy_points columns.
    const sync = await post('/api/progress', {
      lessonsCompleted: ['lesson_a', 'lesson_b'],
      achievements: [{ id: 'first_win' }, { id: 'streak_3' }, { id: 'puzzle_10' }],
      trophyPoints: 45,
    }, auth);
    assert(sync.ok, `progress POST failed: ${sync.status} ${await sync.text().catch(() => '')}`);
    const prog = await (await get('/api/progress', auth)).json();
    assert(Array.isArray(prog.lessonsCompleted) && prog.lessonsCompleted.includes('lesson_a'), `lessons not persisted: ${JSON.stringify(prog.lessonsCompleted)}`);
    log('POST+GET /api/progress (flags JSON + achievements round-trip over HTTP) ✓');

    // Public profile reflects the synced trophy fields (achievements + trophy_points
    // columns read back + JSON parse of the achievements column).
    const prof = await (await get(`/api/users/${userId}/profile`)).json();
    assert(prof.trophyCount === 3, `profile trophyCount should be 3 after sync, got ${prof.trophyCount}`);
    assert(prof.trophyPoints === 45, `profile trophyPoints should be 45 after sync, got ${prof.trophyPoints}`);
    log('/api/users/:id/profile reflects synced achievements + trophy_points ✓');

    // The dialect-sensitive leaderboard query (json_array_length vs jsonb_array_length).
    const rk = await get('/api/rankings?metric=trophies&limit=50');
    const rkText = await rk.text(); // read ONCE
    assert(rk.ok, `rankings failed: ${rk.status} ${rkText}`);
    const rkBody = JSON.parse(rkText);
    assert(rkBody.metric === 'trophies' && Array.isArray(rkBody.players), `rankings shape wrong: ${JSON.stringify(rkBody).slice(0, 120)}`);
    const mine = rkBody.players.find(p => p.username === `P${RUN}`);
    assert(mine, 'the synced user should appear on the trophies leaderboard');
    log(`/api/rankings?metric=trophies (array-length SQL) -> ${rkBody.players.length} players, user present ✓`);

    // elo leaderboard too (a second topByMetric path).
    const rkElo = await get('/api/rankings?metric=elo&limit=50');
    assert(rkElo.ok && Array.isArray((await rkElo.json()).players), 'elo rankings should return a players array');
    log('/api/rankings?metric=elo ✓');

    log('PASS — auth, progress-sync round-trip, and leaderboard queries work on this backend');
    return 0;
  } finally {
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    rmDb(dbPath);
  }
}

main().then(c => process.exit(c ?? 0)).catch(e => { console.error(`[${TAG}] FAIL:`, e.message); process.exit(1); });
