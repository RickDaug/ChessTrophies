#!/usr/bin/env node
/*
 * leagues.mjs — server contract for Friend Leagues (private clubs).
 *
 * Boots the real backend, signs up 3 users, and verifies:
 *   - create → { id, code }; owner is a member; /mine reflects it (isOwner).
 *   - join by code (idempotent); 404 on a bad code.
 *   - /:id/leaderboard is MEMBER-ONLY: members get the ranked roster, a
 *     non-member gets 403, and an unauthenticated request gets 401.
 *   - leave removes the membership.
 *
 * Run:  node test/leagues.mjs   (exit 0 = PASS)
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[leagues]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
async function waitForHealth(url, t = 15000) { const end = Date.now() + t; while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 200)); } fail('health timeout'); }

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-leagues-${process.pid}-${port}.db`);
  const proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', JWT_SECRET: 'x' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errOut = ''; proc.stderr.on('data', d => { errOut += d; });
  const post = (p, body, tok) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body || {}) });
  const get = (p, tok) => fetch(`${BASE}${p}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
  const signup = async (n) => { const r = await post('/api/auth/signup', { email: `${n}@x.io`, username: n, password: 'passw0rd', region: 'T' }); assert(r.ok, `signup ${n} failed: ${r.status}`); return (await r.json()).token; };
  try {
    await waitForHealth(`${BASE}/health`);
    const RUN = Date.now().toString(36).slice(-4);
    const A = await signup('Al' + RUN), B = await signup('Bo' + RUN), C = await signup('Ci' + RUN);
    log('3 users signed up ✓');

    // --- create -----------------------------------------------------------
    const created = await (await post('/api/leagues', { name: 'Knight Owls' }, A)).json();
    assert(created && created.id && typeof created.code === 'string' && created.code.length >= 4, `create should return id+code, got ${JSON.stringify(created)}`);
    const { id, code } = created;
    log(`A created league "Knight Owls" (code ${code}) ✓`);

    const mineA = await (await get('/api/leagues/mine', A)).json();
    const lA = (mineA.leagues || mineA).find ? (mineA.leagues || mineA) : [];
    const arr = Array.isArray(mineA) ? mineA : (mineA.leagues || []);
    const ownRow = arr.find(x => x.id === id);
    assert(ownRow && ownRow.isOwner && ownRow.members >= 1, `A's /mine should show the league as owner with >=1 member, got ${JSON.stringify(arr)}`);
    log('A /mine shows the league (owner, 1 member) ✓');

    // --- join -------------------------------------------------------------
    assert((await post('/api/leagues/join', { code: 'ZZZZZ' }, B)).status === 404, 'joining a bad code should 404');
    const joined = await (await post('/api/leagues/join', { code }, B)).json();
    assert(joined && joined.id === id, `B should join via code, got ${JSON.stringify(joined)}`);
    // idempotent
    await post('/api/leagues/join', { code }, B);
    log('B joined via code (+ bad code 404, idempotent) ✓');

    // --- member-only leaderboard -----------------------------------------
    assert((await get(`/api/leagues/${id}/leaderboard`)).status === 401, 'leaderboard unauth should 401');
    assert((await get(`/api/leagues/${id}/leaderboard`, C)).status === 403, 'non-member leaderboard should 403');
    const lb = await (await get(`/api/leagues/${id}/leaderboard`, B)).json();
    assert(lb && Array.isArray(lb.members) && lb.members.length === 2, `leaderboard should list 2 members, got ${JSON.stringify(lb).slice(0,160)}`);
    assert(lb.members.some(m => m.isOwner), 'one member should be flagged owner');
    log('leaderboard: member sees 2-player roster; non-member 403; unauth 401 ✓');

    // --- leave ------------------------------------------------------------
    const leave = await post(`/api/leagues/${id}/leave`, {}, B);
    assert(leave.ok, `leave should succeed, got ${leave.status}`);
    const mineB = await (await get('/api/leagues/mine', B)).json();
    const arrB = Array.isArray(mineB) ? mineB : (mineB.leagues || []);
    assert(!arrB.find(x => x.id === id), 'after leaving, B /mine should not list the league');
    log('B left the league (removed from /mine) ✓');

    log('PASS — leagues create / mine / join / member-only leaderboard / leave all correct');
    return 0;
  } catch (e) {
    if (errOut) console.error('server stderr:\n' + errOut.slice(0, 900));
    throw e;
  } finally {
    try { proc.kill(); } catch {}
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} }
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[leagues] FAIL:', e.message); process.exit(1); });
