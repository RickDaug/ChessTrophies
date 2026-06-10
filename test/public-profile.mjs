#!/usr/bin/env node
/*
 * public-profile.mjs — integration test for the public profile endpoint
 * GET /api/users/:id/profile (the data behind the in-app profile viewer).
 *
 * Boots the real backend on a throwaway DB, signs up a user, syncs trophies +
 * a showcase via /api/progress, then asserts the public endpoint returns a SAFE
 * subset (no email/pw) including trophies, points, and the pinned showcase, and
 * 404s for an unknown id. Run: node test/public-profile.mjs. Exit 0 = PASS.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[public-profile]', ...a);
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
  const dbPath = path.join(os.tmpdir(), `ct-pubprof-${process.pid}-${port}.db`);

  let proc, err = '';
  try {
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development' }, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { err += d; });
    proc.on('exit', c => { if (c) log('server exited', c, err); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-5);
    const signup = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `pp_${RUN}@prof.local`, username: `Showcaser_${RUN}`, password: 'passw0rd', region: 'Testland' }),
    });
    assert(signup.ok, `signup failed: ${signup.status}`);
    const { token } = await signup.json();
    assert(token, 'signup returned no token');

    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const me = await (await fetch(`${BASE}/api/me`, { headers: auth })).json();
    const id = me.id;
    assert(id, '/api/me returned no id');

    // Sync trophies + a 3-trophy showcase via the authed progress endpoint.
    const sync = await fetch(`${BASE}/api/progress`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        lessonsCompleted: [], puzzles: {},
        achievements: [{ id: 'wins_t1', count: 1 }, { id: 'wins_t2', count: 1 }, { id: 'gauntlet_t4', count: 1 }],
        streakTrophies: [], trophyPoints: 180,
        showcase: ['wins_t2', 'gauntlet_t4'],
      }),
    });
    assert(sync.ok, `progress sync failed: ${sync.status}`);
    log('signed up + synced trophies/showcase');

    // The public endpoint — no auth header on purpose (it's public).
    const res = await fetch(`${BASE}/api/users/${encodeURIComponent(id)}/profile`);
    assert(res.ok, `public profile failed: ${res.status}`);
    const p = await res.json();

    assert(p.username === `Showcaser_${RUN}`, 'returns the username');
    assert(p.email === undefined, 'MUST NOT leak email');
    assert(p.pw_hash === undefined && p.flags === undefined, 'MUST NOT leak pw_hash/flags');
    assert(p.trophyPoints === 180, `returns trophyPoints (got ${p.trophyPoints})`);
    assert(p.trophyCount === 3, `returns trophyCount = 3 (got ${p.trophyCount})`);
    assert(Array.isArray(p.achievements) && p.achievements.length === 3, 'returns earned achievement ids');
    assert(Array.isArray(p.showcase) && p.showcase.length === 2 && p.showcase[0] === 'wins_t2', 'returns the pinned showcase in order');
    assert(typeof p.elo === 'number' && 'wins' in p && 'region' in p, 'returns public stats');
    log('public profile: safe fields + trophies + showcase ✓');

    const r404 = await fetch(`${BASE}/api/users/nope-not-real/profile`);
    assert(r404.status === 404, `unknown id should 404 (got ${r404.status})`);
    log('unknown id -> 404 ✓');

    log('PASS — public profile endpoint returns a safe subset with trophies + showcase');
    return 0;
  } finally {
    try { if (proc) proc.kill(); } catch {}
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} }
  }
}

main().then((code) => process.exit(code ?? 0)).catch((e) => { console.error('[public-profile] FAIL:', e.message); process.exit(1); });
