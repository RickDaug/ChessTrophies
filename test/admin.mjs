#!/usr/bin/env node
/*
 * admin.mjs — integration test for the admin usage-stats endpoint.
 *
 * Boots the REAL backend on a throwaway SQLite DB with ADMIN_KEY set, signs up +
 * logs in a user (which stamps last_seen), then proves:
 *   - GET /api/admin/stats with the key returns sane counts (totalUsers >= 1,
 *     activeUsers24h >= 1 after login, all expected fields present);
 *   - no key / wrong key is rejected with 403.
 *
 * Run:   node test/admin.mjs   (exit 0 = PASS, 1 = FAIL)
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const ADMIN_KEY = 'test-admin-key-123';
const log = (...a) => console.log('[admin]', ...a);
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

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-admin-${process.pid}-${port}.db`);
  const post = (p, body) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  let proc, errOut = '';
  try {
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', ADMIN_KEY }, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-5);
    const email = `a${RUN}@admin.local`;
    const username = `A${RUN}`;
    const password = 'passw0rd';
    const su = await post('/api/auth/signup', { email, username, password });
    assert(su.ok, `signup failed: ${su.status}`);
    // Login stamps last_seen -> the user counts as active.
    const li = await post('/api/auth/login', { identifier: username, password });
    assert(li.ok, `login failed: ${li.status}`);
    log('signed up + logged in a user');

    // No key -> 403.
    const noKey = await fetch(`${BASE}/api/admin/stats`);
    assert(noKey.status === 403, `expected 403 without key, got ${noKey.status}`);
    // Wrong key -> 403.
    const wrong = await fetch(`${BASE}/api/admin/stats?key=nope`);
    assert(wrong.status === 403, `expected 403 with wrong key, got ${wrong.status}`);
    log('admin endpoint rejects missing/wrong key (403) ✓');

    // Correct key (header) -> stats.
    const ok = await fetch(`${BASE}/api/admin/stats`, { headers: { 'x-admin-key': ADMIN_KEY } });
    assert(ok.ok, `stats with key failed: ${ok.status}`);
    const s = await ok.json();
    const fields = ['totalUsers','verifiedUsers','premiumUsers','newUsers24h','newUsers7d','newUsers30d','activeUsers24h','activeUsers7d','onlineNow','gamesTotal','games24h','serverTime'];
    for (const f of fields) assert(typeof s[f] === 'number', `missing/non-numeric stat: ${f} (${s[f]})`);
    assert(s.totalUsers >= 1, `totalUsers should be >= 1, got ${s.totalUsers}`);
    assert(s.newUsers24h >= 1, `newUsers24h should be >= 1, got ${s.newUsers24h}`);
    assert(s.activeUsers24h >= 1, `activeUsers24h should be >= 1 after login, got ${s.activeUsers24h}`);
    log(`stats OK — total=${s.totalUsers} active24h=${s.activeUsers24h} online=${s.onlineNow} games=${s.gamesTotal} ✓`);

    // Also accept ?key= query form.
    const viaQuery = await fetch(`${BASE}/api/admin/stats?key=${encodeURIComponent(ADMIN_KEY)}`);
    assert(viaQuery.ok, `stats via ?key= failed: ${viaQuery.status}`);
    log('?key= query form works ✓');

    // --- Share tracking + shares stat ------------------------------------
    // Stats should ALWAYS include a stable shares object (zeros before any track).
    assert(s.shares && typeof s.shares === 'object', 'stats should include a shares object');
    assert(typeof s.shares.total === 'number', 'shares.total should be a number');
    assert(s.shares.byPlatform && typeof s.shares.byPlatform === 'object', 'shares.byPlatform should be an object');
    for (const p of ['x','facebook','whatsapp','reddit','telegram','copy','native','other']) {
      assert(typeof s.shares.byPlatform[p] === 'number', `shares.byPlatform.${p} should be a number`);
    }
    assert(s.shares.total === 0, `shares.total should start at 0, got ${s.shares.total}`);
    log('shares object present + zeroed before tracking ✓');

    // POST /api/share/track is public (no auth) + rate-limited.
    const t1 = await post('/api/share/track', { platform: 'x' });
    assert(t1.ok, `share/track x failed: ${t1.status}`);
    assert((await t1.json()).platform === 'x', 'track x should echo platform x');
    await post('/api/share/track', { platform: 'x' });
    await post('/api/share/track', { platform: 'whatsapp' });
    // Unknown platform -> bucketed as 'other'.
    const tBad = await post('/api/share/track', { platform: 'myspace' });
    assert((await tBad.json()).platform === 'other', 'unknown platform should bucket as other');
    log('share/track records platforms + buckets unknowns to other ✓');

    const s2 = await (await fetch(`${BASE}/api/admin/stats`, { headers: { 'x-admin-key': ADMIN_KEY } })).json();
    assert(s2.shares.total === 4, `shares.total should be 4 after 4 tracks, got ${s2.shares.total}`);
    assert(s2.shares.byPlatform.x === 2, `shares.byPlatform.x should be 2, got ${s2.shares.byPlatform.x}`);
    assert(s2.shares.byPlatform.whatsapp === 1, `shares.byPlatform.whatsapp should be 1, got ${s2.shares.byPlatform.whatsapp}`);
    assert(s2.shares.byPlatform.other === 1, `shares.byPlatform.other should be 1, got ${s2.shares.byPlatform.other}`);
    log('shares aggregate reflects tracked counts ✓');

    // --- Admin user directory --------------------------------------------
    // No/wrong key -> 403.
    const uNoKey = await fetch(`${BASE}/api/admin/users`);
    assert(uNoKey.status === 403, `users without key should be 403, got ${uNoKey.status}`);
    const usersRes = await fetch(`${BASE}/api/admin/users`, { headers: { 'x-admin-key': ADMIN_KEY } });
    assert(usersRes.ok, `admin/users failed: ${usersRes.status}`);
    const ud = await usersRes.json();
    assert(typeof ud.total === 'number' && Array.isArray(ud.users), 'admin/users should return {total,users[]}');
    assert(ud.total >= 1 && ud.users.length >= 1, 'admin/users should return our user');
    const u0 = ud.users.find(x => x.username === username);
    assert(u0, 'our signed-up user should appear in admin/users');
    for (const f of ['id','username','email','elo','eloCheckers8','eloCheckers10','wins','losses','draws','games','lastSeen','createdAt','emailVerified','isPremium']) {
      assert(f in u0, `admin/users row missing field: ${f}`);
    }
    assert(u0.email === email, `admin/users should expose the real email (${u0.email})`);
    assert(u0.username === username, 'admin/users should expose the username');
    assert(u0.games === (u0.wins + u0.losses + u0.draws), 'games should equal wins+losses+draws');
    log('admin/users returns username+email + full row shape ✓');

    // q filter (case-insensitive substring on username/email).
    const byU = await (await fetch(`${BASE}/api/admin/users?q=${encodeURIComponent(username.slice(0, 3).toLowerCase())}`, { headers: { 'x-admin-key': ADMIN_KEY } })).json();
    assert(byU.users.some(x => x.username === username), 'q on username substring should match');
    const byE = await (await fetch(`${BASE}/api/admin/users?q=${encodeURIComponent('admin.local')}`, { headers: { 'x-admin-key': ADMIN_KEY } })).json();
    assert(byE.users.some(x => x.email === email), 'q on email substring should match');
    const byNone = await (await fetch(`${BASE}/api/admin/users?q=zzz_no_such_user_zzz`, { headers: { 'x-admin-key': ADMIN_KEY } })).json();
    assert(byNone.total === 0 && byNone.users.length === 0, 'q with no match should return empty');
    log('admin/users q filter (username + email) works ✓');

    // limit cap + sort allowlist (sort should not error on a bad value).
    const lim = await (await fetch(`${BASE}/api/admin/users?limit=1`, { headers: { 'x-admin-key': ADMIN_KEY } })).json();
    assert(lim.users.length <= 1, 'limit=1 should cap the rows');
    const sorted = await (await fetch(`${BASE}/api/admin/users?sort=joined&limit=5`, { headers: { 'x-admin-key': ADMIN_KEY } })).json();
    assert(Array.isArray(sorted.users), 'sort=joined should return users[]');
    const badSort = await fetch(`${BASE}/api/admin/users?sort=DROP+TABLE`, { headers: { 'x-admin-key': ADMIN_KEY } });
    assert(badSort.ok, 'bad sort value should fall back to default, not error');
    log('admin/users honors limit + allowlisted sort ✓');

    log('PASS — admin stats endpoint gated + returns sane usage numbers');
    return 0;
  } finally {
    if (proc) try { proc.kill(); } catch {}
  }
}

main().then(c => process.exit(c ?? 0)).catch(err => { console.error('[admin] FAIL:', err.message); process.exit(1); });
