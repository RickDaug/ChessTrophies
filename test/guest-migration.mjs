#!/usr/bin/env node
/*
 * guest-migration.mjs — REAL server-side guest -> account migration.
 *
 * test/guest-funnel.mjs drives the migration in the BROWSER but MOCKS the server
 * (its /api/signup + /api/me are canned http responses), so it proves the CLIENT
 * carries guest state onto the account — but never that the carried progress is
 * actually PERSISTED server-side. This test closes that gap with the REAL backend.
 *
 * The server-side guest model is name-only (POST /api/guest just leases a display
 * name; guests hold their progress client-side). The migration that matters
 * server-side is: when the guest converts, the client POSTs its accrued progress
 * to /api/progress on the brand-new account. This test reproduces exactly that
 * over real HTTP and proves the progress LANDS ON THE ACCOUNT and SURVIVES:
 *
 *   1) lease a guest name (POST /api/guest) — the real guest entrypoint;
 *   2) accrue guest progress locally (lessons, puzzles, a 5-day play-streak,
 *      trophies/showcase/theme) — the same fields gatherLocalProgress() sends;
 *   3) sign up (the conversion) -> a real account + token;
 *   4) POST that guest progress to /api/progress on the new account;
 *   5) assert it round-trips on the account (GET /api/progress + the public
 *      profile aggregates) — i.e. it carried SERVER-SIDE, not just in the session;
 *   6) RE-LOGIN as the same account on a fresh token and assert the progress is
 *      STILL there — proving it persisted to the account row, not a session blob.
 *
 * Run:  node test/guest-migration.mjs   (exit 0 = PASS, 1 = FAIL)
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
const log = (...a) => console.log('[guest-migration]', ...a);
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
function rmDb(p) { for (const f of [p, `${p}-wal`, `${p}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch {} } } }

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-guest-mig-${process.pid}-${port}.db`);
  const post = (p, body, token) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  let proc, errOut = '';
  try {
    const env = { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development' };
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    // 1) Lease a guest name — the real guest entrypoint.
    const guestRes = await post('/api/guest', {});
    assert(guestRes.ok, `/api/guest failed: ${guestRes.status}`);
    const guest = await guestRes.json();
    assert(guest.isGuest === true && typeof guest.username === 'string' && guest.username, `guest lease should return { isGuest:true, username }, got ${JSON.stringify(guest)}`);
    log(`leased guest "${guest.username}" (activeGuests=${guest.activeGuests}) ✓`);

    // 2) The progress this guest accrued locally (the gatherLocalProgress shape).
    const guestProgress = {
      lessonsCompleted: ['lesson-1', 'lesson-2', 'lesson-3', 'lesson-4'],
      puzzles: { solved: 9, best: 14, streak: 5, byId: { pz_a: 1, pz_b: 1, pz_c: 1 }, playStreak: { count: 5 } },
      showcase: ['wins_t4', 'mate_t2'],
      themeBoard: 'marble',
      themePieces: 'neo',
      achievements: [{ id: 'wins_t4', count: 1 }, { id: 'mate_t2', count: 2 }, { id: 'puzzle_t1', count: 1 }],
      streakTrophies: [{ id: 's1', streakNumber: 1 }, { id: 's2', streakNumber: 2 }],
      trophyPoints: 320,
    };

    // 3) The conversion: sign up. Use the guest's display name as the username so
    //    the account inherits the guest identity (the app's convert-guest flow).
    const RUN = Date.now().toString(36).slice(-5);
    const username = ('G' + guest.username.replace(/[^A-Za-z0-9]/g, '')).slice(0, 18) + RUN.slice(-2);
    const email = `gm${RUN}@guest.local`;
    const password = 'passw0rd';
    const su = await post('/api/auth/signup', { email, username, password, region: 'Test' });
    if (!su.ok) fail(`signup (conversion) failed: ${su.status} ${await su.text().catch(() => '')}`);
    const token = (await su.json()).token;
    const me = await (await get('/api/me', token)).json();
    const uid = me.id;
    assert(uid && me.isPremium === false, 'converted account should exist');
    // The brand-new account starts with NO carried progress (proves step 4 does it).
    const before = await (await get('/api/progress', token)).json();
    assert((before.lessonsCompleted || []).length === 0, `fresh account should start with no lessons, got ${JSON.stringify(before.lessonsCompleted)}`);
    log(`converted guest -> account "${me.username}" (id ${uid}), starts empty ✓`);

    // 4) The migration write: POST the guest's accrued progress to the account.
    const sync = await post('/api/progress', guestProgress, token);
    if (!sync.ok) fail(`progress migration POST failed: ${sync.status} ${await sync.text().catch(() => '')}`);
    log('guest progress POSTed to the new account ✓');

    // 5) Assert it carried SERVER-SIDE (read back via the real handlers).
    const prog = await (await get('/api/progress', token)).json();
    assert(sameSet(prog.lessonsCompleted, guestProgress.lessonsCompleted), `lessons should carry, got ${JSON.stringify(prog.lessonsCompleted)}`);
    assert(prog.puzzles && prog.puzzles.solved === 9 && prog.puzzles.best === 14, `puzzle counters should carry, got ${JSON.stringify(prog.puzzles)}`);
    assert(prog.puzzles.byId && prog.puzzles.byId.pz_a === 1 && prog.puzzles.byId.pz_c === 1, 'puzzle solve map should carry');
    assert(prog.puzzles.playStreak && prog.puzzles.playStreak.count === 5, `the 5-day play-streak should carry, got ${JSON.stringify(prog.puzzles.playStreak)}`);
    assert(sameSet(prog.showcase, guestProgress.showcase), 'showcase should carry');
    assert(prog.themeBoard === 'marble' && prog.themePieces === 'neo', 'theme should carry');
    const profile = await (await get(`/api/users/${uid}/profile`, token)).json();
    assert(profile.trophyPoints === 320, `trophyPoints should carry onto the account, got ${profile.trophyPoints}`);
    assert(profile.trophyCount === guestProgress.achievements.length + guestProgress.streakTrophies.length,
      `trophyCount should reflect carried trophies, got ${profile.trophyCount}`);
    log(`progress carried server-side: ${prog.lessonsCompleted.length} lessons, ${prog.puzzles.solved} puzzles solved, 5-day streak, ${profile.trophyCount} trophies (${profile.trophyPoints} pts) ✓`);

    // 6) RE-LOGIN on a fresh token — proves it persisted to the ACCOUNT ROW, not
    //    a per-session blob. (This is the difference from the mocked funnel test.)
    const li = await post('/api/auth/login', { identifier: username, password });
    assert(li.ok, `re-login failed: ${li.status}`);
    const token2 = (await li.json()).token;
    assert(typeof token2 === 'string' && token2, 'login should return a usable token');
    // Confirm it's a genuine fresh auth of the SAME account (id matches).
    const me2 = await (await get('/api/me', token2)).json();
    assert(me2.id === uid, `re-login should authenticate the same account (${uid}), got ${me2.id}`);
    const prog2 = await (await get('/api/progress', token2)).json();
    assert(sameSet(prog2.lessonsCompleted, guestProgress.lessonsCompleted), 'lessons must survive re-login (persisted on the account)');
    assert(prog2.puzzles.solved === 9 && prog2.puzzles.playStreak.count === 5, 'puzzles + streak must survive re-login');
    const profile2 = await (await get(`/api/users/${uid}/profile`, token2)).json();
    assert(profile2.trophyPoints === 320 && profile2.trophyCount === profile.trophyCount, 'trophies must survive re-login');
    log('re-login authenticates the same account + still sees all carried progress (persisted on the account row) ✓');

    log('PASS — guest progress migrates SERVER-SIDE onto the converted account and survives re-login');
    return 0;
  } finally {
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    rmDb(dbPath);
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[guest-migration] FAIL:', e.message); process.exit(1); });
