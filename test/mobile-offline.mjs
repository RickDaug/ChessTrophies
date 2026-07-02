#!/usr/bin/env node
/*
 * mobile-offline.mjs — mobile-viewport + PWA/offline smoke for the built app.
 *
 * The app is a browser-first PWA but had ZERO automated mobile-viewport or
 * offline/service-worker coverage. This test partially closes that gap by
 * driving the PRODUCTION build (dist/) in a mobile-emulated Playwright Chromium
 * context and asserting the mobile layout + PWA plumbing behave.
 *
 * ⚠️ HONESTY NOTE: this is CHROMIUM DEVICE-EMULATION, *not* real Safari/iOS or
 * real Android. It uses a small viewport + isMobile/hasTouch flags on the SAME
 * Chromium engine that build-smoke uses. It catches layout-overflow regressions,
 * mobile tap-target sizing, and service-worker/precache breakage — but it does
 * NOT exercise WebKit/Safari quirks, iOS PWA install behaviour, Android WebView,
 * touch-gesture nuances, or real network conditions. Real-device / real-Safari
 * behaviour STILL requires manual QA on hardware.
 *
 * Harness is intentionally the SAME as test/build-smoke.mjs: fresh build, a
 * static http server for dist/ WITH the CSP intact, the same MIME map + /api
 * guest stubs, and the same cross-origin route stub (socket.io CDN). The ONLY
 * difference is the browser context is mobile-emulated.
 *
 * Assertions:
 *   1. Mobile render: /index.html boots (window.CT && window.Chess) at 390x844,
 *      NO horizontal overflow (scrollWidth <= innerWidth+2), and the primary
 *      "▶ Play now" button (#btn-play-now) is visible with a tap target >= 40px.
 *   2. Core loop on mobile: tapping #btn-play-now starts a guest game
 *      (#screen-game.active) and the board renders exactly 64 squares.
 *   3. PWA/offline plumbing: after load the service worker is active AND controls
 *      the page (navigator.serviceWorker.controller non-null), caches.keys()
 *      returns >=1 cache, and the app shell (index.html) is present in a cache.
 *      We ALSO flip the context offline (context.setOffline(true)) to prove the
 *      SW+shell survive an offline flag, then restore. See the OFFLINE TRADEOFF
 *      note below for why we assert "SW active + shell cached" rather than a
 *      brittle offline-reload-then-expect-full-app.
 *
 * Run:   node test/mobile-offline.mjs        Exit 0 = PASS, non-zero = FAIL.
 */
import { chromium, devices } from 'playwright';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.css':'text/css' };

const log = (...a) => console.log('[mobile-offline]', ...a);
const fail = (msg) => { throw new Error(msg); };
const assert = (cond, msg) => { if (!cond) fail(msg); };

