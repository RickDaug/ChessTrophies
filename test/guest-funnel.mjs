#!/usr/bin/env node
/*
 * guest-funnel.mjs — guards the new-user funnel batch (#1 persistence,
 * #2 winnable first game, #3 universal loss-aversion CTA) plus the Workstream-B
 * front-door fixes:
 *   (a) finishing a GAME advances the daily streak (not just puzzles);
 *   (b) a challenge-link FIRST game is eased (no 2000-bot ambush);
 *   (c) the landing leads with the "Play now" hero, the create-account form is
 *       collapsed, and the ELO self-assessment sits behind an optional disclosure;
 *   (d) the signup CTA no longer promises online human play that isn't available.
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
    // A shared challenge link pointing at a STRONG bot (elo 2000). A first-ever guest
    // arriving via this link must NOT be dropped onto a 2000 bot (funnel finding #5).
    if (/^\/api\/challenges\/[^/]+$/.test(p)) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'chard', challengerName: 'Magnus', kind: 'beat_bot', elo: 2000, meta: { result: 'won', moves: 22 }, plays: 9, beats: 1 })); return; }
    // Signup → token; /api/me → the fresh account profile (so the guest→account
    // migration path runs against a real account record).
    if (p === '/api/auth/signup') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ token: 'testtoken' })); return; }
    if (p === '/api/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'acct_test', username: 'NewUser123', email: 'newuser@example.com', region: '', elo: 800, wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0, isPremium: false, emailVerified: true, eloCheckers8: 1200, eloCheckers10: 1200, arenaWins: 0 })); return; }
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

    // --- (c) LANDING: "Play now" is the hero; the account form is DEMOTED --------
    // The create-account form must NOT be open by default (no sign-up wall), and the
    // skill-level ELO self-assessment must be tucked behind an OPTIONAL disclosure,
    // not presented up front. "Play now" must be a visible primary button.
    {
      const hero = await page.evaluate(() => {
        const playNow = document.getElementById('btn-play-now');
        const signupForm = document.getElementById('form-signup');
        const skill = document.getElementById('signup-skill');
        const inDetails = !!(skill && skill.closest('details'));
        const cs = signupForm ? getComputedStyle(signupForm) : null;
        return {
          playNowVisible: !!(playNow && playNow.offsetParent !== null),
          signupFormHidden: !!(cs && cs.display === 'none'),
          skillInOptionalDisclosure: inDetails,
        };
      });
      assert(hero.playNowVisible, 'landing should show the "Play now" hero button');
      assert(hero.signupFormHidden, 'create-account form should be collapsed by default (not a sign-up wall)');
      assert(hero.skillInOptionalDisclosure, 'skill-level ELO should sit inside an optional <details> disclosure');
      log('#c landing leads with Play now; account form demoted + ELO optional ✓');
    }

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
    // --- (d) the CTA must NOT promise online human play that isn't available -----
    assert(!/real people|real opponent|play.*people.*online|play online/i.test(cta),
      `signup CTA must not promise unavailable online play, got "${cta}"`);
    log(`#3 signup CTA shown after a LOSS, loss-framed copy ("${cta}") ✓`);
    log('#d signup CTA does not promise unavailable online human play ✓');

    // progress bumped + persisted
    const games = await page.evaluate(() => (window.CT.state.user.flags || {}).guestGames || 0);
    assert(games === 1, `guestGames should be 1 after one game, got ${games}`);

    // --- (a) finishing a GAME advances the daily streak (not just puzzles) -------
    // Use the app's own todayKey() (local-time) for "today" so we don't trip over a
    // UTC-vs-local off-by-one between the test host clock and the in-app calendar.
    const streakAfterGame = await page.evaluate(() => {
      const ps = window.CT.state.user.playStreak || {};
      const today = window.CT._streak.todayKey();
      return { streak: ps.streak || 0, lastDate: ps.lastDate, today };
    });
    assert(streakAfterGame.streak >= 1 && streakAfterGame.lastDate === streakAfterGame.today,
      `finishing a game should advance the daily streak to today, got ${JSON.stringify(streakAfterGame)}`);
    log('#a finishing a game advanced the daily streak ✓');

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

    // --- MIGRATION: a guest with a daily streak -> account keeps it -----------
    {
      const ctx2 = await browser.newContext();
      await ctx2.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.origin === BASE) return route.continue();
        if (/socket\.io/.test(u.href)) return route.fulfill({ contentType: 'application/javascript', body: 'window.io=function(){return {on(){},emit(){},close(){},io:{on(){}}}};' });
        return route.fulfill({ status: 200, body: '' });
      });
      const pg2 = await ctx2.newPage();
      pg2.on('pageerror', e => errors.push('migration pageerror: ' + e));
      await pg2.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
      await pg2.waitForFunction(() => window.CT && window.CT.state, { timeout: 15000 });
      await pg2.click('#btn-continue-guest');
      await pg2.waitForFunction(() => document.getElementById('screen-lobby')?.classList.contains('active'), { timeout: 10000 });
      // The guest earns a 5-day streak (as if via daily puzzles).
      await pg2.evaluate(() => { window.CT.state.user.playStreak = { streak: 5, best: 5, lastDate: new Date().toISOString().slice(0, 10) }; });
      // Convert: open the signup form + submit.
      await pg2.evaluate(() => window.CT.showScreen('auth'));
      await pg2.click('#screen-auth .tab[data-tab="signup"]');
      await pg2.fill('#signup-username', 'NewUser123');
      await pg2.fill('#signup-email', 'newuser@example.com');
      await pg2.fill('#signup-password', 'passw0rd');
      await pg2.click('#form-signup button[type="submit"]');
      await pg2.waitForFunction(() => window.CT.state.user && !window.CT.state.user.isGuest, { timeout: 8000 })
        .catch(() => fail('signup did not complete (user still a guest)'));
      const m = await pg2.evaluate(() => ({ isGuest: !!window.CT.state.user.isGuest, streak: (window.CT.state.user.playStreak || {}).streak || 0, id: window.CT.state.user.id }));
      assert(!m.isGuest, 'after signup the user should not be a guest');
      assert(m.id === 'acct_test', `should be the new server account, got ${m.id}`);
      assert(m.streak === 5, `the 5-day streak should carry onto the account, got ${m.streak}`);
      log('#migration guest 5-day streak carried onto the new account ✓');
      await ctx2.close();
    }

    // --- (b) CHALLENGE LINK: a first-ever guest's first game is EASED ------------
    {
      const ctx3 = await browser.newContext();
      await ctx3.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.origin === BASE) return route.continue();
        if (/socket\.io/.test(u.href)) return route.fulfill({ contentType: 'application/javascript', body: 'window.io=function(){return {on(){},emit(){},close(){},io:{on(){}}}};' });
        return route.fulfill({ status: 200, body: '' });
      });
      const pg3 = await ctx3.newPage();
      pg3.on('pageerror', e => errors.push('challenge pageerror: ' + e));
      // Arrive as a brand-new visitor through a challenge link to a 2000 bot.
      await pg3.goto(`${BASE}/index.html?c=chard`, { waitUntil: 'domcontentloaded' });
      await pg3.waitForFunction(() => window.CT && window.CT.state, { timeout: 15000 });
      await pg3.waitForSelector('#modal-challenge.show', { timeout: 8000 }).catch(() => fail('challenge landing modal did not open from ?c='));
      await pg3.click('#btn-challenge-accept');
      await pg3.waitForFunction(() => {
        const s = window.CT.state;
        return s.user && s.user.isGuest && s.opponent && s.opponent.isAI && s._challenge &&
          document.getElementById('screen-game')?.classList.contains('active');
      }, { timeout: 10000 }).catch(() => fail('Accept did not start a guest challenge game'));
      const ch = await pg3.evaluate(() => ({
        oppElo: window.CT.state.opponent.elo,
        chElo: window.CT.state._challenge && window.CT.state._challenge.elo,
      }));
      assert(ch.oppElo <= 1000, `a first-ever guest's challenge bot should be eased to a beatable level, got ${ch.oppElo}`);
      assert(ch.oppElo < ch.chElo, `the eased bot (${ch.oppElo}) should be weaker than the 2000 challenge`);
      assert(ch.chElo === 2000, `the real challenge elo (2000) should still be tracked, got ${ch.chElo}`);
      log(`#b challenge-link first game eased to ${ch.oppElo} (challenge was ${ch.chElo}) ✓`);
      await ctx3.close();
    }

    assert(errors.length === 0, 'page errors:\n' + errors.join('\n'));
    log('PASS — guest persistence + winnable first game + universal CTA + guest→account migration');
  } finally {
    await browser.close();
    srv.close();
  }
}
main().catch((e) => { console.error('[guest-funnel] FAIL —', e.message); process.exit(1); });
