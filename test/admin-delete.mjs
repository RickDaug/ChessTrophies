#!/usr/bin/env node
/*
 * admin-delete.mjs — verifies the ADMIN HARD DELETE used to scrub TEST accounts.
 *
 * Unlike /api/me/delete (a GDPR soft-anonymize that KEEPS the user row + games),
 * adminDeleteUserHard PERMANENTLY removes the user row AND every referencing row.
 * This test covers:
 *   PART A (logic, drives store.js on a throwaway SQLite DB):
 *     - seed a "victim" test user with rows across ~10 tables (games, analytics,
 *       season/arena/puzzle/rush stats, streak victims, league members, friends),
 *       plus a "keeper" real user with their OWN rows + a game vs a third user;
 *     - dryRun reports per-table counts and deletes NOTHING;
 *     - the real delete removes the victim + ALL their rows, the keeper and their
 *       solo rows/game survive (only the shared victim-keeper game is removed);
 *     - deleting an unknown id is a safe no-op (found:false).
 *   PART B (HTTP security gate, real backend):
 *     - DELETE /api/admin/user/:id is 403 without/with a wrong ADMIN_KEY;
 *     - with the key, ?dryRun=1 previews, the real call removes the user, and a
 *       follow-up admin GET 404s.
 *
 * Run: node test/admin-delete.mjs   Exit 0 = PASS.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[admin-delete]', ...a);
let failed = 0;
function check(cond, msg) { if (cond) log('PASS:', msg); else { failed++; log('FAIL:', msg); } }

const dbPath = path.join(os.tmpdir(), `ct-admindel-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
delete process.env.DATABASE_URL;
delete process.env.DB_BACKEND;

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function waitForHealth(url, t = 15000) {
  const end = Date.now() + t;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  throw new Error('health timeout');
}

async function partA() {
  const store = await import('../server/store.js');
  await store.init();
  const now = Date.now();
  const mk = (name) => { const id = crypto.randomUUID(); store.createUser({ id, email: `${name}@del.local`, username: name, region: 'T', pw_hash: 'x' }); return id; };
  const V = await mk('Victim');   // the test account to scrub
  const K = await mk('Keeper');   // a real account that must survive
  const W = await mk('Witness');  // another real account (Keeper's opponent)

  // Victim rows across many tables.
  await store.run('INSERT INTO games (id, white_id, black_id, mode, created_at) VALUES (?,?,?,?,?)', ['g_VK', V, K, 'casual', now]);
  await store.run('INSERT INTO games (id, white_id, black_id, mode, created_at) VALUES (?,?,?,?,?)', ['g_KW', K, W, 'ranked', now]); // must survive
  await store.run('INSERT INTO analytics_events (name, visitor_id, user_id, day_key, created_at) VALUES (?,?,?,?,?)', ['play', 'vis1', V, '2026-06-14', now]);
  await store.run('INSERT INTO analytics_events (name, visitor_id, user_id, day_key, created_at) VALUES (?,?,?,?,?)', ['play', 'vis2', K, '2026-06-14', now]); // survive
  await store.run('INSERT INTO season_stats (season_id, user_id) VALUES (?,?)', ['2026-06', V]);
  await store.run('INSERT INTO season_stats (season_id, user_id) VALUES (?,?)', ['2026-06', K]); // survive
  await store.run('INSERT INTO arena_scores (arena_id, user_id) VALUES (?,?)', ['ar1', V]);
  await store.run('INSERT INTO puzzle_solves (user_id, puzzle_id, solved_at, day_key) VALUES (?,?,?,?)', [V, 'pz1', now, '2026-06-14']);
  await store.run('INSERT INTO rush_scores (user_id, score, ended_at) VALUES (?,?,?)', [V, 5, now]);
  await store.run('INSERT INTO streak_victims (id, winner_id, victim_id, created_at) VALUES (?,?,?,?)', ['sv1', V, W, now]);   // V as winner
  await store.run('INSERT INTO streak_victims (id, winner_id, victim_id, created_at) VALUES (?,?,?,?)', ['sv2', W, V, now]);   // V as victim
  await store.run('INSERT INTO streak_victims (id, winner_id, victim_id, created_at) VALUES (?,?,?,?)', ['sv3', K, W, now]);   // survive
  await store.run('INSERT INTO league_members (league_id, user_id, joined_at) VALUES (?,?,?)', ['lg1', V, now]);
  await store.run('INSERT INTO league_members (league_id, user_id, joined_at) VALUES (?,?,?)', ['lg1', K, now]); // survive
  await store.run('INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?,?,?)', [V, K, now]);
  await store.run('INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?,?,?)', [K, V, now]);
  await store.run('INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?,?,?)', [K, W, now]); // survive

  const cnt = async (sql, p) => (await store.get(sql, p)).n;

  // --- dry run: reports counts, deletes nothing ---
  const dry = await store.adminDeleteUserHard(V, { dryRun: true });
  check(dry.dryRun === true && dry.found === true, 'dryRun reports found=true');
  check(dry.counts.users === 1 && dry.counts.games === 1 && dry.counts.streak_victims === 2 && dry.counts.friendships === 2,
    `dryRun counts look right (${JSON.stringify(dry.counts)})`);
  check(!!(await store.getUserById(V)), 'dryRun did NOT delete the user');
  check((await cnt('SELECT COUNT(*) n FROM games WHERE white_id=? OR black_id=?', [V, V])) === 1, 'dryRun left the victim game intact');

  // --- real delete ---
  const res = await store.adminDeleteUserHard(V);
  check(res.found === true && res.deleted.users === 1, 'hard delete removed the user row');
  check(res.deleted.games === 1 && res.deleted.streak_victims === 2 && res.deleted.friendships === 2,
    `hard delete removed referencing rows (${JSON.stringify(res.deleted)})`);

  // Victim fully gone.
  check(!(await store.getUserById(V)), 'victim user row is gone');
  for (const [t, where] of [['games', 'white_id=? OR black_id=?'], ['analytics_events', 'user_id=?'], ['season_stats', 'user_id=?'],
    ['arena_scores', 'user_id=?'], ['puzzle_solves', 'user_id=?'], ['rush_scores', 'user_id=?'],
    ['streak_victims', 'winner_id=? OR victim_id=?'], ['league_members', 'user_id=?'], ['friendships', 'user_id=? OR friend_id=?']]) {
    const params = (where.match(/\?/g) || []).map(() => V);
    check((await cnt(`SELECT COUNT(*) n FROM ${t} WHERE ${where}`, params)) === 0, `no ${t} rows reference the victim`);
  }

  // Keeper + Witness survive, including their solo rows + the K-vs-W game.
  check(!!(await store.getUserById(K)) && !!(await store.getUserById(W)), 'keeper + witness users survive');
  check((await cnt('SELECT COUNT(*) n FROM games WHERE id=?', ['g_KW'])) === 1, 'the keeper-vs-witness game survives');
  check((await cnt('SELECT COUNT(*) n FROM analytics_events WHERE user_id=?', [K])) === 1, 'keeper analytics survive');
  check((await cnt('SELECT COUNT(*) n FROM season_stats WHERE user_id=?', [K])) === 1, 'keeper season stats survive');
  check((await cnt('SELECT COUNT(*) n FROM streak_victims WHERE id=?', ['sv3'])) === 1, 'unrelated streak-victim row survives');
  check((await cnt('SELECT COUNT(*) n FROM league_members WHERE user_id=?', [K])) === 1, 'keeper league membership survives');
  check((await cnt('SELECT COUNT(*) n FROM friendships WHERE user_id=? AND friend_id=?', [K, W])) === 1, 'keeper-witness friendship survives');

  // Unknown id: safe no-op.
  const none = await store.adminDeleteUserHard('does-not-exist');
  check(none.found === false && none.deleted.users === 0, 'deleting an unknown id is a safe no-op');
  log('Part A (cross-table cleanup) done');
}

async function partB() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const sdb = path.join(os.tmpdir(), `ct-admindel-srv-${process.pid}-${port}.db`);
  const KEY = 'test-admin-key-123';
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(port), DATABASE_PATH: sdb, DATABASE_URL: '', DB_BACKEND: '', CORS_ORIGIN: '*', NODE_ENV: 'development', ADMIN_KEY: KEY },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errOut = ''; proc.stderr.on('data', d => { errOut += d; });
  try {
    await waitForHealth(`${BASE}/health`);
    // Sign up a victim to delete.
    const su = await (await fetch(`${BASE}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `v${port}@del.local`, username: `v${port}`, password: 'passw0rd', region: 'T' }) })).json();
    const me = await (await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${su.token}` } })).json();
    const id = me.id;

    const del = (q = '', key) => fetch(`${BASE}/api/admin/user/${id}${q}`, { method: 'DELETE', headers: key ? { 'x-admin-key': key } : {} });
    check((await del('', undefined)).status === 403, 'DELETE without ADMIN_KEY is 403');
    check((await del('', 'wrong')).status === 403, 'DELETE with a wrong ADMIN_KEY is 403');
    const dry = await (await del('?dryRun=1', KEY)).json();
    check(dry.dryRun === true && dry.found === true && dry.counts.users === 1, 'dryRun previews via the endpoint');
    const stillThere = await fetch(`${BASE}/api/admin/user/${id}?key=${KEY}`);
    check(stillThere.status === 200, 'user still present after dryRun');
    const real = await (await del('', KEY)).json();
    check(real.deleted && real.deleted.users === 1, 'real DELETE removes the user');
    const after = await fetch(`${BASE}/api/admin/user/${id}?key=${KEY}`);
    check(after.status === 404, 'admin GET 404s after the hard delete');
    log('Part B (HTTP security gate) done');
  } catch (e) {
    failed++; log('FAIL: Part B threw:', e.message, errOut.slice(0, 300));
  } finally {
    if (proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    for (const f of [sdb, `${sdb}-wal`, `${sdb}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} }
  }
}

async function main() {
  try { await partA(); await partB(); }
  finally { for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} } }
  if (failed) { log(`FAILED — ${failed} check(s) failed`); process.exit(1); }
  log('PASS — admin hard delete scrubs a user + all referencing rows; real users untouched; ADMIN_KEY-gated');
}
main().catch(e => { console.error('[admin-delete] FAIL:', e); process.exit(1); });
