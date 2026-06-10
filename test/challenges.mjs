#!/usr/bin/env node
/*
 * challenges.mjs — server contract for the "beat the Computer" growth loop.
 *
 * Boots the REAL backend on a throwaway SQLite DB and exercises the public
 * challenge endpoints:
 *   - POST /api/challenges → { id }; elo is clamped; name is required-ish.
 *   - GET  /api/challenges/:id → the challenge (name, elo, meta, plays:0, beats:0);
 *     404 for an unknown id.
 *   - POST /api/challenges/:id/result {beat} → tallies plays/beats (social proof).
 *
 * Run:  node test/challenges.mjs   (exit 0 = PASS)
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[challenges]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
async function waitForHealth(url, t = 15000) { const end = Date.now() + t; while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 200)); } fail('health timeout'); }

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-challenges-${process.pid}-${port}.db`);
  const proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', JWT_SECRET: 'x' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errOut = ''; proc.stderr.on('data', d => { errOut += d; });
  const post = (p, body) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const get = (p) => fetch(`${BASE}${p}`);
  try {
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    // --- create ------------------------------------------------------------
    const created = await (await post('/api/challenges', { challengerName: 'Rick', elo: 1800, meta: { result: 'won', moves: 24 } })).json();
    assert(created && typeof created.id === 'string' && created.id.length >= 6, `create should return an id, got ${JSON.stringify(created)}`);
    log(`POST /api/challenges -> id ${created.id} ✓`);

    // --- fetch -------------------------------------------------------------
    const c = await (await get(`/api/challenges/${created.id}`)).json();
    assert(c.challengerName === 'Rick', `name should round-trip, got ${c.challengerName}`);
    assert(c.elo === 1800, `elo should be 1800, got ${c.elo}`);
    assert(c.kind === 'beat_bot', `kind should be beat_bot, got ${c.kind}`);
    assert(c.meta && c.meta.moves === 24, `meta should round-trip, got ${JSON.stringify(c.meta)}`);
    assert(c.plays === 0 && c.beats === 0, `fresh tally should be 0/0, got ${c.plays}/${c.beats}`);
    log('GET /api/challenges/:id -> name/elo/meta/tally ✓');

    // unknown id -> 404
    assert((await get('/api/challenges/nope_nope')).status === 404, 'unknown challenge id should 404');
    log('unknown id -> 404 ✓');

    // elo clamped (3000 -> 2400 max)
    const hi = await (await post('/api/challenges', { challengerName: 'X', elo: 3000 })).json();
    const hiC = await (await get(`/api/challenges/${hi.id}`)).json();
    assert(hiC.elo === 2400, `elo 3000 should clamp to 2400, got ${hiC.elo}`);
    log('elo clamp (3000 -> 2400) ✓');

    // --- result tally ------------------------------------------------------
    const r1 = await (await post(`/api/challenges/${created.id}/result`, { beat: true })).json();
    assert(r1.plays === 1 && r1.beats === 1, `after a beat: 1/1, got ${r1.plays}/${r1.beats}`);
    const r2 = await (await post(`/api/challenges/${created.id}/result`, { beat: false })).json();
    assert(r2.plays === 2 && r2.beats === 1, `after a loss: 2/1, got ${r2.plays}/${r2.beats}`);
    const after = await (await get(`/api/challenges/${created.id}`)).json();
    assert(after.plays === 2 && after.beats === 1, `persisted tally 2/1, got ${after.plays}/${after.beats}`);
    log('result tally: 2 tried, 1 beat it (social proof) ✓');

    log('PASS — challenge create / fetch / 404 / elo clamp / result tally all correct');
    return 0;
  } catch (e) {
    if (errOut) console.error('server stderr:\n' + errOut.slice(0, 800));
    throw e;
  } finally {
    try { proc.kill(); } catch {}
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} }
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[challenges] FAIL:', e.message); process.exit(1); });
