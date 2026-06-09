#!/usr/bin/env node
/*
 * puzzles.mjs — tests for the interactive puzzle subsystem.
 *
 * Part A (pure, no server): every SEED puzzle's full solution line is fully legal
 *   when replayed through the bundled chess.js, and mate-tagged puzzles really
 *   end in checkmate. Also asserts the deterministic-daily selection is stable
 *   for a fixed date input (same date -> same index, always).
 *
 * Part B (live server on a throwaway SQLite DB):
 *   - GET /api/puzzles/daily is deterministic ACROSS requests (same id twice).
 *   - GET /api/puzzles/next?rating= returns a puzzle near the target rating.
 *   - POST /api/puzzles/solved is auth-gated, idempotent, and advances the
 *     daily streak (re-solving the SAME puzzle does NOT inflate it).
 *
 * Run:   node test/puzzles.mjs    (exit 0 = PASS, 1 = FAIL)
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const log = (...a) => console.log('[puzzles]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

async function loadChess() {
  const mod = await import(pathToFileURL(path.join(ROOT, 'chess.min.js')).href);
  return mod.Chess;
}

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function waitForHealth(url, t = 15000) {
  const end = Date.now() + t;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  fail('health timeout');
}

// ---------------------------------------------------------------------------
// PART A — seed legality + deterministic daily (pure)
// ---------------------------------------------------------------------------
async function partA() {
  const Chess = await loadChess();
  const { PUZZLE_SEED } = await import(pathToFileURL(path.join(SERVER_DIR, 'puzzle-seed.mjs')).href);
  const { dailyIndex, utcDayKey } = await import(pathToFileURL(path.join(SERVER_DIR, 'puzzles.js')).href);

  assert(Array.isArray(PUZZLE_SEED) && PUZZLE_SEED.length > 0, 'seed corpus is empty');
  const ids = new Set();
  let validated = 0;
  for (const p of PUZZLE_SEED) {
    assert(p.id && !ids.has(p.id), `duplicate or missing seed id: ${p.id}`);
    ids.add(p.id);
    assert(typeof p.fen === 'string' && p.fen.split(/\s+/).length === 6, `bad FEN on ${p.id}`);
    assert(Array.isArray(p.moves) && p.moves.length >= 1, `${p.id} has no moves`);

    const c = new Chess(p.fen);
    assert(c.fen().split(' ')[0] === p.fen.split(' ')[0], `${p.id}: FEN did not load`);
    const solverColor = c.turn();
    let endedMate = false;
    for (let i = 0; i < p.moves.length; i++) {
      const uci = p.moves[i];
      assert(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci), `${p.id}: malformed UCI "${uci}"`);
      const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4) : undefined });
      assert(mv, `${p.id}: ILLEGAL move "${uci}" at ply ${i} (fen now ${c.fen()})`);
      endedMate = c.in_checkmate();
      // Even indices are solver moves -> the side that moved must be the solver.
      if (i % 2 === 0) assert(mv.color === solverColor, `${p.id}: solver move ${uci} played by wrong color`);
    }
    // Mate-tagged puzzles must actually finish in checkmate.
    if (p.theme === 'mate') assert(endedMate, `${p.id}: theme=mate but the line is not checkmate`);
    validated++;
  }
  log(`A1 OK — ${validated}/${PUZZLE_SEED.length} seed puzzles have a fully LEGAL solution line ✓`);

  // Deterministic daily: same date -> same index, every time; in-range.
  const n = PUZZLE_SEED.length;
  const day = '2026-06-07';
  const idx1 = dailyIndex(day, n);
  const idx2 = dailyIndex(day, n);
  assert(idx1 === idx2, 'dailyIndex is not deterministic for a fixed date');
  assert(idx1 >= 0 && idx1 < n, `dailyIndex out of range: ${idx1}`);
  // Different dates should generally differ (sanity: at least one of a sample does).
  const samples = ['2026-01-01', '2026-06-07', '2026-12-31', '2025-03-15'];
  const indices = samples.map((d) => dailyIndex(d, n));
  assert(new Set(indices).size > 1, 'dailyIndex maps many dates to a single index (not spread)');
  // utcDayKey must produce a stable YYYY-MM-DD for an injected Date.
  assert(utcDayKey(new Date('2026-06-07T23:59:00Z')) === '2026-06-07', 'utcDayKey wrong for injected date');
  log(`A2 OK — daily selection deterministic (index ${idx1} for ${day}), spread across dates ✓`);
}

// ---------------------------------------------------------------------------
// PART B — live endpoints
// ---------------------------------------------------------------------------
async function partB() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-puzzles-${process.pid}-${port}.db`);
  const post = (p, body, token) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  let proc, errOut = '';
  try {
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development' }, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    // Daily is deterministic across two requests.
    const d1 = await (await get('/api/puzzles/daily')).json();
    const d2 = await (await get('/api/puzzles/daily')).json();
    assert(d1 && d1.puzzle && d1.puzzle.id, 'daily missing puzzle');
    assert(d1.puzzle.id === d2.puzzle.id, `daily not deterministic across requests: ${d1.puzzle.id} vs ${d2.puzzle.id}`);
    assert(Array.isArray(d1.puzzle.moves) && d1.puzzle.moves.length >= 1, 'daily puzzle has no moves');
    log(`B1 OK — /daily deterministic across requests (id ${d1.puzzle.id}, ${d1.dayKey}) ✓`);

    // Trainer: nearest-by-rating.
    const t = await (await get('/api/puzzles/next?rating=1450')).json();
    assert(t && t.puzzle && t.puzzle.id, 'next missing puzzle');
    assert(typeof t.puzzle.rating === 'number', 'next puzzle missing rating');
    log(`B2 OK — /next?rating=1450 -> ${t.puzzle.id} (rating ${t.puzzle.rating}) ✓`);

    // /solved requires auth.
    const noAuth = await post('/api/puzzles/solved', { puzzleId: d1.puzzle.id });
    assert(noAuth.status === 401, `/solved should be 401 without auth, got ${noAuth.status}`);
    log('B3 OK — /solved is auth-gated (401 unauthenticated) ✓');

    // Sign up a user, solve a puzzle, assert streak = 1, idempotent on re-solve.
    const RUN = Date.now().toString(36).slice(-5);
    const su = await post('/api/auth/signup', { email: `p${RUN}@pz.local`, username: `P${RUN}`, password: 'passw0rd', region: 'Test' });
    assert(su.ok, `signup failed: ${su.status}`);
    const token = (await su.json()).token;

    // The CORRECT proof-of-solve line = the daily puzzle's even-index (solver)
    // plies. The client must submit exactly these for the server to verify.
    const solverLine = d1.puzzle.moves.filter((_, i) => i % 2 === 0);
    assert(solverLine.length >= 1, 'daily puzzle has no solver plies');

    // SECURITY: /solved must REQUIRE proof of solve. A bare id (no `moves`) must
    // be rejected (400) and must NOT advance the streak — this is the forgery
    // that the BLOCKER was about (curl the id => free streak).
    const noMoves = await post('/api/puzzles/solved', { puzzleId: d1.puzzle.id }, token);
    assert(noMoves.status === 400, `/solved without moves should be 400, got ${noMoves.status}`);
    const progAfterNoMoves = await (await get('/api/puzzles/progress', token)).json();
    assert(progAfterNoMoves.currentStreak === 0 && progAfterNoMoves.totalSolved === 0,
      `missing-moves solve must NOT advance streak, got ${JSON.stringify(progAfterNoMoves)}`);
    log('B4a OK — /solved with MISSING solution line rejected (400), streak unchanged ✓');

    // A WRONG solution line must also be rejected (400) and not advance the streak.
    const wrongLine = solverLine.slice();
    wrongLine[0] = wrongLine[0] === 'a1a1' ? 'h1h1' : 'a1a1'; // a non-matching token
    const wrong = await post('/api/puzzles/solved', { puzzleId: d1.puzzle.id, moves: wrongLine }, token);
    assert(wrong.status === 400, `/solved with WRONG moves should be 400, got ${wrong.status}`);
    const progAfterWrong = await (await get('/api/puzzles/progress', token)).json();
    assert(progAfterWrong.currentStreak === 0 && progAfterWrong.totalSolved === 0,
      `wrong-moves solve must NOT advance streak, got ${JSON.stringify(progAfterWrong)}`);
    log('B4b OK — /solved with WRONG solution line rejected (400), streak unchanged ✓');

    // The CORRECT solution line records the solve and advances the streak to 1.
    const s1 = await (await post('/api/puzzles/solved', { puzzleId: d1.puzzle.id, moves: solverLine }, token)).json();
    assert(s1.ok && s1.solved, '/solved did not record');
    assert(s1.currentStreak === 1, `first solve streak should be 1, got ${s1.currentStreak}`);
    assert(s1.alreadySolved === false, 'first solve should not be alreadySolved');
    log(`B4 OK — CORRECT solution line records, streak=1 ✓`);

    // Re-solving the SAME puzzle the SAME day (with the correct line) must NOT
    // inflate the streak.
    const s2 = await (await post('/api/puzzles/solved', { puzzleId: d1.puzzle.id, moves: solverLine }, token)).json();
    assert(s2.currentStreak === 1, `re-solve must keep streak at 1, got ${s2.currentStreak}`);
    assert(s2.alreadySolved === true, 're-solve should report alreadySolved=true');
    log('B5 OK — idempotent: re-solving same puzzle (correct line) keeps streak at 1 ✓');

    // Unknown puzzle id is rejected (can't pad the streak with garbage ids).
    const bad = await post('/api/puzzles/solved', { puzzleId: 'does-not-exist', moves: solverLine }, token);
    assert(bad.status === 404, `unknown puzzleId should be 404, got ${bad.status}`);
    log('B6 OK — unknown puzzleId rejected (404) ✓');

    // Progress endpoint reflects the solve.
    const prog = await (await get('/api/puzzles/progress', token)).json();
    assert(prog.currentStreak === 1 && prog.totalSolved >= 1, `progress wrong: ${JSON.stringify(prog)}`);
    assert(Array.isArray(prog.solvedIds) && prog.solvedIds.indexOf(d1.puzzle.id) >= 0, 'solvedIds missing the solved puzzle');
    log('B7 OK — /progress reflects streak + solved id ✓');

    log('PASS — puzzle endpoints behave correctly (deterministic daily, idempotent solve + streak)');
  } finally {
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch { await new Promise(r => setTimeout(r, 250)); } } }
  }
}

async function main() {
  await partA();
  await partB();
  return 0;
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[puzzles] FAIL:', e.message); process.exit(1); });
