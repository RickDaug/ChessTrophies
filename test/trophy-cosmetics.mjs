#!/usr/bin/env node
/*
 * trophy-cosmetics.mjs — verifies trophy-tied cosmetic (board/piece set) unlocks:
 *   1) CT_Sets.setTrophyUnlocks maps earned achievement ids -> unlocked set slugs,
 *      and reports only the NEWLY-unlocked slugs on each call;
 *   2) enforcePremium(false) KEEPS a trophy-unlocked set equipped but REVERTS a
 *      premium-only set (the lapsed-member gate, minus the earned sets);
 *   3) CT_Sets.unlockForAchievement reverse-maps a trophy -> its reward set;
 *   4) the Store shows an "Equip" action for an unlocked set to a NON-premium user,
 *      and "Preview" for a still-locked premium-only set.
 *
 * Run:   node test/trophy-cosmetics.mjs   (needs Playwright Chromium). Exit 0 = PASS.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.css':'text/css' };
const log = (...a) => console.log('[trophy-cosmetics]', ...a);
const fail = (msg) => { throw new Error(msg); };
const assert = (cond, msg) => { if (!cond) fail(msg); };

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
      if (u.origin === BASE && u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      if (u.origin === BASE) return route.continue();
      if (/socket\.io/.test(u.href)) return route.fulfill({ contentType: 'application/javascript', body: 'window.io=function(){return {on(){},emit(){},close(){}}};' });
      return route.fulfill({ status: 200, body: '' });
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CT_Sets && window.CT_Sets.setTrophyUnlocks && window.CT_Shop, { timeout: 15000 })
      .catch(() => fail('client did not expose CT_Sets.setTrophyUnlocks / CT_Shop'));
    log('client loaded; cosmetics API present');

    const r = await page.evaluate(async () => {
      const S = window.CT_Sets;
      const out = {};

      // 1) Earned trophy -> unlocked slug, newly-only reporting.
      const newly1 = S.setTrophyUnlocks(['gauntlet_t4']);
      out.newly1 = newly1;
      out.dragonsUnlocked = S.isTrophyUnlocked('dragons-slayers');
      out.robotsLocked = !S.isTrophyUnlocked('robots-cyborgs');
      const newly2 = S.setTrophyUnlocks(['gauntlet_t4']); // same set again
      out.newly2 = newly2; // should be []

      // 3) Reverse map.
      const rev = S.unlockForAchievement('gauntlet_t4');
      out.reverse = rev && rev.slug;

      // 2a) enforcePremium KEEPS an unlocked set equipped.
      await S.equip('dragons-slayers');
      S.enforcePremium(false);
      out.keptUnlocked = S.activeSlug();

      // 2b) enforcePremium REVERTS a premium-only set for a non-subscriber.
      S.setTrophyUnlocks([]); // nothing unlocked now
      await S.equip('pirates-navy');
      S.enforcePremium(false);
      out.revertedPremiumOnly = S.activeSlug(); // expect null

      return out;
    });

    assert(JSON.stringify(r.newly1) === '["dragons-slayers"]', `gauntlet_t4 should unlock dragons-slayers, got ${JSON.stringify(r.newly1)}`);
    assert(r.dragonsUnlocked === true, 'dragons-slayers should be unlocked');
    assert(r.robotsLocked === true, 'robots-cyborgs should still be locked');
    assert(Array.isArray(r.newly2) && r.newly2.length === 0, `re-applying the same earned id should report no NEW unlocks, got ${JSON.stringify(r.newly2)}`);
    log('unlock mapping: trophy -> set, newly-only reporting ✓');

    assert(r.reverse === 'dragons-slayers', `unlockForAchievement(gauntlet_t4) should be dragons-slayers, got ${r.reverse}`);
    log('reverse map: trophy -> reward set ✓');

    assert(r.keptUnlocked === 'dragons-slayers', `enforcePremium must KEEP a trophy-unlocked set, got ${r.keptUnlocked}`);
    assert(r.revertedPremiumOnly === null, `enforcePremium must REVERT a premium-only set for a non-subscriber, got ${r.revertedPremiumOnly}`);
    log('premium gate: keeps earned sets, reverts premium-only ✓');

    // 4) Store UI for a NON-premium user with the unlock earned.
    const ui = await page.evaluate(() => {
      window.CT_Sets.equip(null); // reset to classic
      window.CT.setUser({ username: 'Tester', isPremium: false, streakTrophies: [], achievements: [{ id: 'gauntlet_t4', count: 1 }], flags: {}, wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0, elo: 1200 });
      window.CT_applyTrophyUnlocks({ silent: true });
      window.CT_Shop.open();
      const eq = document.querySelector('#ct-shop-grid [data-slug="dragons-slayers"]');
      const pv = document.querySelector('#ct-shop-grid [data-slug="pirates-navy"]');
      return {
        unlockedAct: eq && eq.getAttribute('data-shop-act'),
        lockedAct: pv && pv.getAttribute('data-shop-act'),
        headHasTrophy: /trophies/i.test((document.querySelector('#screen-store .screen-body') || document.querySelector('#screen-store') || {}).innerHTML || '')
      };
    });
    assert(ui.unlockedAct === 'equip', `non-premium user should be able to EQUIP an unlocked set, got ${ui.unlockedAct}`);
    assert(ui.lockedAct === 'preview', `non-premium user should only PREVIEW a premium-only set, got ${ui.lockedAct}`);
    assert(ui.headHasTrophy, 'store header should mention trophy unlocks');
    log('store UI: equip for earned set, preview for premium-only, header explains unlocks ✓');

    assert(errs.length === 0, `page errors during run: ${errs.join(' | ')}`);
    log('PASS — trophy-tied cosmetic unlocks behave as specified');
    return 0;
  } finally {
    try { await browser.close(); } catch {}
    try { await new Promise(r => srv.close(r)); } catch {}
  }
}

main().then(code => process.exit(code ?? 0)).catch(err => { console.error('[trophy-cosmetics] FAIL:', err.message); process.exit(1); });
