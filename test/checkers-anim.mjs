#!/usr/bin/env node
/*
 * checkers-anim.mjs — proves checkers moves ANIMATE across the board instead of
 * teleporting, including multi-jumps hopping through each capture.
 *
 * It boots the real client, starts a practice game, asks the engine (in-page) to
 * find a real forced double-jump position, injects it, executes the multi-jump by
 * clicking from -> final landing, and:
 *   1) confirms a floating .ck-anim-piece appears (animation actually runs);
 *   2) samples that float's transform over time and asserts it passes through
 *      MULTIPLE waypoints (>=2 hops) — i.e. the double jump is shown hop-by-hop;
 *   3) confirms the two captured pieces are gone once it settles.
 *
 * Run: node test/checkers-anim.mjs   (exit 0 = PASS). Needs Playwright Chromium.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.css':'text/css' };
const log = (...a) => console.log('[checkers-anim]', ...a);
const fail = (m) => { console.error('[checkers-anim] FAIL:', m); process.exit(1); };

async function main() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return; }
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
      if (/socket\.io/.test(u.href)) return route.fulfill({ contentType: 'application/javascript', body: 'window.io=function(){return {on(){},emit(){},close(){}}};' });
      return route.fulfill({ status: 200, body: '' });
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('' + e));

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CT && window.CT_Checkers && window.CT_Checkers_UI, { timeout: 15000 }).catch(() => fail('checkers globals did not load'));
    await page.click('#btn-play-now').catch(() => {});
    await page.waitForSelector('#screen-lobby.active', { timeout: 8000 }).catch(() => {});

    // Find a real forced double-jump position for white (8x8 ACF) via the engine.
    const pos = await page.evaluate(() => {
      const E = window.CT_Checkers;
      for (let w = 1; w <= 32; w++) for (let b1 = 1; b1 <= 32; b1++) {
        if (b1 === w) continue;
        for (let b2 = b1 + 1; b2 <= 32; b2++) {
          if (b2 === w) continue;
          const arr = new Array(32).fill('.');
          arr[w - 1] = 'w'; arr[b1 - 1] = 'b'; arr[b2 - 1] = 'b';
          let g; try { g = E.load('CK1|8|acf|w|0|0|' + arr.join('')); } catch (e) { continue; }
          const dbl = g.legalMoves().find(m => m.captures && m.captures.length >= 2);
          if (dbl) return { ser: 'CK1|8|acf|w|0|0|' + arr.join(''), from: dbl.from, to: dbl.to, captures: dbl.captures.slice(), path: (dbl.path || []).slice() };
        }
      }
      return null;
    });
    if (!pos) fail('could not construct a double-jump position');
    log(`double-jump found: ${pos.from} -> ${pos.to}, captures ${JSON.stringify(pos.captures)} (path ${JSON.stringify(pos.path)})`);

    // Start a practice game, then inject the crafted position as the live game.
    await page.evaluate(() => window.CT_Checkers_UI.startPractice(800, 8, 'acf'));
    await page.waitForSelector('#screen-checkers.active', { timeout: 8000 }).catch(() => fail('checkers screen did not open'));
    await page.evaluate((ser) => {
      const UI = window.CT_Checkers_UI, st = UI.state;
      st.game = window.CT_Checkers.load(ser);
      st.myColor = 'w'; st.orientation = 'w'; st.ended = false; st.aiThinking = false;
      st.opponent = { isAI: true, aiElo: 800 }; // keep it a practice game
      // Install a sampler that records the float's transform over time.
      window.__hops = [];
      const obs = new MutationObserver(() => {
        const f = document.querySelector('#checkers-board .ck-anim-piece');
        if (f && !window.__sampling) {
          window.__sampling = true;
          const tick = () => {
            const fl = document.querySelector('#checkers-board .ck-anim-piece');
            if (fl) { window.__hops.push(fl.style.transform || ''); requestAnimationFrame(tick); }
          };
          requestAnimationFrame(tick);
        }
      });
      obs.observe(document.getElementById('checkers-board'), { childList: true, subtree: true });
    }, pos.ser);

    // Execute the double jump: click the white piece, then its final landing.
    await page.click(`#checkers-board [data-ck="${pos.from}"]`);
    await page.click(`#checkers-board [data-ck="${pos.to}"]`);

    // Engine state applies synchronously; wait for the animation to settle.
    await page.waitForFunction(() => window.CT_Checkers_UI.state.animating === false, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(300);

    const res = await page.evaluate(() => {
      const board = window.CT_Checkers_UI.state.game.board();
      let black = 0; for (const row of board) for (const c of row) if (c && c.color === 'b') black++;
      // Distinct non-empty transforms seen on the float = waypoints stepped through.
      const distinct = Array.from(new Set((window.__hops || []).filter(Boolean)));
      return { black, distinctHops: distinct.length, sawFloat: (window.__hops || []).length > 0 };
    });

    if (!res.sawFloat) fail('no floating piece appeared — move did not animate (still instant)');
    log(`animation ran — floating piece observed, ${res.distinctHops} distinct hop transform(s)`);
    if (res.distinctHops < 2) fail(`multi-jump should step through >=2 hops, saw ${res.distinctHops}`);
    log(`multi-jump animated hop-by-hop (>=2 hops) ✓`);
    if (res.black !== 0) fail(`both jumped pieces should be gone (0 black left in this position), got ${res.black}`);
    log(`both captured pieces removed after the jump ✓`);

    if (errors.length) fail('page errors:\n' + errors.join('\n'));
    log('PASS — checkers moves animate across the board; multi-jumps hop through each capture');
    return 0;
  } finally {
    try { await browser.close(); } catch {}
    try { await new Promise(r => srv.close(r)); } catch {}
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[checkers-anim] FAIL:', e.message); process.exit(1); });
