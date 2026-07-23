#!/usr/bin/env node
/*
 * trophy-authority.mjs — the trophy leaderboard must be SERVER-AUTHORITATIVE.
 *
 * WHY THIS EXISTS. The 2026-07 security audit probed production with a throwaway
 * account and confirmed a live exploit: POST /api/progress took `trophyPoints`
 * and `achievements` straight off the wire and persisted them, so a brand-new
 * account could POST `{ trophyPoints: 99999999 }` and INSTANTLY top the public
 * global trophy ladder (and show a fabricated trophy case on its public profile).
 *
 * The fix made the server score trophies itself from `server/trophy-catalog.js`.
 * This test reproduces the original attack over REAL HTTP and asserts it fails,
 * plus guards the catalog against drift from the client's `trophy-data.js`.
 *
 * Covers:
 *   1) the exact live exploit  — inflated trophyPoints + fabricated ids are ignored;
 *   2) the attacker does NOT appear on the public /api/rankings?metric=trophies;
 *   3) legitimate catalog ids DO score, with the client's tier weighting;
 *   4) streak-trophy ids must look client-minted (`t_<base36>`) and are capped;
 *   5) CATALOG PARITY — every trophy id in trophy-data.js exists in the server
 *      catalog (a new client trophy must not silently become worth 0 / be dropped).
 *
 * Run:  node test/trophy-authority.mjs   (exit 0 = PASS, 1 = FAIL)
 * Needs: server deps installed (cd server && npm i).
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { TROPHY_POINTS, scoreAchievements, statsFromUser } from '../server/trophy-catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const log = (...a) => console.log('[trophy-authority]', ...a);
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
function rmDb(p) { for (const f of [p, `${p}-wal`, `${p}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch {} } } }

// ---- 5) CATALOG PARITY (pure, no server needed) ----------------------------
// trophy-data.js is a browser script that assigns window.CT_ACHIEVEMENT_TIERS.
// Evaluate it in a fake window and compare its ids against the server catalog.
function clientTrophyIds() {
  const src = fs.readFileSync(path.join(ROOT, 'trophy-data.js'), 'utf8');
  const win = {};
  // eslint-disable-next-line no-new-func
  new Function('window', `${src}\n;return window;`)(win);
  const tiers = win.CT_ACHIEVEMENT_TIERS;
  if (!tiers) fail('could not read window.CT_ACHIEVEMENT_TIERS from trophy-data.js');
  const ids = [];
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') {
      if (typeof node.id === 'string') ids.push(node.id);
      Object.values(node).forEach(walk);
    }
  };
  walk(tiers);
  return [...new Set(ids)];
}

async function main() {
  // --- pure checks first (fast fail before booting a server) ---------------
  const clientIds = clientTrophyIds();
  assert(clientIds.length > 50, `expected a real trophy catalog from trophy-data.js, got ${clientIds.length} ids`);
  const missing = clientIds.filter(id => !(id in TROPHY_POINTS));
  assert(missing.length === 0,
    `server/trophy-catalog.js is MISSING ${missing.length} trophy id(s) from trophy-data.js — they would score 0 and be dropped from the stored array: ${missing.slice(0, 12).join(', ')}`);
  log(`catalog parity ✓ (${clientIds.length} client trophy ids all present in the server catalog)`);

  // Streak-trophy shape rules (pure).
  const junk = scoreAchievements([], [{ id: 's1' }, { id: '../../etc' }, { id: 'x'.repeat(200) }]);
  assert(junk.streakTrophies.length === 0, `non client-minted streak ids must be rejected, kept ${JSON.stringify(junk.streakTrophies)}`);
  const many = scoreAchievements([], Array.from({ length: 400 }, (_, i) => ({ id: 't_' + i.toString(36) })));
  assert(many.streakTrophies.length <= 100, `streak trophies must be capped, kept ${many.streakTrophies.length}`);
  assert(many.trophyPoints === 0, 'streak trophies must never contribute points');
  log(`streak-trophy id format enforced + capped at ${many.streakTrophies.length} ✓`);

  // --- live HTTP: reproduce the audit's production exploit -----------------
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-trophy-auth-${process.pid}-${port}.db`);
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

    const RUN = Date.now().toString(36).slice(-5);
    const mk = async (n) => {
      const r = await post('/api/auth/signup', { email: `ta${RUN}${n}@t.local`, username: `TA${RUN}${n}`, password: 'passw0rd', region: 'Test' });
      if (!r.ok) fail(`signup ${n} failed: ${r.status} ${await r.text().catch(() => '')}`);
      const token = (await r.json()).token;
      const me = await (await get('/api/me', token)).json();
      return { token, id: me.id, username: me.username };
    };

    // 1) THE EXPLOIT, verbatim from the audit's production probe.
    const attacker = await mk('atk');
    const spoof = await post('/api/progress', {
      trophyPoints: 99999999,
      achievements: Array.from({ length: 50 }, (_, i) => ({ id: `fake_trophy_${i}`, count: 999 })),
      streakTrophies: [{ id: 'fake_streak_1' }, { id: 'fake_streak_2' }],
    }, attacker.token);
    assert(spoof.ok, `progress POST should still succeed (it just must not be trusted): ${spoof.status}`);

    const atkProfile = await (await get(`/api/users/${attacker.id}/profile`)).json();
    assert(atkProfile.trophyPoints === 0,
      `THE AUDIT EXPLOIT IS BACK: client-supplied trophyPoints was persisted (got ${atkProfile.trophyPoints}, expected 0)`);
    assert(atkProfile.trophyCount === 0,
      `fabricated achievement/streak ids must be dropped, got trophyCount=${atkProfile.trophyCount}`);
    log('inflated trophyPoints + 50 fabricated ids rejected (profile shows 0/0) ✓');

    // 2) …and the attacker must not appear on the PUBLIC ladder.
    const board = await (await get('/api/rankings?metric=trophies&limit=100')).json();
    const onBoard = (board.players || []).some(p => p.id === attacker.id || p.username === attacker.username);
    assert(!onBoard, 'a spoofing account must not appear on the public trophy leaderboard');
    log('spoofer absent from the public trophy leaderboard ✓');

    // 2b) THE ENTITLEMENT ATTACK (found by post-remediation re-verification):
    //     filtering ids alone was not enough — a ZERO-GAME account could POST all
    //     105 REAL catalog ids and take the maximum 3380 points / rank #1.
    const maxer = await mk('max');
    const everyId = Object.keys(TROPHY_POINTS).map(id => ({ id, count: 1 }));
    const maxPost = await post('/api/progress', { achievements: everyId, trophyPoints: 3380 }, maxer.token);
    assert(maxPost.ok, `progress POST should succeed: ${maxPost.status}`);
    const maxProfile = await (await get(`/api/users/${maxer.id}/profile`)).json();
    assert(maxProfile.trophyPoints === 0,
      `a 0-game account claiming all ${everyId.length} REAL catalog ids must earn NOTHING (got ${maxProfile.trophyPoints} pts / ${maxProfile.trophyCount} trophies)`);
    const board1b = await (await get('/api/rankings?metric=trophies&limit=100')).json();
    assert(!(board1b.players || []).some(p => p.id === maxer.id),
      'a 0-game account claiming every trophy must not appear on the public ladder');
    log(`0-game account claiming all ${everyId.length} real catalog ids scored 0 (entitlement enforced) ✓`);

    // 3) A player who ACTUALLY EARNED them does score. Give the account real
    //    server-side counters (the same columns the server checks entitlement
    //    against) by writing them directly, then sync the matching trophies.
    const honest = await mk('hon');
    const stats = { wins: 150, losses: 10, draws: 5, elo: 1750, best_streak: 10, arena_wins: 6, invites_accepted: 5 };
    {
      const require = createRequire(path.join(SERVER_DIR, 'package.json'));
      const Database = require('better-sqlite3');
      const raw = new Database(dbPath);
      raw.prepare('UPDATE users SET wins=?, losses=?, draws=?, elo=?, best_streak=?, arena_wins=?, invites_accepted=? WHERE id=?')
        .run(stats.wins, stats.losses, stats.draws, stats.elo, stats.best_streak, stats.arena_wins, stats.invites_accepted, honest.id);
      raw.close();
    }
    // Entitled by those counters: wins_t6 (100 wins), elo_t5 (1700), arena_t2 (5),
    // streak_t4 (10). NOT entitled: wins_t8 (500 wins) and elo_t8 (2200) — both
    // are posted here and must be dropped.
    const realAch = [
      { id: 'wins_t6', count: 1 }, { id: 'elo_t5', count: 1 }, { id: 'arena_t2', count: 1 }, { id: 'streak_t4', count: 1 },
      { id: 'wins_t8', count: 1 }, { id: 'elo_t8', count: 1 },
    ];
    const expected = scoreAchievements(realAch, [], statsFromUser({
      wins: stats.wins, losses: stats.losses, draws: stats.draws, elo: stats.elo,
      best_streak: stats.best_streak, arena_wins: stats.arena_wins, invites_accepted: stats.invites_accepted,
    })).trophyPoints;
    assert(expected > 0, 'sanity: the earned fixture ids should be worth something');
    const ok = await post('/api/progress', { achievements: realAch, trophyPoints: 1, streakTrophies: [{ id: 't_zz01' }] }, honest.token);
    assert(ok.ok, `honest progress POST failed: ${ok.status}`);
    const honProfile = await (await get(`/api/users/${honest.id}/profile`)).json();
    assert(honProfile.trophyPoints === expected,
      `real trophies must score server-side (expected ${expected}, got ${honProfile.trophyPoints}) — and must ignore the client's 1`);
    assert(honProfile.trophyCount === 4 + 1,
      `only the 4 ENTITLED achievements (+1 streak trophy) should count — wins_t8/elo_t8 were claimed but not earned, got ${honProfile.trophyCount}`);
    log(`legitimate trophies scored server-side (${honProfile.trophyPoints} pts from the catalog) ✓`);

    // 4) The honest player DOES rank; the attacker still does not outrank them.
    const board2 = await (await get('/api/rankings?metric=trophies&limit=100')).json();
    const top = (board2.players || [])[0];
    assert(top && (top.id === honest.id || top.username === honest.username),
      `the honest player should lead the trophy ladder, got ${JSON.stringify(top && top.username)}`);
    log('honest player leads the ladder ✓');

    log('PASS — trophies are server-authoritative; the audit exploit is closed');
  } finally {
    try { proc && proc.kill(); } catch {}
    await new Promise(r => setTimeout(r, 250));
    rmDb(dbPath);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('[trophy-authority] FAIL:', e.message); process.exit(1); });
