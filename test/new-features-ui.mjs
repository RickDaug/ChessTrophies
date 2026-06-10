#!/usr/bin/env node
/*
 * new-features-ui.mjs — client integration smoke for the three new features:
 * Bot Gauntlet, Opening Trainer, Friend Leagues. Confirms each screen mounts,
 * renders, and (for the Gauntlet) actually starts a game — i.e. the hand-wired
 * app.js/index.html glue works in the browser. CSP-clean, zero page errors.
 *
 * Run:  node test/new-features-ui.mjs   Exit 0 = PASS.
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
const log = (...a) => console.log('[new-ui]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

async function main() {
  const b = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stdout, b.stderr); fail('build failed'); }

  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    if (p === '/api/guest') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ username: 'GuestTester', isGuest: true })); return; }
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

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CT && window.CT.state && window.CT_Gauntlet && window.CT_Openings && window.CT_Leagues, { timeout: 15000 })
      .catch(() => fail('one of the new modules (CT_Gauntlet/CT_Openings/CT_Leagues) did not load'));
    await page.click('#btn-continue-guest');
    await page.waitForFunction(() => document.getElementById('screen-lobby')?.classList.contains('active'), { timeout: 10000 });
    log('modules loaded; guest in lobby ✓');

    // Lobby cards: gauntlet + openings visible for a guest; leagues hidden (auth-only).
    const cards = await page.evaluate(() => ({
      gauntlet: getComputedStyle(document.getElementById('lobby-gauntlet-card')).display,
      openings: getComputedStyle(document.getElementById('lobby-openings-card')).display,
      leagues: getComputedStyle(document.getElementById('lobby-leagues-card')).display,
    }));
    assert(cards.gauntlet !== 'none', 'gauntlet lobby card should show');
    assert(cards.openings !== 'none', 'openings lobby card should show');
    assert(cards.leagues === 'none', 'leagues lobby card should be hidden for a guest');
    log('lobby cards: gauntlet + openings shown, leagues hidden for guest ✓');

    // --- OPENINGS: open -> the opening list renders (do navigation BEFORE
    //     starting any game, since showScreen guards against leaving a live game).
    await page.evaluate(() => window.CT.showScreen('openings'));
    await page.waitForSelector('#screen-openings.active', { timeout: 5000 });
    await page.waitForFunction(() => {
      const body = document.querySelector('#screen-openings .screen-body') || document.getElementById('openings-body');
      return body && body.textContent && body.textContent.trim().length > 20;
    }, { timeout: 6000 }).catch(() => fail('opening trainer did not render its list'));
    const openText = await page.evaluate(() => (document.querySelector('#screen-openings .screen-body') || document.getElementById('openings-body')).textContent);
    assert(/Italian|Sicilian|London|Ruy|French|Caro|Queen/i.test(openText), `openings list should name real openings, got "${openText.slice(0,80)}"`);
    log('openings: trainer screen renders the opening list ✓');

    // --- LEAGUES (guest): open -> "sign in" prompt, no crash -----------------
    await page.evaluate(() => window.CT.showScreen('leagues'));
    await page.waitForSelector('#screen-leagues.active', { timeout: 5000 });
    const leagueText = await page.evaluate(() => document.getElementById('leagues-body').textContent || '');
    assert(/sign in/i.test(leagueText), `leagues (guest) should prompt sign-in, got "${leagueText.slice(0,80)}"`);
    log('leagues: guest sees the sign-in prompt (no crash) ✓');

    // --- GAUNTLET (last — it leaves us in a game): open -> Challenge starts it -
    await page.evaluate(() => window.CT.showScreen('lobby'));
    await page.waitForSelector('#screen-lobby.active', { timeout: 5000 });
    await page.click('#lobby-gauntlet-card');
    await page.waitForSelector('#screen-gauntlet.active', { timeout: 5000 });
    // Fresh ladder: every rung paints, but only the NEXT (rung 0) is a clickable
    // "Challenge" button (locked rungs have no button).
    await page.waitForFunction(() => document.querySelector('#gauntlet-list [data-rung="0"]'), { timeout: 5000 })
      .catch(() => fail('gauntlet ladder did not render the next-challenge button'));
    await page.click('#gauntlet-list [data-rung="0"]');
    await page.waitForFunction(() => {
      const s = window.CT.state;
      return s.opponent && s.opponent.isAI && s._gauntlet && document.getElementById('screen-game')?.classList.contains('active');
    }, { timeout: 8000 }).catch(() => fail('Gauntlet "Challenge" did not start a game'));
    const g = await page.evaluate(() => ({ name: window.CT.state.opponent.username, rung: window.CT.state._gauntlet.rung, elo: window.CT.state.opponent.elo }));
    assert(g.rung === 0 && /[A-Za-z]/.test(g.name) && g.elo > 0, `gauntlet game vs rung 0 expected, got ${JSON.stringify(g)}`);
    log(`gauntlet: ladder renders + "Challenge ${g.name}" (elo ${g.elo}) started a game ✓`);

    const realErrors = errors.filter(e => !/favicon|net::ERR/i.test(e));
    assert(realErrors.length === 0, 'page errors:\n' + realErrors.join('\n'));
    log('PASS — Gauntlet, Opening Trainer, and Friend Leagues all mount, render, and wire up');
  } finally {
    await browser.close();
    srv.close();
  }
}
main().catch((e) => { console.error('[new-ui] FAIL —', e.message); process.exit(1); });
