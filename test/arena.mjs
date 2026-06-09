#!/usr/bin/env node
/*
 * arena.mjs — Layer 1 gate for arena tournaments (server/arena.js).
 *
 * Runs against an isolated temp SQLite DB (DATABASE_PATH) and exercises the
 * pure + store-backed core directly (no server spawn for the logic), plus the
 * public REST shape via an in-process express mount:
 *   - pure arenaScore: win/draw/loss points + the 🔥 streak bonus (3pts from
 *     the 3rd consecutive win, reset on draw/loss);
 *   - rolling lifecycle: ensureArena creates one; advanceLifecycle flips
 *     upcoming→live and finalizes ended arenas (champion + status), then a
 *     next arena is scheduled after the break;
 *   - scoring: only JOINED players are scored (bots/non-participants skipped);
 *     points + streak accumulate correctly; userStanding rank is right;
 *   - leaderboard ordering (points DESC, games ASC);
 *   - REST: /config + /current + /:id/leaderboard return sane shapes; join is
 *     auth-gated (401 without a token).
 *
 * Run:  node test/arena.mjs     Exit 0 = PASS.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const tmp = path.join(os.tmpdir(), `ct-arena-${process.pid}.db`);
try { fs.rmSync(tmp, { force: true }); } catch {}
process.env.DATABASE_PATH = tmp;
delete process.env.ARENA_ENABLED; // default ON

const log = (...a) => console.log('[arena]', ...a);
const fail = (m) => { console.error('[arena] FAIL —', m); cleanup(); process.exit(1); };
const assert = (c, m) => { if (!c) fail(m); };
function cleanup() { try { fs.rmSync(tmp, { force: true }); } catch {} }

const store = await import('../server/store.js');
const A = await import('../server/arena.js');

async function main() {
  // ---- 1) pure arenaScore ------------------------------------------------
  let s = A.arenaScore('win', 0); assert(s.points === 2 && s.streakAfter === 1 && !s.onFire, 'win@0 → 2pts, streak 1');
  s = A.arenaScore('win', 1); assert(s.points === 2 && s.streakAfter === 2 && !s.onFire, 'win@1 → 2pts, streak 2 (not yet on fire)');
  s = A.arenaScore('win', 2); assert(s.points === 3 && s.streakAfter === 3 && s.onFire, 'win@2 → 3pts (🔥), streak 3');
  s = A.arenaScore('draw', 5); assert(s.points === 1 && s.streakAfter === 0, 'draw → 1pt, streak reset');
  s = A.arenaScore('loss', 5); assert(s.points === 0 && s.streakAfter === 0, 'loss → 0pt, streak reset');
  log('pure arenaScore: win/draw/loss + 🔥 streak bonus ✓');

  // ---- 2) lifecycle ------------------------------------------------------
  const T0 = 1_000_000_000_000; // fixed base time
  const a1 = await A.ensureArena(T0);
  assert(a1 && a1.status === 'live', 'ensureArena creates a live arena when none exist');
  assert(Number(a1.ends_at) === T0 + A.ARENA_DURATION_MS, 'arena ends one duration after start');
  // ensure is idempotent (no second arena while one is open)
  const a1b = await A.ensureArena(T0 + 60_000);
  assert(a1b.id === a1.id, 'ensureArena does not duplicate while one is live');
  // advance past the end → finalize + schedule next after the break
  const tEnd = Number(a1.ends_at) + 1;
  const summary = await A.advanceLifecycle(tEnd);
  assert(summary.finalized === 1, 'advanceLifecycle finalized the ended arena');
  const a1done = await A.getArena(a1.id);
  assert(a1done.status === 'finished', 'ended arena marked finished');
  const a2 = await A.nextArena(tEnd);
  assert(a2 && a2.id !== a1.id, 'a next arena was scheduled');
  assert(Number(a2.starts_at) === Number(a1.ends_at) + A.ARENA_BREAK_MS, 'next arena starts after the break');
  log('lifecycle: ensure / live-flip / finalize / rolling-next ✓');

  // ---- 3) scoring (join-gated) ------------------------------------------
  store.default && null;
  // seed two users for the leaderboard JOIN
  const db = (await import('../server/db.js'));
  db.createUser({ id: 'u_alice', email: 'a@x.io', username: 'Alice', pw_hash: 'x' });
  db.createUser({ id: 'u_bob', email: 'b@x.io', username: 'Bob', pw_hash: 'x' });

  // Anchor the scoring + REST arena at REAL wall-clock time, because the REST
  // route reads Date.now() — a year-2001 fabricated arena would read as ended.
  const NOW = Date.now();
  const liveA = await A.ensureArena(NOW);
  assert(liveA.status === 'live', 'a fresh live arena exists at real now');

  assert(await A.joinArena(liveA.id, 'u_alice', NOW) === true, 'Alice joins');
  assert(await A.joinArena(liveA.id, 'u_bob', NOW) === true, 'Bob joins');
  // a non-joined user (simulating a bot) must NOT be scored
  const botRes = await A.recordArenaResult({ arenaId: liveA.id, userId: 'bot_zzz', result: 'win', elo: 1500, now: NOW });
  assert(botRes.scored === false, 'non-joined (bot) user is not scored');

  // Alice: win, win, win → 2 + 2 + 3 = 7, streak 3 (on fire)
  let now = NOW + 1000;
  for (let i = 0; i < 3; i++) { await A.recordArenaResult({ arenaId: liveA.id, userId: 'u_alice', result: 'win', elo: 1600, now: now += 1000 }); }
  const alice = await A.userStanding(liveA.id, 'u_alice');
  assert(alice.points === 7, `Alice 3 wins → 7 pts (got ${alice.points})`);
  assert(alice.streak === 3 && alice.onFire, 'Alice on a 3-streak (🔥)');
  assert(alice.rank === 1, 'Alice rank 1');

  // Bob: win, draw, loss → 2 + 1 + 0 = 3, streak reset
  await A.recordArenaResult({ arenaId: liveA.id, userId: 'u_bob', result: 'win', elo: 1400, now: now += 1000 });
  await A.recordArenaResult({ arenaId: liveA.id, userId: 'u_bob', result: 'draw', elo: 1400, now: now += 1000 });
  await A.recordArenaResult({ arenaId: liveA.id, userId: 'u_bob', result: 'loss', elo: 1400, now: now += 1000 });
  const bob = await A.userStanding(liveA.id, 'u_bob');
  assert(bob.points === 3 && bob.streak === 0, `Bob → 3 pts, streak 0 (got ${bob.points}/${bob.streak})`);
  assert(bob.rank === 2, 'Bob rank 2 (behind Alice)');
  log('scoring: join-gated, points + streak fire, ranks ✓');

  // ---- 4) leaderboard ordering ------------------------------------------
  const board = await A.arenaStandings(liveA.id, 10);
  assert(board.length === 2, 'two players on the board');
  assert(board[0].username === 'Alice' && board[0].points === 7, 'Alice tops the board');
  assert(board[1].username === 'Bob', 'Bob second');
  assert(board[0].rank === 1 && board[1].rank === 2, 'ranks assigned in order');
  log('leaderboard: ordering + usernames ✓');

  // ---- 5) REST shape -----------------------------------------------------
  const { createRequire } = await import('node:module');
  const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
  const express = serverRequire('express');
  const app = express();
  app.use(express.json());
  A.mountArena(app);
  const srv = http.createServer(app);
  const port = await new Promise((r) => srv.listen(0, () => r(srv.address().port)));
  const base = `http://localhost:${port}`;

  const cfg = await (await fetch(`${base}/api/arena/config`)).json();
  assert(cfg.enabled === true && cfg.tc === A.ARENA_TC, '/config reports enabled + tc');

  const cur = await (await fetch(`${base}/api/arena/current`)).json();
  assert(cur.enabled === true && cur.live && cur.live.id === liveA.id, '/current returns the live arena');
  assert(Array.isArray(cur.live.top) && cur.live.top[0].username === 'Alice', '/current embeds the top board');
  assert(typeof cur.live.players === 'number' && cur.live.players === 2, '/current players count is a number');

  const lb = await (await fetch(`${base}/api/arena/${liveA.id}/leaderboard`)).json();
  assert(Array.isArray(lb.standings) && lb.standings.length === 2, '/leaderboard returns standings');

  const joinResp = await fetch(`${base}/api/arena/${liveA.id}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert(joinResp.status === 401, 'join is auth-gated (401 without a token)');
  log('REST: /config + /current + /leaderboard shapes + auth-gated join ✓');

  // ---- 6) champion finalize + onChampion hook (mutates liveA -> finished) -
  let championArg = null;
  const champ = await A.finalizeArena(liveA, Date.now(), null, { onChampion: (a) => { championArg = a; } });
  assert(champ === 'u_alice', `champion should be Alice (top points), got ${champ}`);
  assert(championArg && championArg.championId === 'u_alice' && championArg.championPoints === 7,
    `onChampion should fire with Alice + 7 pts, got ${JSON.stringify(championArg && { id: championArg.championId, pts: championArg.championPoints })}`);
  const finishedArena = await A.getArena(liveA.id);
  assert(finishedArena.status === 'finished' && finishedArena.champion_id === 'u_alice', 'arena marked finished with champion_id set');
  const champs = await A.recentChampions(5);
  assert(champs.length >= 1 && champs[0].champion === 'Alice', `recentChampions should list Alice, got ${JSON.stringify(champs[0])}`);
  log('finalize: champion crowned (Alice, 7pts) + onChampion hook + recentChampions ✓');

  srv.close();
  cleanup();
  log('PASS — arena scoring, rolling lifecycle, join-gated scoring, leaderboard, and REST all correct');
}

main().catch((e) => { console.error('[arena] FAIL —', e && e.stack || e); cleanup(); process.exit(1); });
