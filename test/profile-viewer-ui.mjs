#!/usr/bin/env node
/*
 * profile-viewer-ui.mjs — verifies the public profile VIEWER (client):
 *   1) openUserProfile(otherId) fetches the profile and renders the modal with
 *      the player's stats + their pinned showcase medallions (SVG);
 *   2) openUserProfile(myOwnId) routes to the editable profile screen instead of
 *      opening the viewer modal.
 *
 * Run: node test/profile-viewer-ui.mjs  (needs Playwright Chromium). Exit 0 = PASS.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.css':'text/css' };
const log = (...a) => console.log('[profile-viewer]', ...a);
const fail = (msg) => { throw new Error(msg); };
const assert = (cond, msg) => { if (!cond) fail(msg); };

const PROFILE = {
  id: 'other1', username: 'Rival', region: 'Spain',
  elo: 1675, wins: 40, losses: 20, draws: 5, bestStreak: 8,
  isPremium: true, avatarStock: 'av_knight', avatarDataUrl: '',
  arenaWins: 3, trophyPoints: 420, trophyCount: 12, streakTrophyCount: 1,
  achievements: [{ id: 'wins_t3', count: 1 }],
  showcase: ['wins_t3', 'gauntlet_t4', 'arena_t2'],
};

async function main() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return; }
    fs.readFile(file, (e, d) => {
      if (e) { res.writeHead(404); res.end('nf'); return; }
      if (p === '/index.html') d = Buffer.from(String(d).replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/, ''));
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d);
    });
  });
  const port = await new Promise(r => srv.listen(0, () => r(srv.address().port)));
  const BASE = `http://localhost:${port}`;
  log(`client served at ${BASE}`);

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.origin === BASE && /\/api\/users\/[^/]+\/profile$/.test(u.pathname)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILE) });
      }
      if (u.origin === BASE && u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      if (u.origin === BASE) return route.continue();
      if (/socket\.io/.test(u.href)) return route.fulfill({ contentType: 'application/javascript', body: 'window.io=function(){return {on(){},emit(){},close(){}}};' });
      return route.fulfill({ status: 200, body: '' });
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CT_openUserProfile && window.CT && window.CT.setUser, { timeout: 15000 })
      .catch(() => fail('client did not expose CT_openUserProfile / CT.setUser'));
    await page.evaluate(() => window.CT.setUser({ id: 'me1', username: 'Me', email: 'm@m.m', region: 'X', elo: 1300, wins: 1, losses: 0, draws: 0, currentStreak: 0, bestStreak: 1, achievements: [], streakTrophies: [], flags: {}, showcase: [] }));
    log('client loaded');

    // 1) View another player's profile.
    await page.evaluate(() => window.CT_openUserProfile('other1'));
    await page.waitForFunction(() => /Rival/.test((document.querySelector('#user-profile-body') || {}).innerHTML || ''), { timeout: 5000 })
      .catch(() => fail('profile modal did not render the other player'));
    const view = await page.evaluate(() => {
      const b = document.querySelector('#user-profile-body');
      return {
        html: b ? b.innerHTML : '',
        items: document.querySelectorAll('#user-profile-body .showcase-item').length,
        svgs: document.querySelectorAll('#user-profile-body .showcase-item svg').length,
      };
    });
    assert(/Rival/.test(view.html), 'renders the username');
    assert(/1675/.test(view.html) && /ELO/.test(view.html), 'renders stats (ELO)');
    assert(/420 pts/.test(view.html), 'renders trophy points');
    assert(view.items === 3, `renders 3 showcase medallions (got ${view.items})`);
    assert(view.svgs === 3, `showcase medallions are SVG art (got ${view.svgs})`);
    assert(!/m@m\.m/.test(view.html), 'does not render any email');
    log('view other: stats + showcase medallions render ✓');

    // 2) Own id routes to the editable profile screen, not the viewer modal.
    await page.evaluate(() => { document.querySelector('#user-profile-body').innerHTML = ''; window.CT_openUserProfile('me1'); });
    await page.waitForTimeout(80);
    const selfRouted = await page.evaluate(() => ({
      onProfile: document.querySelector('#screen-profile').classList.contains('active'),
      modalEmpty: !/Rival/.test((document.querySelector('#user-profile-body') || {}).innerHTML || ''),
    }));
    assert(selfRouted.onProfile, 'own id routes to the profile screen');
    assert(selfRouted.modalEmpty, 'own id does not open the viewer modal');
    log('self routing: own id -> editable profile ✓');

    assert(errs.length === 0, `page errors during run: ${errs.join(' | ')}`);
    log('PASS — public profile viewer renders other players + routes self correctly');
    return 0;
  } finally {
    try { await browser.close(); } catch {}
    try { await new Promise(r => srv.close(r)); } catch {}
  }
}

main().then(code => process.exit(code ?? 0)).catch(err => { console.error('[profile-viewer] FAIL:', err.message); process.exit(1); });
