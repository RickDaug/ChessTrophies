#!/usr/bin/env node
/*
 * progress-sync-http.mjs — REAL-HTTP round-trip test for /api/progress.
 *
 * Guards the PR #24 class of bug: the /api/progress HANDLER silently failed to
 * FORWARD some synced fields, so a db-direct test (which calls setProgress
 * straight) passed while the real HTTP sync dropped them. This test boots the
 * REAL backend (server/) on a throwaway SQLite DB + ephemeral port and does a
 * REAL fetch round-trip — it NEVER stubs /api/ — for an authenticated user:
 *
 *   POST /api/progress  with EVERY synced field gatherLocalProgress() sends:
 *     lessonsCompleted, puzzles, showcase, themeBoard, themePieces,
 *     achievements, streakTrophies, trophyPoints
 *   then reads them back and asserts each round-trips through the real handler:
 *     - GET /api/progress           -> lessonsCompleted, puzzles, showcase,
 *                                      themeBoard, themePieces
 *     - GET /api/users/:id/profile  -> achievements, trophyPoints, trophyCount,
 *                                      streakTrophyCount, showcase
 *       (the public surface where the trophy-leaderboard fields are exposed; the
 *        POST handler forwards them to the achievements/streak_trophies/
 *        trophy_points columns).
 *
 * It also re-POSTs WITHOUT the trophy fields and asserts a partial sync does NOT
 * wipe previously-stored values (the COALESCE / showcase-preserve behavior).
 *
 * Run:   node test/progress-sync-http.mjs   (exit 0 = PASS, 1 = FAIL)
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
const log = (...a) => console.log('[progress-sync-http]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };
const sameSet = (a, b) => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function waitForHealth(url, t = 15000) {
  const end = Date.now() + t;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  fail('health timeout');
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
function rmDb(dbPath) {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} }
}

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-progress-http-${process.pid}-${port}.db`);
  const post = (p, body, token) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let proc;

  try {
    proc = await bootServer(port, dbPath);
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-5);
    const r = await post('/api/auth/signup', { email: `p${RUN}@sync.local`, username: `P${RUN}`, password: 'passw0rd', region: 'Test' });
    assert(r.ok, `signup failed: ${r.status}`);
    const { token } = await r.json();
    const me = await (await get('/api/me', token)).json();
    const uid = me.id;
    log(`signed up ${me.username} (id ${uid})`);

    // The full payload that app.js gatherLocalProgress() sends.
    const payload = {
      lessonsCompleted: ['lesson-1', 'lesson-2', 'lesson-3'],
      puzzles: { solved: 7, best: 12, streak: 3, byId: { 'pz_a': 1, 'pz_b': 1 }, playStreak: { count: 4 } },
      showcase: ['wins_t6', 'gauntlet_t4', 'arena_t2'],
      themeBoard: 'marble',
      themePieces: 'neo',
      achievements: [{ id: 'wins_t6', count: 1 }, { id: 'gauntlet_t4', count: 1 }, { id: 'mate_t1', count: 2 }],
      streakTrophies: [{ id: 's1', streakNumber: 1 }, { id: 's2', streakNumber: 2 }],
      trophyPoints: 540,
    };

    // === POST the full payload over REAL HTTP. ================================
    const pr = await post('/api/progress', payload, token);
    assert(pr.ok, `POST /api/progress failed: ${pr.status} ${await pr.text()}`);
    log('POST /api/progress (full payload) accepted ✓');

    // === GET /api/progress — lessons/puzzles/showcase/theme fields. ==========
    const prog = await (await get('/api/progress', token)).json();
    assert(sameSet(prog.lessonsCompleted, payload.lessonsCompleted),
      `lessonsCompleted should round-trip, got ${JSON.stringify(prog.lessonsCompleted)}`);
    log(`GET /api/progress lessonsCompleted round-trips (${prog.lessonsCompleted.length}) ✓`);

    assert(prog.puzzles && prog.puzzles.solved === 7 && prog.puzzles.best === 12 && prog.puzzles.streak === 3,
      `puzzles counters should round-trip, got ${JSON.stringify(prog.puzzles)}`);
    assert(prog.puzzles.byId && prog.puzzles.byId.pz_a === 1 && prog.puzzles.byId.pz_b === 1,
      `puzzles.byId map should round-trip, got ${JSON.stringify(prog.puzzles.byId)}`);
    assert(prog.puzzles.playStreak && prog.puzzles.playStreak.count === 4,
      `puzzles.playStreak (tucked extra key) should survive, got ${JSON.stringify(prog.puzzles.playStreak)}`);
    log('GET /api/progress puzzles (counters + byId + playStreak) round-trip ✓');

    assert(sameSet(prog.showcase, payload.showcase),
      `showcase should round-trip, got ${JSON.stringify(prog.showcase)}`);
    assert(prog.themeBoard === 'marble', `themeBoard should round-trip, got ${prog.themeBoard}`);
    assert(prog.themePieces === 'neo', `themePieces should round-trip, got ${prog.themePieces}`);
    log('GET /api/progress showcase + themeBoard + themePieces round-trip ✓');

    // === GET /api/users/:id/profile — trophy-leaderboard fields. =============
    // These were the historically-DROPPED fields (PR #24). The POST handler must
    // forward them to the achievements/streak_trophies/trophy_points columns,
    // surfaced on the public profile.
    const profile = await (await get(`/api/users/${uid}/profile`, token)).json();
    assert(profile.trophyPoints === 540,
      `trophyPoints must round-trip via the real handler (PR #24 bug), got ${profile.trophyPoints}`);
    assert(profile.trophyCount === payload.achievements.length + payload.streakTrophies.length,
      `trophyCount = achievements(${payload.achievements.length}) + streakTrophies(${payload.streakTrophies.length}), got ${profile.trophyCount}`);
    assert(profile.streakTrophyCount === payload.streakTrophies.length,
      `streakTrophyCount should reflect the synced streak trophies, got ${profile.streakTrophyCount}`);
    const profAchIds = (profile.achievements || []).map(a => a.id);
    assert(sameSet(profAchIds, payload.achievements.map(a => a.id)),
      `achievements ids should round-trip, got ${JSON.stringify(profAchIds)}`);
    assert(sameSet(profile.showcase, payload.showcase),
      `profile showcase should round-trip, got ${JSON.stringify(profile.showcase)}`);
    log(`profile trophyPoints=${profile.trophyPoints}, trophyCount=${profile.trophyCount}, streakTrophyCount=${profile.streakTrophyCount}, achievements/showcase round-trip ✓`);

    // === Partial sync must NOT wipe previously-stored fields. =================
    // A device that syncs only lessons must not erase trophies/theme/showcase.
    const pr2 = await post('/api/progress', { lessonsCompleted: ['lesson-4'] }, token);
    assert(pr2.ok, `partial POST failed: ${pr2.status}`);
    const prog2 = await (await get('/api/progress', token)).json();
    assert(prog2.lessonsCompleted.includes('lesson-4'), 'new lesson should be added');
    assert(prog2.lessonsCompleted.includes('lesson-1'), 'old lessons should be preserved (union merge)');
    assert(sameSet(prog2.showcase, payload.showcase), 'showcase must survive a partial sync');
    assert(prog2.themeBoard === 'marble' && prog2.themePieces === 'neo', 'theme must survive a partial sync');
    const profile2 = await (await get(`/api/users/${uid}/profile`, token)).json();
    assert(profile2.trophyPoints === 540, 'trophyPoints must survive a partial sync (COALESCE)');
    assert(profile2.trophyCount === profile.trophyCount, 'trophies must survive a partial sync');
    log('partial sync preserved trophies + theme + showcase (no silent wipe) ✓');

    log('PASS — every synced /api/progress field round-trips over REAL HTTP');
    return 0;
  } finally {
    await killServer(proc);
    rmDb(dbPath);
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[progress-sync-http] FAIL:', e.message); process.exit(1); });
