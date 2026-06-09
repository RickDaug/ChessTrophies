#!/usr/bin/env node
/*
 * victim.mjs — tests for the VICTIM WALL / revenge loop (the signature feature).
 *
 * THREE things are proven, all over a throwaway SQLite DB shared between this
 * process and a real booted backend (SQLite WAL allows the concurrent access):
 *
 *   Part A (in-process, the game.js hook directly):
 *     1) A streak win RECORDS a `streak_victims` row via the exported
 *        __test_recordVictimAndNotify hook — winner_id, victim_id+name, and the
 *        winner's NEW current_streak as streak_len.
 *     2) The (mock) notify + push FIRE for a HUMAN loser with the right payload
 *        ({ by, streakLen, rank }), and are SKIPPED for a bot loser.
 *     3) FAILURE ISOLATION: when the injected notify THROWS, the hook still
 *        records the row and NEVER throws — so a notify failure can never break
 *        finishGame's result/ELO write.
 *
 *   Part B (real backend, same DB file):
 *     4) GET /api/feared (public) returns the wall — the streaking winner with
 *        their currentStreak + recentVictims names.
 *     5) GET /api/me/victims (auth) returns the caller's own victim list.
 *
 * Run:   node test/victim.mjs   (exit 0 = PASS, 1 = FAIL)
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
const log = (...a) => console.log('[victim]', ...a);
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

// --- Part A: the game.js victim hook in-process ----------------------------
async function testHook(db, store, game) {
  const RUN = Math.random().toString(36).slice(2, 7);
  const winnerId = 'w_' + RUN;
  const loserId = 'l_' + RUN;
  db.createUser({ id: winnerId, email: `${winnerId}@v.local`, username: 'Winner_' + RUN, region: '', pw_hash: 'x' });
  db.createUser({ id: loserId, email: `${loserId}@v.local`, username: 'Loser_' + RUN, region: '', pw_hash: 'x' });
  // Simulate the winner's streak having just incremented to 4.
  db.db.prepare('UPDATE users SET current_streak = 4 WHERE id = ?').run(winnerId);

  // 1) + 2) record + (mock) notify/push fire for a HUMAN loser.
  let notified = null; let pushed = null;
  await game.__test_recordVictimAndNotify(null,
    { winnerId, loserId, loserName: 'Loser_' + RUN, loserIsBot: false },
    {
      notify: (uid, event, data) => { notified = { uid, event, data }; return true; },
      push: async (uid, payload) => { pushed = { uid, payload }; return { sent: 1 }; },
    });

  const rows = db.db.prepare('SELECT * FROM streak_victims WHERE winner_id = ?').all(winnerId);
  assert(rows.length === 1, `expected 1 victim row, got ${rows.length}`);
  assert(rows[0].victim_id === loserId, 'victim_id mismatch');
  assert(rows[0].victim_name === 'Loser_' + RUN, 'victim_name mismatch');
  assert(rows[0].streak_len === 4, `streak_len should be the winner's NEW streak (4), got ${rows[0].streak_len}`);
  log('streak win records a streak_victims row (winner + victim + streak_len) ✓');

  assert(notified && notified.event === 'defeated', '(mock) notify should fire a "defeated" event');
  assert(notified.uid === loserId, 'notify should target the loser');
  assert(notified.data && notified.data.by === 'Winner_' + RUN, `notify payload.by should be the winner name, got ${notified.data && notified.data.by}`);
  assert(notified.data.streakLen === 4 && notified.data.rank === 4, `notify payload should carry streakLen/rank=4, got ${JSON.stringify(notified.data)}`);
  log('(mock) in-app notify fires with { by, streakLen, rank } ✓');
  assert(pushed && pushed.uid === loserId, 'best-effort push should be invoked for the loser');
  assert(/get revenge/i.test(pushed.payload.body || ''), `push body should pitch revenge, got "${pushed.payload.body}"`);
  log('(mock) Web Push best-effort fires with a "get revenge?" body ✓');

  // 2b) a BOT loser is recorded but NOT notified.
  const botRun = 'bot_' + Math.random().toString(36).slice(2, 8);
  let botNotified = false;
  await game.__test_recordVictimAndNotify(null,
    { winnerId, loserId: botRun, loserName: 'Computer 🤖', loserIsBot: true },
    { notify: () => { botNotified = true; }, push: async () => ({ sent: 0 }) });
  const botRows = db.db.prepare('SELECT * FROM streak_victims WHERE victim_id = ?').all(botRun);
  assert(botRows.length === 1, 'a bot loser should still be recorded on the wall');
  assert(botNotified === false, 'a bot loser must NOT be notified');
  log('a bot loser is recorded but never notified ✓');

  // 3) FAILURE ISOLATION: a throwing notify must NOT throw out of the hook, and
  //    the row must STILL be recorded.
  const winner2 = 'w2_' + RUN;
  const loser2 = 'l2_' + RUN;
  db.createUser({ id: winner2, email: `${winner2}@v.local`, username: 'W2_' + RUN, region: '', pw_hash: 'x' });
  db.createUser({ id: loser2, email: `${loser2}@v.local`, username: 'L2_' + RUN, region: '', pw_hash: 'x' });
  db.db.prepare('UPDATE users SET current_streak = 2 WHERE id = ?').run(winner2);
  let threw = false;
  try {
    await game.__test_recordVictimAndNotify(null,
      { winnerId: winner2, loserId: loser2, loserName: 'L2_' + RUN, loserIsBot: false },
      {
        notify: () => { throw new Error('boom: socket exploded'); },
        push: async () => { throw new Error('boom: push exploded'); },
      });
  } catch (e) { threw = true; }
  assert(threw === false, 'a notify/push failure must NOT propagate out of the victim hook (would break finishGame)');
  const r2 = db.db.prepare('SELECT * FROM streak_victims WHERE winner_id = ?').all(winner2);
  assert(r2.length === 1, 'the victim row must still be recorded even when notify throws');
  assert(r2[0].streak_len === 2, 'streak_len recorded despite the notify failure');
  log('a throwing notify/push is isolated — hook never throws + still records the row ✓');

  return { winnerId, winnerName: 'Winner_' + RUN, loserName: 'Loser_' + RUN };
}

// --- Part B: routes over the real backend (same DB file) -------------------
async function testRoutes(BASE, store, seeded) {
  const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const post = (p, body, token) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });

  // 4) /api/feared (public) shows the streaking winner + their victims.
  const fearedRes = await get('/api/feared');
  assert(fearedRes.ok, `/api/feared failed: ${fearedRes.status}`);
  const feared = await fearedRes.json();
  assert(Array.isArray(feared.players), '/api/feared should return players[]');
  const me = feared.players.find(p => p.id === seeded.winnerId);
  assert(me, `the streaking winner should appear on the wall (players: ${feared.players.map(p => p.username).join(',')})`);
  assert(me.currentStreak === 4, `winner currentStreak should be 4, got ${me.currentStreak}`);
  assert(Array.isArray(me.recentVictims) && me.recentVictims.some(v => v.name === seeded.loserName),
    `the wall should list the recent victim "${seeded.loserName}", got ${JSON.stringify(me.recentVictims)}`);
  log('GET /api/feared returns the wall (winner + currentStreak + recent victim names) ✓');

  // 5) /api/me/victims (auth) — sign up a fresh user, seed a victim row for them,
  //    and confirm their own victim list returns it.
  const RUN = Math.random().toString(36).slice(2, 7);
  const su = await post('/api/auth/signup', { email: `v${RUN}@v.local`, username: `V${RUN}`, password: 'passw0rd', region: 'Test' });
  assert(su.ok, `signup failed: ${su.status}`);
  const { token } = await su.json();
  const myId = (await (await get('/api/me', token)).json()).id;
  // Seed: a rival beat THIS user during a streak (write via the same DB file).
  await store.recordStreakVictim({ winnerId: seeded.winnerId, victimId: myId, victimName: `V${RUN}`, streakLen: 5, createdAt: Date.now() });

  const noAuth = await get('/api/me/victims');
  assert(noAuth.status === 401, `/api/me/victims should require auth, got ${noAuth.status}`);
  const mineRes = await get('/api/me/victims', token);
  assert(mineRes.ok, `/api/me/victims failed: ${mineRes.status}`);
  const mine = await mineRes.json();
  assert(Array.isArray(mine.victims) && mine.victims.length >= 1, 'my victim list should have an entry');
  const entry = mine.victims.find(v => v.winnerId === seeded.winnerId);
  assert(entry, 'my victim list should include the rival who beat me');
  assert(entry.winnerName === seeded.winnerName, `winnerName should resolve to "${seeded.winnerName}", got "${entry.winnerName}"`);
  assert(entry.streakLen === 5, `streakLen should be 5, got ${entry.streakLen}`);
  log('GET /api/me/victims (auth) returns the caller\'s own victim list ✓');
}

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-victim-${process.pid}-${port}.db`);
  process.env.DATABASE_PATH = dbPath;
  let proc;
  try {
    // Import the data layer in-process FIRST (creates the schema at dbPath).
    const db = await importFrom('db.js');
    const store = await importFrom('store.js');
    const game = await importFrom('game.js');

    const seeded = await testHook(db, store, game);

    // Boot the real server against the SAME DB file (it opens the existing WAL DB).
    proc = await bootServer(port, dbPath);
    log('backend healthy (shared DB)');
    await testRoutes(BASE, store, seeded);

    log('PASS — victim recorded + (mock) notify fires + failure-isolated; /api/feared + /api/me/victims serve the wall');
    return 0;
  } finally {
    await killServer(proc);
    try { (await importFrom('db.js')).db.close(); } catch {}
    rmDb(dbPath);
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[victim] FAIL:', e.message); process.exit(1); });
