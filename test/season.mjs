#!/usr/bin/env node
/*
 * season.mjs — tests for SEASONS (the monthly competitive ladder).
 *
 * Proves, over a throwaway SQLite DB shared between this process and a real
 * booted backend (SQLite WAL allows the concurrent access):
 *
 *   Part A (in-process, pure helpers + the game.js hook directly):
 *     1) SEASON IDENTITY math: seasonInfo() returns the UTC calendar month as
 *        id "YYYY-MM" + a human name + startsAt/endsAt boundaries + a sane
 *        daysRemaining; previousSeasonId() rolls back across a month boundary.
 *     2) The season-stat hook INCREMENTS the player's season_stats row: a win
 *        adds +3 points + a W and snapshots peak_elo; UPSERT-idempotent across
 *        multiple games (a second win stacks).
 *     3) FAILURE ISOLATION: when the injected season write THROWS, the hook
 *        still NEVER throws — so a season-stat failure can never break
 *        finishGame's result/ELO write. The bot seat is never written.
 *
 *   Part B (real backend, same DB file):
 *     4) GET /api/season (public) returns { seasonId, name, endsAt,
 *        daysRemaining, leaderboard:[...] } with the seeded player on top.
 *     5) GET /api/season/me (auth) returns the caller's points + rank.
 *
 * Run:   node test/season.mjs   (exit 0 = PASS, 1 = FAIL)
 * Needs: server deps installed (cd server && npm i).
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[season]', ...a);
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
function rmDb(p) {
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch {} } }
}
function importFrom(file) {
  const url = new URL(`file://${path.join(SERVER_DIR, file).replace(/\\/g, '/')}`);
  return import(url.href);
}
async function bootServer(port, dbPath) {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errOut = '';
  proc.stderr.on('data', d => { errOut += d; });
  proc.on('exit', c => { if (c) log('server exited', c, errOut); });
  await waitForHealth(`http://localhost:${port}/health`);
  return proc;
}
async function killServer(proc) {
  if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
}

// --- Part A1: pure season-identity math ------------------------------------
function testSeasonMath(game) {
  // A fixed mid-June 2026 UTC timestamp -> deterministic season.
  const midJune = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15T12:00:00Z
  const s = game.seasonInfo(midJune);
  assert(s.seasonId === '2026-06', `seasonId should be "2026-06", got "${s.seasonId}"`);
  assert(s.name === 'June 2026', `name should be "June 2026", got "${s.name}"`);
  assert(s.startsAt === Date.UTC(2026, 5, 1), 'startsAt should be the first instant of June');
  assert(s.endsAt === Date.UTC(2026, 6, 1), 'endsAt should be the first instant of July (exclusive)');
  // From June 15 12:00 to July 1 00:00 is 15.5 days -> ceil = 16.
  assert(s.daysRemaining === 16, `daysRemaining from mid-June should be 16, got ${s.daysRemaining}`);
  log(`season identity math: ${s.seasonId} / "${s.name}" / endsAt=${new Date(s.endsAt).toISOString()} / ${s.daysRemaining}d left ✓`);

  // Last instant of the month -> 0 days remaining (ceil of a sub-day fraction is 1
  // unless exactly at the boundary; use the very last ms before end).
  const lastMs = Date.UTC(2026, 6, 1) - 1;
  assert(game.seasonInfo(lastMs).daysRemaining === 1, 'last ms of the month should report 1 day remaining');

  // Year boundary + previousSeasonId roll-back.
  const jan = game.seasonInfo(Date.UTC(2026, 0, 10));
  assert(jan.seasonId === '2026-01', `January id should be "2026-01", got "${jan.seasonId}"`);
  assert(game.previousSeasonId(Date.UTC(2026, 0, 10)) === '2025-12',
    `previous season before 2026-01 should be "2025-12", got "${game.previousSeasonId(Date.UTC(2026, 0, 10))}"`);
  assert(game.previousSeasonId(midJune) === '2026-05',
    `previous season before 2026-06 should be "2026-05"`);
  log('previousSeasonId rolls back across month + year boundaries ✓');
}

// --- Part A2/A3: the game.js season hook in-process ------------------------
async function testHook(db, store, game) {
  const RUN = Math.random().toString(36).slice(2, 7);
  const uid = 'su_' + RUN;
  db.createUser({ id: uid, email: `${uid}@s.local`, username: 'Seasoner_' + RUN, region: '', pw_hash: 'x' });
  const seasonId = game.seasonInfo().seasonId;

  // 2) A ranked WIN increments the season row: +3 points, +1 win, peak_elo set.
  await game.__test_recordSeasonResult({ userId: uid, result: 'win', elo: 1320 });
  let row = db.db.prepare('SELECT * FROM season_stats WHERE season_id = ? AND user_id = ?').get(seasonId, uid);
  assert(row, 'a ranked win should create a season_stats row');
  assert(row.points === 3, `a win should be +3 points, got ${row.points}`);
  assert(row.wins === 1, `a win should be +1 W, got ${row.wins}`);
  assert(row.peak_elo === 1320, `peak_elo should snapshot 1320, got ${row.peak_elo}`);
  log('a ranked win increments season_stats (+3 pts, +1 W, peak_elo) ✓');

  // A draw stacks (+1), and a lower elo does NOT lower the peak (UPSERT MAX).
  await game.__test_recordSeasonResult({ userId: uid, result: 'draw', elo: 1290 });
  row = db.db.prepare('SELECT * FROM season_stats WHERE season_id = ? AND user_id = ?').get(seasonId, uid);
  assert(row.points === 4, `win+draw should be 4 points, got ${row.points}`);
  assert(row.draws === 1, `draw should be +1 D, got ${row.draws}`);
  assert(row.peak_elo === 1320, `peak_elo should stay at the max (1320), got ${row.peak_elo}`);
  log('UPSERT stacks points/W-L-D idempotently per game + keeps peak_elo at max ✓');

  // The bot seat must never get a season row.
  await game.__test_recordSeasonResult({ userId: 'bot_deadbeef', result: 'win', elo: 1500 });
  const botRow = db.db.prepare('SELECT * FROM season_stats WHERE user_id = ?').get('bot_deadbeef');
  assert(!botRow, 'the bot seat must never be written to season_stats');
  log('the bot seat is never credited on the season ladder ✓');

  // 3) FAILURE ISOLATION: a throwing season write must NOT throw out of the hook.
  let threw = false;
  try {
    await game.__test_recordSeasonResult(
      { userId: uid, result: 'win', elo: 1400 },
      { record: () => { throw new Error('boom: season write exploded'); } });
  } catch (e) { threw = true; }
  assert(threw === false, 'a throwing season write must NOT propagate out of the hook (would break finishGame)');
  log('a throwing season write is isolated — the hook never throws ✓');

  return { uid, username: 'Seasoner_' + RUN, seasonId };
}

// --- Part B: routes over the real backend (same DB file) -------------------
async function testRoutes(BASE, store, seeded) {
  const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const post = (p, body, token) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });

  // 4) /api/season (public): countdown + leaderboard with the seeded player.
  const sRes = await get('/api/season');
  assert(sRes.ok, `/api/season failed: ${sRes.status}`);
  const s = await sRes.json();
  assert(s.seasonId === seeded.seasonId, `seasonId should be ${seeded.seasonId}, got ${s.seasonId}`);
  assert(typeof s.endsAt === 'number' && s.endsAt > Date.now(), '/api/season endsAt should be a future timestamp');
  assert(typeof s.daysRemaining === 'number' && s.daysRemaining >= 0, '/api/season should return daysRemaining');
  assert(Array.isArray(s.leaderboard), '/api/season should return a leaderboard[]');
  const meRow = s.leaderboard.find(p => p.userId === seeded.uid);
  assert(meRow, `the seeded player should appear on the leaderboard (${s.leaderboard.map(p => p.username).join(',')})`);
  assert(meRow.points === 4, `seeded player points should be 4, got ${meRow.points}`);
  assert(meRow.username === seeded.username, 'leaderboard should carry the live username');
  log('GET /api/season returns countdown + leaderboard (seeded player on the board) ✓');

  // 5) /api/season/me (auth): sign up a fresh user, give them a season win, and
  //    confirm their own standing returns points + rank. Also enforce auth.
  const noAuth = await get('/api/season/me');
  assert(noAuth.status === 401, `/api/season/me should require auth, got ${noAuth.status}`);
  const RUN = Math.random().toString(36).slice(2, 7);
  const su = await post('/api/auth/signup', { email: `s${RUN}@s.local`, username: `S${RUN}`, password: 'passw0rd', region: 'Test' });
  assert(su.ok, `signup failed: ${su.status}`);
  const { token } = await su.json();
  const myId = (await (await get('/api/me', token)).json()).id;
  await store.recordSeasonResult({ seasonId: seeded.seasonId, userId: myId, result: 'win', elo: 1210, now: Date.now() });

  const mineRes = await get('/api/season/me', token);
  assert(mineRes.ok, `/api/season/me failed: ${mineRes.status}`);
  const mine = await mineRes.json();
  assert(mine.seasonId === seeded.seasonId, '/api/season/me should report the current season');
  assert(mine.points === 3, `my season points should be 3 (one win), got ${mine.points}`);
  assert(mine.wins === 1, `my season wins should be 1, got ${mine.wins}`);
  assert(typeof mine.rank === 'number' && mine.rank >= 1, `/api/season/me should report a numeric rank, got ${mine.rank}`);
  log('GET /api/season/me (auth) returns the caller\'s points + rank ✓');
}

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-season-${process.pid}-${port}.db`);
  process.env.DATABASE_PATH = dbPath;
  let proc;
  try {
    const db = await importFrom('db.js');
    const store = await importFrom('store.js');
    const game = await importFrom('game.js');

    testSeasonMath(game);
    const seeded = await testHook(db, store, game);

    proc = await bootServer(port, dbPath);
    log('backend healthy (shared DB)');
    await testRoutes(BASE, store, seeded);

    log('PASS — season id/endsAt math + hook increments + failure-isolated; /api/season + /api/season/me serve the ladder');
    return 0;
  } finally {
    await killServer(proc);
    try { (await importFrom('db.js')).db.close(); } catch {}
    rmDb(dbPath);
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[season] FAIL:', e.message); process.exit(1); });
