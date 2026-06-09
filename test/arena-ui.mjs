#!/usr/bin/env node
/*
 * arena-ui.mjs — Layer 3 (client) gate for arena tournaments.
 *
 * Serves the built dist/ WITH the CSP intact (like build-smoke) but STUBS
 * /api/arena/current + /:id/standing with a crafted live arena, then drives the
 * UI in Playwright and asserts:
 *   - the lobby shows the live arena card (name + "Live now");
 *   - clicking it opens #screen-arena;
 *   - the live leaderboard renders the stubbed players in order (with the 🔥
 *     streak marker), the countdown shows "Ends in …", and the Join control is
 *     present — all CSP-safe (0 script-src violations / page errors).
 *
 * The realtime join→bot-backfill→play→score→re-pool loop is covered end-to-end
 * server-side by test/arena-realtime.mjs; this guards the client rendering.
 *
 * Run:  node test/arena-ui.mjs    Exit 0 = PASS.
 */
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.css':'text/css' };
const log = (...a) => console.log('[arena-ui]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

const NOW = Date.now();
const ARENA = {
  enabled: true,
  live: {
    id: 'arena_test1', name: 'Blitz Arena', tc: '3+2',
    startsAt: NOW - 5 * 60000, endsAt: NOW + 18 * 60000, status: 'live', championId: null, players: 3,
    top: [
      { rank: 1, userId: 'u1', username: 'Reaper', points: 11, games: 5, wins: 5, draws: 0, losses: 0, streak: 5, onFire: true },
      { rank: 2, userId: 'u2', username: 'Nimzo', points: 7, games: 5, wins: 3, draws: 1, losses: 1, streak: 0, onFire: false },
      { rank: 3, userId: 'u3', username: 'Computer 🤖', points: 4, games: 4, wins: 2, draws: 0, losses: 2, streak: 1, onFire: false },
    ],
  },
  next: null,
};

async function main() {
  const b = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stdout, b.stderr); fail('build failed'); }
  assert(fs.existsSync(path.join(DIST, 'ct-arena.js')), 'dist/ct-arena.js missing after build');

  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    if (p === '/api/arena/current') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(ARENA)); return; }
    if (/^\/api\/arena\/[^/]+\/standing$/.test(p)) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ joined: false, standing: null })); return; }
    if (p === '/api/guest') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ username: 'GuestTest', isGuest: true, activeGuests: 1 })); return; }
    if (p.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
    const file = path.join(DIST, p);
    if (!file.startsWith(DIST)) { res.writeHead(403); res.end('no'); return; }
    fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
  });
  const port = await new Promise(r => srv.listen(0, () => r(srv.address().port)));
  const BASE = `http://localhost:${port}`;

  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext();
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.origin === BASE) return route.continue();
      if (/socket\.io/.test(u.href)) return route.fulfill({ contentType: 'application/javascript', body: 'window.io=function(){return {on(){},emit(){},close(){},io:{on(){}}}};' });
      return route.fulfill({ status: 200, body: '' });
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e));
    page.on('console', m => { if (m.type() === 'error' && /Refused to/i.test(m.text())) errors.push('csp: ' + m.text()); });
    await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective)); });

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CT && window.CT_Arena, { timeout: 15000 });
    await page.click('#btn-continue-guest');
    await page.waitForFunction(() => document.getElementById('screen-lobby')?.classList.contains('active'), { timeout: 10000 });

    // 1) Lobby arena card appears (renderLobbyCard fetched the live arena).
    await page.waitForFunction(() => {
      const c = document.getElementById('lobby-arena-card');
      return c && c.style.display !== 'none' && /Blitz Arena/.test(document.getElementById('lobby-arena-title')?.textContent || '');
    }, { timeout: 8000 }).catch(() => fail('lobby arena card did not show the live arena'));
    log('lobby arena card shows the live arena ✓');

    // 2) Click it -> arena screen.
    await page.click('#lobby-arena-card');
    await page.waitForSelector('#screen-arena.active', { timeout: 5000 });
    await page.waitForFunction(() => document.querySelectorAll('#arena-list .card').length >= 3, { timeout: 6000 })
      .catch(() => fail('arena leaderboard did not render the stubbed players'));

    const ui = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#arena-list .card')].map(r => r.textContent);
      return {
        name: document.getElementById('arena-name')?.textContent,
        countdown: document.getElementById('arena-countdown')?.textContent,
        rows,
        joinBtn: document.getElementById('btn-arena-join')?.textContent,
        csp: (window.__csp || []).filter(d => /script-src/i.test(d)),
      };
    });
    assert(/Blitz Arena/.test(ui.name), 'arena banner name wrong');
    assert(/Ends in/.test(ui.countdown), `countdown should show "Ends in …", got "${ui.countdown}"`);
    assert(ui.rows.length >= 3, 'leaderboard rows missing');
    assert(/Reaper/.test(ui.rows[0]) && /11/.test(ui.rows[0]) && /🔥/.test(ui.rows[0]), 'rank 1 (Reaper, 11pts, 🔥) not rendered correctly');
    assert(/Nimzo/.test(ui.rows[1]), 'rank 2 (Nimzo) missing');
    assert(/Join arena/i.test(ui.joinBtn || ''), `Join control missing, got "${ui.joinBtn}"`);
    assert(ui.csp.length === 0, 'script-src CSP violations: ' + JSON.stringify(ui.csp));
    assert(errors.length === 0, 'page errors:\n' + errors.join('\n'));
    log(`arena screen: banner + "Ends in …" + 3-row leaderboard (🔥 on the streak leader) + Join ✓`);

    log('PASS — arena client UI: lobby card, arena screen, live leaderboard, countdown, CSP-clean');
  } finally {
    await browser.close();
    srv.close();
  }
}
main().catch((e) => { console.error('[arena-ui] FAIL —', e.message); process.exit(1); });
