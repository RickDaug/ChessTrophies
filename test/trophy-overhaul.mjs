#!/usr/bin/env node
/*
 * trophy-overhaul.mjs — verifies the trophy-overhaul additions:
 *   1) new milestone trophy types award via checkAchievementsFor:
 *        - arena      (user.arenaWins)
 *        - gauntlet   (user.flags.gauntlet.beaten + 1 rungs cleared)
 *        - openings   (count of user.flags.openings[*].mastery >= 100)
 *        - puzzles    (user.flags.puzzlesSolved, evaluated via the 'flag' case)
 *   2) these are ONE-TIME milestones — they don't double-award;
 *   3) window.CT_trophyArt(def, unlocked) returns a themed <svg> string;
 *   4) the redesigned trophy screen renders its hero + filter chips without error.
 *
 * Run:   node test/trophy-overhaul.mjs   (needs Playwright Chromium). Exit 0 = PASS.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.css':'text/css' };
const log = (...a) => console.log('[trophy-overhaul]', ...a);
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
    await page.waitForFunction(() => window.CT && window.CT.checkAchievementsFor && window.CT.achievementCount && window.CT_trophyArt, { timeout: 15000 })
      .catch(() => fail('client did not expose window.CT.* / window.CT_trophyArt'));
    log('client loaded; trophy API + art present');

    const r = await page.evaluate(() => {
      const CT = window.CT;
      const fresh = () => ({ achievements: [], flags: {}, wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0 });
      const out = {};

      // 1) Arena championships -> arena_t1 once.
      let u = fresh(); u.arenaWins = 1;
      CT.checkAchievementsFor(u, {});
      out.arena = { afterFirst: CT.achievementCount(u, 'arena_t1') };
      u.arenaWins = 2; CT.checkAchievementsFor(u, {});
      out.arena.afterSecond = CT.achievementCount(u, 'arena_t1'); // still 1 (one-time)

      // 2) Gauntlet rungs: beaten:0 => 1 rung cleared => gauntlet_t1.
      u = fresh(); u.flags.gauntlet = { beaten: 0 };
      CT.checkAchievementsFor(u, {});
      out.gauntlet = { t1: CT.achievementCount(u, 'gauntlet_t1'), t2: CT.achievementCount(u, 'gauntlet_t2') };
      u.flags.gauntlet.beaten = 2; CT.checkAchievementsFor(u, {}); // 3 cleared
      out.gauntlet.t2after = CT.achievementCount(u, 'gauntlet_t2');

      // 3) Openings mastered (mastery>=100) -> open_t1.
      u = fresh(); u.flags.openings = { italian: { mastery: 100 }, ruy: { mastery: 60 } };
      CT.checkAchievementsFor(u, {});
      out.openings = { mastered1: CT.achievementCount(u, 'open_t1'), t2: CT.achievementCount(u, 'open_t2') };

      // 4) Puzzles solved (flag) -> puz_t1.
      u = fresh(); u.flags.puzzlesSolved = 1;
      CT.checkAchievementsFor(u, {});
      out.puzzles = { first: CT.achievementCount(u, 'puz_t1') };

      // 5) Art helper returns a themed <svg>.
      const def = (window.CT_ACHIEVEMENT_TIERS || []).find(t => t.id === 'arena_t1');
      out.art = window.CT_trophyArt(def, true);
      return out;
    });

    assert(r.arena.afterFirst === 1, `arena_t1 should award once, got ${r.arena.afterFirst}`);
    assert(r.arena.afterSecond === 1, `arena_t1 must not double-award, got ${r.arena.afterSecond}`);
    log('arena trophy: awards on arenaWins, one-time ✓');

    assert(r.gauntlet.t1 === 1, `gauntlet_t1 should award at 1 rung, got ${r.gauntlet.t1}`);
    assert(r.gauntlet.t2 === 0, `gauntlet_t2 should NOT award at 1 rung, got ${r.gauntlet.t2}`);
    assert(r.gauntlet.t2after === 1, `gauntlet_t2 should award at 3 rungs, got ${r.gauntlet.t2after}`);
    log('gauntlet trophy: tracks rungs cleared ✓');

    assert(r.openings.mastered1 === 1, `open_t1 should award at 1 mastered, got ${r.openings.mastered1}`);
    assert(r.openings.t2 === 0, `open_t2 should NOT award at 1 mastered, got ${r.openings.t2}`);
    log('openings trophy: counts only mastery>=100 ✓');

    assert(r.puzzles.first === 1, `puz_t1 should award on first solve, got ${r.puzzles.first}`);
    log('puzzles trophy: awards via puzzlesSolved flag ✓');

    assert(/^<svg[\s\S]*<\/svg>$/.test(r.art.trim()), 'CT_trophyArt should return an <svg> string');
    assert(/circle/.test(r.art) && /path/.test(r.art), 'CT_trophyArt svg should contain a medallion + glyph');
    log('trophy art: returns themed <svg> medallion ✓');

    // 6) Trophy screen renders hero + filter chips (UI smoke). Seed a minimal
    //    user so the render is deterministic regardless of auth state.
    await page.evaluate(() => {
      window.CT.setUser({ username: 'Tester', streakTrophies: [], achievements: [], flags: {}, wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0, elo: 1200 });
      window.CT.showScreen('trophies');
    });
    await page.waitForTimeout(150); // let the rAF-deferred render run
    const ui = await page.evaluate(() => ({
      hero: (document.querySelector('#trophy-hero') || {}).innerHTML || '',
      chips: document.querySelectorAll('#trophy-filters .tchip').length,
      ring: !!document.querySelector('#trophy-hero .trophy-ring')
    }));
    assert(ui.chips >= 4, `expected >=4 filter chips, got ${ui.chips}`);
    assert(ui.ring, 'expected a completeness ring in the hero');
    assert(/trophy points/.test(ui.hero), 'hero should show trophy points');
    log('trophy screen: hero ring + filter chips render ✓');

    assert(errs.length === 0, `page errors during run: ${errs.join(' | ')}`);
    log('PASS — trophy overhaul engine + art + UI behave as specified');
    return 0;
  } finally {
    try { await browser.close(); } catch {}
    try { await new Promise(r => srv.close(r)); } catch {}
  }
}

main().then(code => process.exit(code ?? 0)).catch(err => { console.error('[trophy-overhaul] FAIL:', err.message); process.exit(1); });
