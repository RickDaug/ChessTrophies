#!/usr/bin/env node
/*
 * guest-funnel.mjs — guards the new-user funnel batch (#1 persistence,
 * #2 winnable first game, #3 universal loss-aversion CTA).
 *
 * Serves the built dist/ with the CSP intact and drives ONE chained flow:
 *   - "Play now" (the hero) creates a guest and drops into practice;
 *   - #2 the first guest game's AI is EASED (elo 800) so a beginner can win;
 *   - resign (a loss) → #3 the signup CTA is STILL shown (was win-only before),
 *     with loss-framed copy;
 *   - the guest's game progress (flags.guestGames) is bumped + persisted;
 *   - #1 a page RELOAD restores the guest straight into the lobby (no auth
 *     screen) with that progress intact — previously a guest vanished on reload.
 *
 * Run:  node test/guest-funnel.mjs    Exit 0 = PASS.
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
const log = (...a) => console.log('[guest-funnel]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

async function main() {
  const b = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stdout, b.stderr); fail('build failed'); }

  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    if (p === '/api/guest') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ username: 'BraveGuest', isGuest: true, activeGuests: 1 })); return; }
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
    page.on('dialog', d => d.accept()); // auto-accept the resign confirm()

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CT && window.CT.state, { timeout: 15000 });

    // --- #2: "Play now" -> guest + eased first game (AI elo 800) --------------
    await page.click('#btn-play-now');
    await page.waitForFunction(() => {
      const s = window.CT.state;
      return s.user && s.user.isGuest && s.opponent && s.opponent.isAI && document.getElementById('screen-game')?.classList.contains('active');
    }, { timeout: 10000 }).catch(() => fail('Play now did not start a guest practice game'));
    const oppElo = await page.evaluate(() => window.CT.state.opponent.elo);
    assert(oppElo === 800, `first guest game AI should be eased to 800, got ${oppElo}`);
    log('#2 Play now -> guest practice vs EASED AI (elo 800) ✓');

    // --- #1: the guest is PERSISTED (localStorage), not session-only ----------
    const persisted = await page.evaluate(() => {
      const db = window.CT.loadDB();
      const u = window.CT.state.user;
      return { inDb: !!(db.users && db.users[u.id]), isGuest: u.isGuest };
    });
    assert(persisted.inDb && persisted.isGuest, 'guest should be saved into the local db.users');
    log('#1 guest persisted to local db.users ✓');

    // --- #3: resign (a LOSS) -> CTA still shown, loss-framed -------------------
    await page.click('#btn-resign');
    await page.waitForSelector('#modal-result.show', { timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => {
      const b = document.getElementById('btn-result-guest-signup');
      return b && b.style.display !== 'none';
    }, { timeout: 8000 }).catch(() => fail('signup CTA was NOT shown after a guest LOSS (the #3 fix)'));
    const cta = await page.evaluate(() => document.getElementById('btn-result-guest-signup').textContent);
    assert(/create a free account/i.test(cta), `CTA copy should invite signup, got "${cta}"`);
    assert(!/save your win/i.test(cta), `a LOSS should not say "save your win", got "${cta}"`);
    log(`#3 signup CTA shown after a LOSS, loss-framed copy ("${cta}") ✓`);

    // progress bumped + persisted
    const games = await page.evaluate(() => (window.CT.state.user.flags || {}).guestGames || 0);
    assert(games === 1, `guestGames should be 1 after one game, got ${games}`);

    // --- #1: RELOAD -> restored straight into the lobby with progress ---------
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CT && window.CT.state && window.CT.state.user, { timeout: 15000 })
      .catch(() => fail('guest was NOT restored after reload (the #1 fix)'));
    const after = await page.evaluate(() => ({
      isGuest: !!window.CT.state.user.isGuest,
      games: (window.CT.state.user.flags || {}).guestGames || 0,
      lobby: document.getElementById('screen-lobby')?.classList.contains('active'),
      auth: document.getElementById('screen-auth')?.classList.contains('active'),
    }));
    assert(after.isGuest, 'reload should restore the GUEST');
    assert(after.games === 1, `restored guest should keep progress (guestGames=1), got ${after.games}`);
    assert(after.lobby && !after.auth, 'restored guest should land in the lobby, not the auth screen');
    log('#1 reload restores the guest into the lobby WITH progress (no auth screen) ✓');

    assert(errors.length === 0, 'page errors:\n' + errors.join('\n'));
    log('PASS — guest persistence + winnable first game + universal loss-aversion CTA');
  } finally {
    await browser.close();
    srv.close();
  }
}
main().catch((e) => { console.error('[guest-funnel] FAIL —', e.message); process.exit(1); });
