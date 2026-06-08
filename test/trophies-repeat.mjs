#!/usr/bin/env node
/*
 * trophies-repeat.mjs — verifies the repeatable-trophy + earned-counter logic.
 *
 * Boots the real client and exercises window.CT.checkAchievementsFor /
 * achievementCount directly (no backend needed) to prove:
 *   1) one-time milestones (e.g. "win 1 ranked game") award once and stay at
 *      count 1 even when the condition keeps being true;
 *   2) streak trophies re-earn — each fresh run to the threshold bumps the count
 *      (the user's "lose, then win 3 again" case);
 *   3) repeatable awards only count on the FINAL post-game pass (ctx.finalize),
 *      so the two-phase chess result flow can't double-count one game;
 *   4) single-game feat flags (e.g. underpromotion) count once per occurrence;
 *   5) legacy saved trophies (no `count` field) are treated as 1 and keep
 *      counting from there.
 *
 * Run:   npm run test:trophies-repeat   (after adding the script) or
 *        node test/trophies-repeat.mjs
 * Needs: Playwright's Chromium. Exit 0 = PASS.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.css':'text/css' };
const log = (...a) => console.log('[trophies-repeat]', ...a);
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
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CT && window.CT.checkAchievementsFor && window.CT.achievementCount, { timeout: 15000 })
      .catch(() => fail('client did not expose window.CT.checkAchievementsFor / achievementCount'));
    log('client loaded; trophy API present');

    const r = await page.evaluate(() => {
      const CT = window.CT;
      const fresh = () => ({ achievements: [], flags: {}, wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0 });
      const out = {};

      // 1) One-time milestone: win 1 ranked game -> wins_t1 once, never twice.
      let u = fresh();
      u.wins = 1; CT.checkAchievementsFor(u, { justWon: true, finalize: true });
      const oneAfterFirst = CT.achievementCount(u, 'wins_t1');
      u.wins = 2; CT.checkAchievementsFor(u, { justWon: true, finalize: true });
      out.oneTime = { afterFirst: oneAfterFirst, afterSecond: CT.achievementCount(u, 'wins_t1') };

      // 2) Repeatable streak: hit 3 -> count 1; reset; hit 3 again -> count 2.
      u = fresh();
      u.currentStreak = 3; CT.checkAchievementsFor(u, { justWon: true, finalize: true });
      const streakAfter1 = CT.achievementCount(u, 'streak_t1');
      u.currentStreak = 0; CT.checkAchievementsFor(u, { justWon: false, finalize: true }); // a loss
      u.currentStreak = 1; CT.checkAchievementsFor(u, { justWon: true, finalize: true });
      u.currentStreak = 2; CT.checkAchievementsFor(u, { justWon: true, finalize: true });
      u.currentStreak = 3; CT.checkAchievementsFor(u, { justWon: true, finalize: true });
      out.streak = { afterFirst: streakAfter1, afterSecondRun: CT.achievementCount(u, 'streak_t1') };

      // 3) finalize guard: a non-finalize pass must NOT count a repeat.
      u = fresh();
      u.currentStreak = 3;
      CT.checkAchievementsFor(u, { justWon: true });                 // first pass, no finalize
      const noFinalize = CT.achievementCount(u, 'streak_t1');
      CT.checkAchievementsFor(u, { justWon: true, finalize: true }); // final pass
      out.finalizeGuard = { noFinalize, withFinalize: CT.achievementCount(u, 'streak_t1') };

      // 4) Single-game feat flag: counter mirrors number of occurrences.
      u = fresh();
      u.flags.underpromoWins = 1; CT.checkAchievementsFor(u, { justWon: true, finalize: true });
      const featAfter1 = CT.achievementCount(u, 'hidden_underpromo');
      u.flags.underpromoWins = 2; CT.checkAchievementsFor(u, { justWon: true, finalize: true });
      out.feat = { afterFirst: featAfter1, afterSecond: CT.achievementCount(u, 'hidden_underpromo') };

      // 5) Legacy entry (no count) reads as 1, then keeps counting.
      u = fresh();
      u.achievements = [{ id: 'streak_t1', awardedAt: 1 }]; // pre-counter save
      const legacyRead = CT.achievementCount(u, 'streak_t1');
      u.currentStreak = 3; CT.checkAchievementsFor(u, { justWon: true, finalize: true });
      out.legacy = { read: legacyRead, afterReearn: CT.achievementCount(u, 'streak_t1') };

      return out;
    });

    assert(r.oneTime.afterFirst === 1, `one-time wins_t1 should be 1, got ${r.oneTime.afterFirst}`);
    assert(r.oneTime.afterSecond === 1, `one-time wins_t1 must NOT re-award, got ${r.oneTime.afterSecond}`);
    log(`one-time milestone: count stays 1 across repeats ✓`);

    assert(r.streak.afterFirst === 1, `streak_t1 first run should be 1, got ${r.streak.afterFirst}`);
    assert(r.streak.afterSecondRun === 2, `streak_t1 should re-earn to 2 after a fresh run, got ${r.streak.afterSecondRun}`);
    log(`repeatable streak: re-earns after reset (1 -> 2) ✓`);

    assert(r.finalizeGuard.noFinalize === 0, `non-finalize pass must not count, got ${r.finalizeGuard.noFinalize}`);
    assert(r.finalizeGuard.withFinalize === 1, `finalize pass should count once, got ${r.finalizeGuard.withFinalize}`);
    log(`finalize guard: only the final pass counts (no double-count) ✓`);

    assert(r.feat.afterFirst === 1 && r.feat.afterSecond === 2, `feat flag count should track occurrences 1->2, got ${r.feat.afterFirst}->${r.feat.afterSecond}`);
    log(`single-game feat: counter tracks occurrences (1 -> 2) ✓`);

    assert(r.legacy.read === 1, `legacy entry should read as 1, got ${r.legacy.read}`);
    assert(r.legacy.afterReearn === 2, `legacy entry should keep counting (1 -> 2), got ${r.legacy.afterReearn}`);
    log(`legacy save migration: reads as 1, then counts up ✓`);

    log('PASS — repeatable trophies + earned counter behave as specified');
    return 0;
  } finally {
    try { await browser.close(); } catch {}
    try { await new Promise(r => srv.close(r)); } catch {}
  }
}

main().then(code => process.exit(code ?? 0)).catch(err => { console.error('[trophies-repeat] FAIL:', err.message); process.exit(1); });