async function main() {
  // 1) Build fresh (same as build-smoke — test the real production output).
  log('running build: node scripts/build.mjs');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stdout, b.stderr); fail('scripts/build.mjs exited non-zero'); }
  assert(fs.existsSync(path.join(DIST, 'index.html')), 'dist/index.html missing after build');
  assert(fs.existsSync(path.join(DIST, 'sw.js')), 'dist/sw.js missing (offline test needs the service worker)');

  // 2) Serve dist/ WITH the CSP intact — identical server + /api stubs as
  //    build-smoke. Only the cross-origin stubs let this run offline.
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    if (p === '/api/guest') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ username: 'GuestTest', isGuest: true, activeGuests: 1 })); return; }
    if (p === '/api/guest/release') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return; }
    if (p.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
    const file = path.join(DIST, p);
    if (!file.startsWith(DIST)) { res.writeHead(403); res.end('no'); return; }
    fs.readFile(file, (e, d) => {
      if (e) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d);
    });
  });
  const port = await new Promise(r => srv.listen(0, () => r(srv.address().port)));
  const BASE = `http://localhost:${port}`;
  log(`dist served (CSP intact) at ${BASE}`);

  const browser = await chromium.launch();
  const errors = [];
  try {
    // Mobile emulation: iPhone-13-ish. Playwright's devices['iPhone 13'] carries a
    // WebKit UA string, but the ENGINE is still Chromium here (see honesty note).
    // We keep the explicit viewport/isMobile/hasTouch/DSR so the intent is clear
    // and stable regardless of the bundled device descriptor.
    const iPhone = devices['iPhone 13'] || {};
    const ctx = await browser.newContext({
      ...iPhone,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });

    // Same cross-origin stub as build-smoke: satisfy the socket.io CDN, blackhole
    // everything else off-origin so the test is deterministic and offline-capable.
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.origin === BASE) return route.continue();
      if (/socket\.io/.test(u.href)) return route.fulfill({ contentType: 'application/javascript', body: 'window.io=function(){return {on(){},emit(){},close(){}}};' });
      return route.fulfill({ status: 200, body: '' });
    });

    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });

    // --- Assertion 1: mobile render + no horizontal overflow ------------------
    await page.waitForFunction(() => window.CT && window.Chess, { timeout: 20000 })
      .catch(() => fail('app did not boot on mobile viewport (window.CT / window.Chess missing)'));
    log('app booted on 390x844 mobile viewport (CT + Chess present)');

    // No horizontal overflow: the document must not be wider than the viewport
    // (allow a 2px slack for sub-pixel rounding). A regression here means content
    // spills off-screen / a horizontal scrollbar appears on phones.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    assert(overflow.scrollWidth <= overflow.innerWidth + 2,
      `horizontal overflow on mobile: scrollWidth=${overflow.scrollWidth} > innerWidth=${overflow.innerWidth}+2`);
    log(`no horizontal overflow — scrollWidth ${overflow.scrollWidth} <= innerWidth ${overflow.innerWidth}+2`);

    // Primary CTA visible + a real tap target (>= ~40px tall).
    const playBtn = page.locator('#btn-play-now');
    await playBtn.waitFor({ state: 'visible', timeout: 10000 })
      .catch(() => fail('#btn-play-now not visible on mobile landing'));
    const btnBox = await playBtn.boundingBox();
    assert(btnBox && btnBox.height >= 40,
      `#btn-play-now tap target too small: height=${btnBox ? btnBox.height : 'null'} (want >= 40)`);
    log(`#btn-play-now visible, tap target height ${Math.round(btnBox.height)}px (>= 40)`);

    // --- Assertion 2: core loop works at mobile size --------------------------
    // #btn-play-now drops a guest straight into a Practice game by design.
    await playBtn.click();
    await page.waitForFunction(() => {
      const g = document.getElementById('screen-game');
      return g && g.classList.contains('active') && document.querySelectorAll('#board .sq').length === 64;
    }, { timeout: 20000 }).catch(() => fail('guest game did not start / board not 64 squares on mobile'));
    const sqCount = await page.evaluate(() => document.querySelectorAll('#board .sq').length);
    assert(sqCount === 64, `board rendered ${sqCount} squares, expected 64`);
    log(`guest game started on mobile — #screen-game active, board has ${sqCount} squares`);

    // --- Assertion 3: PWA / service-worker plumbing ---------------------------
    // The SW registers on window 'load' and clients.claim()s the page. Wait until
    // it is ACTIVE and actually CONTROLS this page. Async predicate is awaited by
    // Playwright's waitForFunction, so navigator.serviceWorker.ready is safe here.
    await page.waitForFunction(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.ready;
      return !!(reg && reg.active) && !!navigator.serviceWorker.controller;
    }, { timeout: 25000 }).catch(() => fail('service worker never became active + controlling this page'));
    log('service worker active + controlling the page (navigator.serviceWorker.controller non-null)');

    // App shell must be in a cache so the PWA can boot offline. cache.match with
    // ignoreSearch resolves the versionless key regardless of any ?v= query.
    const shell = await page.evaluate(async () => {
      const keys = await caches.keys();
      let shellHit = null;
      for (const k of keys) {
        const c = await caches.open(k);
        const m = await c.match('./index.html', { ignoreSearch: true })
          || await c.match('index.html', { ignoreSearch: true })
          || await c.match(location.origin + '/index.html', { ignoreSearch: true })
          || await c.match('./', { ignoreSearch: true });
        if (m) { shellHit = k; break; }
      }
      return { keys, shellHit };
    });
    assert(shell.keys.length >= 1, `expected >=1 cache, caches.keys()=[${shell.keys.join(', ')}]`);
    assert(shell.shellHit, `app shell (index.html) not found in any cache (${shell.keys.join(', ')})`);
    log(`caches ok — ${shell.keys.length} cache(s), app shell precached in "${shell.shellHit}"`);

    // OFFLINE TRADEOFF: a full offline-reload-then-expect-full-app test is flaky
    // under a stubbed localhost server (the route interceptor + SW fetch handler
    // race, and Chromium's emulated offline vs a still-listening localhost socket
    // behave inconsistently). So we do the deterministic thing: flip the context
    // offline to prove the SW + cached shell SURVIVE the offline flag (SW stays
    // active, shell stays cached), rather than asserting a brittle full reload.
    await ctx.setOffline(true);
    const offlineState = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      const keys = await caches.keys();
      let hasShell = false;
      for (const k of keys) {
        const c = await caches.open(k);
        if (await c.match('./index.html', { ignoreSearch: true }) || await c.match('./', { ignoreSearch: true })) { hasShell = true; break; }
      }
      return { active: !!(reg && reg.active), navOnline: navigator.onLine, hasShell };
    });
    await ctx.setOffline(false);
    assert(offlineState.active, 'service worker not active after going offline');
    assert(offlineState.hasShell, 'app shell missing from cache after going offline');
    assert(offlineState.navOnline === false, 'context.setOffline(true) did not flip navigator.onLine');
    log('offline flag ok — SW still active + shell still cached while navigator.onLine=false');

    // No page errors / console errors throughout (mirrors build-smoke's final gate).
    if (errors.length) fail('page/console errors:\n' + errors.join('\n'));

    log('PASS — mobile viewport renders (no overflow), guest game works, SW active + shell cached offline');
    return 0;
  } finally {
    try { await browser.close(); } catch {}
    try { await new Promise(r => srv.close(r)); } catch {}
  }
}

main().then(code => process.exit(code ?? 0)).catch(err => { console.error('[mobile-offline] FAIL:', err.message); process.exit(1); });
