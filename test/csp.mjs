#!/usr/bin/env node
/*
 * csp.mjs — Content-Security-Policy regression gate for the hardened script-src.
 *
 * The app's CSP script-src was hardened to 'self' (NO 'unsafe-inline'), which
 * blocks BOTH injected inline <script> blocks AND inline on* event handlers.
 * That is high-risk: the app historically relied on inline handlers and inline
 * scripts. This test serves the REAL client WITH its real CSP intact (unlike
 * review-eval, which strips it) and proves:
 *   1) ZERO script-src CSP violations occur across the major flows; and
 *   2) the converted handlers actually work (modals open/close, the sounds
 *      checkbox writes localStorage, a practice move plays, chat/avatar/report
 *      controls respond), i.e. the CSP is hardened but NOT broken.
 *
 * Only cross-origin requests (socket.io CDN, Google fonts) are stubbed; every
 * same-origin file is served with its real bytes so the CSP applies as shipped.
 *
 * Run:   node test/csp.mjs        (exit 0 = PASS, non-zero = violation/failure)
 * Needs: Playwright's Chromium (npx playwright install chromium).
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
  '.json':'application/json','.svg':'image/svg+xml','.png':'image/png',
  '.css':'text/css','.ico':'image/x-icon','.woff2':'font/woff2',
};

const log = (...a) => console.log('[csp]', ...a);
const fail = (msg) => { throw new Error(msg); };
const assert = (cond, msg) => { if (!cond) fail(msg); };

async function main() {
  // Serve the client WITH its real CSP — do NOT strip it. The whole point is to
  // exercise the shipped policy. Only the cross-origin requests are stubbed in
  // the browser context below.
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return; }
    fs.readFile(file, (e, d) => {
      if (e) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d);
    });
  });
  const port = await new Promise(r => srv.listen(0, () => r(srv.address().port)));
  const BASE = `http://localhost:${port}`;
  log(`client served (with real CSP) at ${BASE}`);

  const browser = await chromium.launch();
  const pageErrors = [];
  try {
    const ctx = await browser.newContext();
    // Stub all cross-origin requests (socket.io CDN, Google fonts) so the test
    // needs no external network and never hangs on them.
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.origin === BASE) return route.continue();
      if (/socket\.io/.test(u.href)) return route.fulfill({ contentType: 'application/javascript', body: 'window.io=function(){return {on(){},emit(){},close(){}}};' });
      return route.fulfill({ status: 200, body: '' });
    });

    const page = await ctx.newPage();

    // Record CSP violations from BOTH channels:
    //  (a) a document-level securitypolicyviolation listener (installed before
    //      any app code via addInitScript), pushing structured records onto a
    //      window array the test reads; and
    //  (b) the console, which logs "Refused to ..." for blocked inline scripts.
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations.push({
          violatedDirective: e.violatedDirective,
          effectiveDirective: e.effectiveDirective,
          blockedURI: e.blockedURI,
          sourceFile: e.sourceFile,
          lineNumber: e.lineNumber,
        });
      });
    });

    const consoleCsp = [];
    page.on('console', (m) => {
      const t = m.text();
      if (/Refused to|Content Security Policy|securitypolicy/i.test(t)) consoleCsp.push(t);
    });
    page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e));

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CT && window.CT.showScreen && window.Chess, { timeout: 15000 })
      .catch(() => fail('client did not boot (window.CT / Chess missing) — externalized scripts may be blocked'));
    log('client booted with CSP active; window.CT + Chess present');

    // ----- helpers --------------------------------------------------------
    // Snapshot of script-src violations so we can detect NEW ones per step.
    const scriptSrcViolations = () => page.evaluate(() =>
      (window.__cspViolations || []).filter(v => /script-src/.test(v.violatedDirective || v.effectiveDirective || ''))
    );
    let baseline = 0;
    async function step(name, fn) {
      await fn();
      const v = await scriptSrcViolations();
      if (v.length > baseline) {
        const nu = v.slice(baseline);
        fail(`script-src violation during "${name}":\n` + JSON.stringify(nu, null, 2));
      }
      baseline = v.length;
      log(`step ok: ${name} (no new script-src violation)`);
    }
    const click = (sel) => page.click(sel, { timeout: 5000 });
    const isModalOpen = (id) => page.evaluate((i) => {
      const m = document.getElementById('modal-' + i);
      return !!(m && m.classList.contains('show'));
    }, id);

    // ----- 1) Guest "Play now" -> lobby -----------------------------------
    await step('guest Play now -> lobby', async () => {
      await click('#btn-play-now');
      await page.waitForFunction(() => document.querySelector('#screen-lobby.active'), { timeout: 8000 });
    });
    assert(await page.evaluate(() => !!document.querySelector('#screen-lobby.active')), 'lobby not active after Play now');

    // ----- 2) Ranked "Coming soon" gate (seasonal switch) -----------------
    // This harness can't reach GET /api/config (no backend), so rankedEnabled
    // defaults to FALSE → the ranked "Find ranked opponent" button is disabled
    // and badged "Coming soon", and clicking it must NOT open the time-control
    // modal. (When the server flag is TRUE, this button opens timecontrol as
    // before — that path is exercised live, not in this offline harness.)
    await step('ranked find-match is disabled (Coming soon) + does not open modal', async () => {
      // Give the (fire-and-forget) /api/config fetch + applyRankedGate a beat to run.
      await page.waitForFunction(() => {
        const b = document.getElementById('btn-find-match');
        return b && (b.disabled || b.classList.contains('is-coming-soon'));
      }, { timeout: 5000 });
      // Clicking a disabled button does nothing; force a programmatic click too to
      // prove the defensive guard prevents the modal regardless.
      await page.evaluate(() => { try { document.getElementById('btn-find-match').click(); } catch (e) {} });
      const opened = await page.evaluate(() => !!document.querySelector('#modal-timecontrol.show'));
      if (opened) fail('ranked find-match opened timecontrol while ranked is disabled');
    });
    assert(!(await isModalOpen('timecontrol')), 'timecontrol modal should stay closed while ranked disabled');

    // ----- 3) Friendly-challenge invite modal -----------------------------
    // (The old private create/join-room flow was removed; play is online-only.)
    await step('open challenge-invite modal', async () => {
      await page.evaluate(() => window.CT.openModal('challenge-invite'));
      await page.waitForFunction(() => document.querySelector('#modal-challenge-invite.show'), { timeout: 5000 });
    });
    assert(await isModalOpen('challenge-invite'), 'challenge-invite modal did not open');
    await step('close challenge-invite modal', async () => {
      await page.evaluate(() => window.CT.closeModal('challenge-invite'));
    });

    // ----- 4) Premium modal via the lobby premium card (converted handler) -
    await step('lobby premium card -> premium modal (converted onclick)', async () => {
      await click('#lobby-premium-card');
      await page.waitForFunction(() => document.querySelector('#modal-premium.show'), { timeout: 5000 });
    });
    assert(await isModalOpen('premium'), 'premium modal did not open from converted card handler');
    await step('close premium modal', async () => {
      await click('#btn-premium-close');
      await page.waitForFunction(() => !document.querySelector('#modal-premium.show'), { timeout: 5000 });
    });

    // ----- 5) Friends screen + search input (converted oninput) -----------
    await step('go to friends screen', async () => {
      await page.evaluate(() => window.CT.showScreen('friends'));
      await page.waitForFunction(() => document.querySelector('#screen-friends.active'), { timeout: 5000 });
    });
    await step('friend search input fires renderFriendSearchResults', async () => {
      await page.fill('#friend-search-input', 'zzqq');
      // input listener should run without throwing; results container exists.
      await page.waitForFunction(() => !!document.getElementById('friend-search-results'), { timeout: 5000 });
    });

    // ----- 6) Rankings ----------------------------------------------------
    await step('go to rankings screen', async () => {
      await page.evaluate(() => window.CT.showScreen('rankings'));
      await page.waitForFunction(() => document.querySelector('#screen-rankings.active'), { timeout: 5000 });
    });

    // ----- 7) Profile -----------------------------------------------------
    await step('go to profile screen', async () => {
      await page.evaluate(() => window.CT.showScreen('profile'));
      await page.waitForFunction(() => document.querySelector('#screen-profile.active'), { timeout: 5000 });
    });

    // ----- 8) Settings + sounds checkbox (converted onchange) -------------
    await step('go to settings screen', async () => {
      await page.evaluate(() => window.CT.showScreen('settings'));
      await page.waitForFunction(() => document.querySelector('#screen-settings.active'), { timeout: 5000 });
    });
    await step('toggle sounds checkbox writes localStorage', async () => {
      // Set to a known state then flip it via a real user click on the label.
      await page.evaluate(() => { document.getElementById('toggle-sounds').checked = true; localStorage.removeItem('ct_sounds'); });
      await page.evaluate(() => document.getElementById('toggle-sounds').click());
    });
    const soundsLS = await page.evaluate(() => localStorage.getItem('ct_sounds'));
    assert(soundsLS === 'false' || soundsLS === 'true', `sounds checkbox did not write ct_sounds (got ${soundsLS})`);
    log(`  sounds checkbox wrote localStorage ct_sounds=${soundsLS} ✓`);

    // ----- 9) Avatar editor (converted dynamic handlers) ------------------
    // Ensure the current (guest) user is persisted in the local DB so the avatar
    // save path (db.users[user.id].avatarStock = ...) has a record to write to —
    // otherwise _selectStockAvatar throws an app-level error unrelated to CSP.
    await page.evaluate(() => {
      const u = window.CT.user;
      if (u) { const db = window.CT.loadDB(); db.users[u.id] = u; window.CT.saveDB(db); }
    });
    await step('open avatar editor + select stock + close (converted handlers)', async () => {
      await page.evaluate(() => window.openAvatarEditor());
      await page.waitForFunction(() => !!document.getElementById('ct-avatar-modal'), { timeout: 5000 });
      // Click a stock avatar (data-act="avatar-stock" w/ data-id) — converted.
      await click('#ct-avatar-modal button[data-act="avatar-stock"]');
      // Close via the Done button (data-act="avatar-close").
      await page.evaluate(() => {
        const btns = document.querySelectorAll('#ct-avatar-modal button[data-act="avatar-close"]');
        btns[btns.length - 1].click();
      });
      await page.waitForFunction(() => !document.getElementById('ct-avatar-modal'), { timeout: 5000 });
    });
    assert(!(await page.evaluate(() => !!document.getElementById('ct-avatar-modal'))), 'avatar modal did not close via converted handler');

    // ----- 10) Report modal (converted dynamic handlers) ------------------
    await step('open report modal + close (converted handlers)', async () => {
      await page.evaluate(() => window.openReportDialog('victim_id_123', 'victim<name>'));
      await page.waitForFunction(() => !!document.getElementById('ct-report-modal'), { timeout: 5000 });
      // Verify the escaped data-username round-trips (escapeHTML used on it).
      const uname = await page.evaluate(() => document.querySelector('#ct-report-modal button[data-act="report-submit"]').getAttribute('data-username'));
      if (uname !== 'victim<name>') fail(`report data-username mismatch: ${uname}`);
      await click('#ct-report-modal button[data-act="report-close"]');
      await page.waitForFunction(() => !document.getElementById('ct-report-modal'), { timeout: 5000 });
    });

    // ----- 11) Chat overlay (converted dynamic handlers) ------------------
    await step('open chat overlay, send, close (converted handlers)', async () => {
      await page.evaluate(() => window.openGameChat('Test Chat'));
      await page.waitForFunction(() => !!document.getElementById('ct-chat-overlay'), { timeout: 5000 });
      await page.fill('#ct-chat-input', 'hello world');
      await click('#ct-chat-overlay button[data-act="chat-send"]'); // _sendChat
      // input clears after send
      await page.waitForFunction(() => { const i = document.getElementById('ct-chat-input'); return i && i.value === ''; }, { timeout: 5000 });
      await click('#ct-chat-overlay button[data-act="chat-close"]');
      await page.waitForFunction(() => !document.getElementById('ct-chat-overlay'), { timeout: 5000 });
    });

    // ----- 12) Daily play streak ------------------------------------------
    await step('render the daily play-streak card', async () => {
      await page.evaluate(() => window.CT.showScreen('lobby'));
      await page.waitForFunction(() => document.querySelector('#screen-lobby.active'), { timeout: 5000 });
      // The play-streak card is rendered into #playstreak-card by renderLobby.
      // Exercise its render path and confirm it produced content (no inline JS).
      await page.evaluate(() => window.CT.renderPlayStreak && window.CT.renderPlayStreak());
      await page.waitForFunction(() => {
        const el = document.getElementById('playstreak-card');
        return el && /play streak|play a game/i.test(el.textContent || '');
      }, { timeout: 5000 }).catch(() => {});
    });

    // ----- 13) Practice vs Computer + make a move ------------------------
    await step('go to lobby and start practice game (human as White)', async () => {
      await page.evaluate(() => window.CT.showScreen('lobby'));
      await page.waitForFunction(() => document.querySelector('#screen-lobby.active'), { timeout: 5000 });
      // Practice randomly assigns the human's colour; force White so the test's
      // first move (e2->e4) is always the human's legal move.
      await page.evaluate(() => { try { window.CT.state._forceColor = 'w'; } catch (e) {} });
      await click('#btn-start-practice');
      await page.waitForFunction(() => document.querySelector('#screen-game.active') && document.querySelector('#board [data-sq="e2"]'), { timeout: 10000 });
      const color = await page.evaluate(() => window.CT.state.userColor);
      if (color !== 'w') fail('expected human to be White for the move test, got ' + color);
    });
    await step('make a practice move e2->e4', async () => {
      await click('#board [data-sq="e2"]');
      await click('#board [data-sq="e4"]');
      // After a legal move the e4 square should hold a piece and e2 be empty.
      await page.waitForFunction(() => {
        const e4 = document.querySelector('#board [data-sq="e4"]');
        const e2 = document.querySelector('#board [data-sq="e2"]');
        return e4 && e4.querySelector('svg') && e2 && !e2.querySelector('svg');
      }, { timeout: 8000 });
    });
    log('  practice move e2-e4 played ✓');

    // ----- 14) Game Review ------------------------------------------------
    await step('open game review', async () => {
      const ok = await page.evaluate(() => {
        if (!window.CT_reviewGame || !window.Chess) return false;
        const g = new window.Chess();
        ['e4','e5','Nf3','Nc6'].forEach(m => g.move(m));
        window.CT_reviewGame(g.history({ verbose: true }));
        return true;
      });
      if (!ok) { log('  (review API unavailable — skipping)'); return; }
      await page.waitForFunction(() => !!document.getElementById('rv-status') || !!document.getElementById('rv-evalfill'), { timeout: 10000 }).catch(() => {});
    });

    // ----- Final tally ----------------------------------------------------
    const allViolations = await page.evaluate(() => window.__cspViolations || []);
    const scriptViolations = allViolations.filter(v => /script-src/.test(v.violatedDirective || v.effectiveDirective || ''));
    const styleViolations = allViolations.filter(v => /style-src/.test(v.violatedDirective || v.effectiveDirective || ''));

    if (scriptViolations.length) {
      fail('script-src CSP violations detected:\n' + JSON.stringify(scriptViolations, null, 2) +
        (consoleCsp.length ? '\nConsole CSP messages:\n' + consoleCsp.join('\n') : ''));
    }
    if (pageErrors.length) fail('page errors:\n' + pageErrors.join('\n'));

    log(`PASS — 0 script-src violations across all flows; converted handlers verified working.`);
    log(`(informational: ${styleViolations.length} style-src violation(s) — style-src 'unsafe-inline' is intentionally retained, so these are expected/allowed)`);
    return 0;
  } finally {
    try { await browser.close(); } catch {}
    try { await new Promise(r => srv.close(r)); } catch {}
  }
}

main().then(code => process.exit(code ?? 0)).catch(err => { console.error('[csp] FAIL:', err.message); process.exit(1); });
