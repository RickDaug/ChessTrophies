#!/usr/bin/env node
/*
 * analytics.mjs — end-to-end test for the product-analytics layer.
 *
 * Boots the REAL backend on a throwaway SQLite DB, fires a funnel of /api/events
 * for several anonymous visitors, and verifies:
 *   - validation: a non-allowlisted name and a missing visitorId both 400;
 *   - the admin /api/admin/stats `analytics` block aggregates correctly —
 *     distinct-visitor funnel [land,play_start,play_finish,signup_cta_view,signup],
 *     today's snapshot, the 14-day daily series, and topEvents.
 *
 * Run:  node test/analytics.mjs   (exit 0 = PASS)
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const ADMIN_KEY = 'test-admin-key-analytics';
const log = (...a) => console.log('[analytics]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
async function waitForHealth(url, t = 15000) { const end = Date.now() + t; while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 200)); } fail('health timeout'); }

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-analytics-${process.pid}-${port}.db`);
  const proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', JWT_SECRET: 'x', ADMIN_KEY }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errOut = ''; proc.stderr.on('data', d => { errOut += d; });
  const ev = (name, visitorId, extra) => fetch(`${BASE}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, visitorId, ...(extra || {}) }) });
  try {
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    // --- validation ---------------------------------------------------------
    assert((await ev('not_a_real_event', 'v1')).status === 400, 'a non-allowlisted event name must 400');
    assert((await fetch(`${BASE}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'land' }) })).status === 400, 'a missing visitorId must 400');
    log('validation: bad name + missing visitorId both 400 ✓');

    // --- funnel: 3 visitors land, 2 play, 1 goes all the way -----------------
    for (const v of ['va', 'vb', 'vc']) assert((await ev('land', v)).ok, 'land should accept');
    for (const v of ['va', 'vb']) assert((await ev('play_start', v, { meta: { mode: 'practice' } })).ok, 'play_start should accept');
    assert((await ev('play_finish', 'va', { meta: { mode: 'practice', result: 'win' } })).ok, 'play_finish');
    assert((await ev('signup_cta_view', 'va')).ok, 'signup_cta_view');
    assert((await ev('signup', 'va', { userId: 'u1' })).ok, 'signup');
    log('fired funnel events for 3 visitors ✓');

    // --- aggregation via /api/admin/stats -----------------------------------
    const s = await (await fetch(`${BASE}/api/admin/stats`, { headers: { 'x-admin-key': ADMIN_KEY } })).json();
    assert(s && s.analytics, '/api/admin/stats should include an analytics block');
    const a = s.analytics;
    const byKey = {}; (a.funnel || []).forEach(f => { byKey[f.key] = f.visitors; });
    assert(byKey.land === 3, `funnel land should be 3 distinct visitors, got ${byKey.land}`);
    assert(byKey.play_start === 2, `funnel play_start should be 2, got ${byKey.play_start}`);
    assert(byKey.play_finish === 1, `funnel play_finish should be 1, got ${byKey.play_finish}`);
    assert(byKey.signup_cta_view === 1, `funnel signup_cta_view should be 1, got ${byKey.signup_cta_view}`);
    assert(byKey.signup === 1, `funnel signup should be 1, got ${byKey.signup}`);
    log(`funnel: land=3 play=2 finish=1 cta=1 signup=1 ✓`);

    assert(a.today && a.today.visitors === 3, `today.visitors should be 3, got ${a.today && a.today.visitors}`);
    assert(a.today.plays === 2, `today.plays should be 2, got ${a.today.plays}`);
    assert(a.today.signups === 1, `today.signups should be 1, got ${a.today.signups}`);
    log(`today: visitors=3 plays=2 signups=1 ✓`);

    // The daily series now scales with the window (default 30 days, capped 60),
    // so the date-range presets render a matching chart length.
    assert(Array.isArray(a.daily) && a.daily.length === 30, `daily should be a 30-day series (default window), got ${a.daily && a.daily.length}`);
    assert(a.windowDays === 30, `default windowDays should be 30, got ${a.windowDays}`);
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayRow = a.daily.find(d => d.date === todayKey);
    assert(todayRow && todayRow.visitors === 3, `today's daily row should show 3 visitors, got ${JSON.stringify(todayRow)}`);
    log('daily: 30-day series (scales with window), today populated ✓');

    const land = (a.topEvents || []).find(e => e.name === 'land');
    assert(land && land.count === 3, `topEvents should include land:3, got ${JSON.stringify(land)}`);
    log('topEvents: land=3 ✓');

    log('PASS — events validate + the analytics funnel/today/daily/topEvents aggregate correctly');
    return 0;
  } catch (e) {
    if (errOut) console.error('server stderr:\n' + errOut.slice(0, 800));
    throw e;
  } finally {
    try { proc.kill(); } catch {}
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} }
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[analytics] FAIL:', e.message); process.exit(1); });
