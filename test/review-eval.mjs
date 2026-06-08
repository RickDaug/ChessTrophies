#!/usr/bin/env node
/*
 * review-eval.mjs — UI/engine test for the Game Review analysis.
 *
 * Serves the real client (no backend needed — review is client-side) and, in a
 * real browser, checks two things:
 *   1) the engine analysis API (window.CT_AI.evaluate / bestMove) returns sane,
 *      white-positive evaluations and finds an obvious winning capture;
 *   2) window.CT_reviewGame(history) renders the analysis UI — eval bar, eval
 *      graph, per-move accuracy, and a "best: ..." hint on a blunder — with no
 *      page errors.
 *
 * Run:   npm run test:review
 * Needs: Playwright's Chromium (npx playwright install chromium). Exit 0=PASS.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.css':'text/css' };

const log = (...a) => console.log('[review-eval]', ...a);
const fail = (msg) => { throw new Error(msg); };
const assert = (cond, msg) => { if (!cond) fail(msg); };

async function main() {
  // Serve the client. Strip the CSP so the test's stubbed cross-origin requests
  // (socket.io, fonts) don't get blocked; the app code under test is unchanged.
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
  const errors = [];
  try {
    const ctx = await browser.newContext();
    // Stub all cross-origin requests (socket.io CDN, Google fonts) so the test
    // needs no external network and never hangs on them.
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      // Stub same-origin API calls the client makes on load (/api/config, etc.)
      // so they don't 404 in this static-file harness and trip the error check.
      if (u.origin === BASE && u.pathname.startsWith('/api/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      if (u.origin === BASE) return route.continue();
      if (/socket\.io/.test(u.href)) return route.fulfill({ contentType: 'application/javascript', body: 'window.io=function(){return {on(){},emit(){},close(){}}};' });
      return route.fulfill({ status: 200, body: '' });
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.Chess && window.CT_AI && window.CT_AI.evaluate && window.CT_AI.bestMove && window.CT_reviewGame, { timeout: 15000 })
      .catch(() => fail('client did not expose CT_AI / CT_reviewGame'));
    log('client loaded; engine + review API present');

    // --- 1) Engine evaluation sanity -------------------------------------
    const evals = await page.evaluate(() => {
      const start = new window.Chess().fen();
      const whiteUpQ = '4k3/8/8/8/8/8/8/3QK3 w - - 0 1';   // white has an extra queen
      const blackUpQ = '3qk3/8/8/8/8/8/8/4K3 w - - 0 1';   // black has an extra queen
      const hangingQ  = 'q3k3/8/8/8/8/8/8/Q3K3 w - - 0 1'; // white to move: Qxa8 wins the queen
      const bm = window.CT_AI.bestMove(hangingQ, 2);
      return {
        start: window.CT_AI.evaluate(start, 1),
        whiteUpQ: window.CT_AI.evaluate(whiteUpQ, 1),
        blackUpQ: window.CT_AI.evaluate(blackUpQ, 1),
        bmTo: bm && bm.move ? bm.move.to : null,
        bmCapture: !!(bm && bm.move && bm.move.captured),
      };
    });
    assert(Math.abs(evals.start) < 80, `start eval should be ~0, got ${evals.start}`);
    assert(evals.whiteUpQ > 500, `white-up-a-queen eval should be strongly +, got ${evals.whiteUpQ}`);
    assert(evals.blackUpQ < -500, `black-up-a-queen eval should be strongly -, got ${evals.blackUpQ}`);
    assert(evals.bmTo === 'a8' && evals.bmCapture, `bestMove should capture the queen on a8, got ${evals.bmTo} capture=${evals.bmCapture}`);
    log(`engine eval ok — start ${evals.start}, +Q ${evals.whiteUpQ}, -Q ${evals.blackUpQ}, bestMove Qxa8 ✓`);

    // --- 2) Review UI on a game with a forced-mate blunder ----------------
    // 1.e4 e5 2.Bc4 Bc5 3.Qh5 Nf6?? 4.Qxf7# — Nf6 is the blunder (allows mate).
    await page.evaluate(() => {
      const g = new window.Chess();
      ['e4','e5','Bc4','Bc5','Qh5','Nf6','Qxf7'].forEach(m => g.move(m));
      window.CT_reviewGame(g.history({ verbose: true }));
    });
    // Analysis is async with a progress line; wait for it to clear.
    await page.waitForFunction(() => {
      const s = document.getElementById('rv-status');
      const w = document.getElementById('rv-acc-w');
      return s && s.textContent === '' && w && /%/.test(w.textContent);
    }, { timeout: 20000 }).catch(() => fail('review analysis never finished'));

    const ui = await page.evaluate(() => ({
      accW: document.getElementById('rv-acc-w').textContent,
      accB: document.getElementById('rv-acc-b').textContent,
      fillH: document.getElementById('rv-evalfill').style.height,
      hasPolyline: !!document.querySelector('#rv-graph svg polyline'),
      hasBlunderTag: !!document.querySelector('#rv-moves .rv-tag.blunder, #rv-moves .rv-tag.mistake'),
    }));
    assert(/%/.test(ui.accW) && /%/.test(ui.accB), `accuracy not shown: w=${ui.accW} b=${ui.accB}`);
    assert(ui.fillH && ui.fillH !== '', 'eval bar fill height not set');
    assert(ui.hasPolyline, 'eval graph polyline not rendered');
    assert(ui.hasBlunderTag, 'expected a blunder/mistake tag in the move list');
    log(`review UI ok — acc W ${ui.accW} / B ${ui.accB}, eval bar ${ui.fillH}, graph + blunder tag present ✓`);

    // Navigate to the flagged blunder move and confirm the "best: ..." hint shows.
    const clicked = await page.evaluate(() => {
      const tag = document.querySelector('#rv-moves .rv-tag.blunder, #rv-moves .rv-tag.mistake');
      const move = tag && tag.closest('[data-ply]');
      if (!move) return false;
      move.click();
      return true;
    });
    assert(clicked, 'could not click the flagged move');
    await page.waitForFunction(() => /best:/.test(document.getElementById('rv-caption').textContent), { timeout: 5000 })
      .catch(() => fail('caption did not show a "best:" suggestion on the flagged move'));
    log('best-move hint shown on the flagged move ✓');

    if (errors.length) fail('page errors:\n' + errors.join('\n'));
    log('PASS — game analysis UI (eval bar + graph + blunder hint) verified in-browser');
    return 0;
  } finally {
    try { await browser.close(); } catch {}
    try { await new Promise(r => srv.close(r)); } catch {}
  }
}

main().then(code => process.exit(code ?? 0)).catch(err => { console.error('[review-eval] FAIL:', err.message); process.exit(1); });
