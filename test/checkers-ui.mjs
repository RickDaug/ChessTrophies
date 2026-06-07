#!/usr/bin/env node
/*
 * checkers-ui.mjs — in-browser smoke for the Checkers client UI (vs computer).
 *
 * Serves the real client with its REAL (hardened) CSP, then for BOTH board sizes
 * (8x8 ACF and 10x10 FMJD): starts a practice (vs computer) checkers game, checks
 * the board renders the right cells + pieces, plays one legal human move by
 * clicking the board, and confirms the AI replies — with zero page errors and
 * zero script-src CSP violations. Proves the new checkers scripts load + play
 * under the hardened CSP without affecting chess.
 *
 * Run: node test/checkers-ui.mjs   (exit 0 = PASS). Needs Playwright Chromium.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.css':'text/css' };
const log = (...a) => console.log('[checkers-ui]', ...a);
const fail = (m) => { console.error('[checkers-ui] FAIL:', m); process.exit(1); };

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
  const errors = [], csp = [];
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
    page.on('console', m => { if (m.type() === 'error' && /Refused to|Content Security/i.test(m.text())) csp.push(m.text()); });
    await page.addInitScript(() => { document.addEventListener('securitypolicyviolation', e => { (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + e.blockedURI); }); });

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CT && window.CT_Checkers && window.CT_CheckersAI && window.CT_Checkers_UI, { timeout: 15000 }).catch(() => fail('checkers globals did not load'));
    log('app + checkers globals loaded under real CSP');

    // Guest login -> lobby.
    await page.click('#btn-play-now').catch(() => {});
    await page.waitForSelector('#screen-lobby.active', { timeout: 8000 }).catch(() => {});

    for (const size of [8, 10]) {
      const rules = size === 8 ? 'acf' : 'fmjd';
      // Close any lingering modal overlay, then start a fresh practice game.
      await page.evaluate(() => { ['result','ck-matchmaking'].forEach(m => window.CT.closeModal && window.CT.closeModal(m)); document.querySelectorAll('.modal-overlay.show').forEach(o => o.classList.remove('show')); });
      await page.evaluate(([s, r]) => window.CT_Checkers_UI.startPractice(800, s, r), [size, rules]);
      await page.waitForSelector('#screen-checkers.active', { timeout: 8000 }).catch(() => fail(`size ${size}: checkers screen did not open`));
      // Board renders right cell + piece counts.
      const counts = await page.evaluate(() => ({ cells: document.querySelectorAll('#checkers-board .ck-sq').length, discs: document.querySelectorAll('#checkers-board .ck-disc').length }));
      const wantCells = size * size, wantDiscs = size === 8 ? 24 : 40;
      if (counts.cells !== wantCells) fail(`size ${size}: expected ${wantCells} cells, got ${counts.cells}`);
      if (counts.discs !== wantDiscs) fail(`size ${size}: expected ${wantDiscs} pieces, got ${counts.discs}`);
      log(`size ${size}: board renders ${counts.cells} cells / ${counts.discs} pieces OK`);

      // Wait until it is the human's turn (AI may open if it is white).
      await page.waitForFunction(() => { const s = window.CT_Checkers_UI.state; return s && s.game && !s.ended && s.game.turn() === s.myColor; }, { timeout: 5000 }).catch(() => fail(`size ${size}: never became human's turn`));
      // Pick a legal human move and play it by clicking from -> to.
      const mv = await page.evaluate(() => { const g = window.CT_Checkers_UI.state.game; const m = g.legalMoves()[0]; return m ? { from: m.from, to: m.to, ser: g.serialize() } : null; });
      if (!mv) fail(`size ${size}: no legal human move`);
      await page.click(`#checkers-board [data-ck="${mv.from}"]`);
      await page.click(`#checkers-board [data-ck="${mv.to}"]`);
      // Human move applied (position changed)...
      await page.waitForFunction((ser) => window.CT_Checkers_UI.state.game.serialize() !== ser, mv.ser, { timeout: 4000 }).catch(() => fail(`size ${size}: human move did not apply`));
      // ...and the AI replies (turn returns to the human, or game ends).
      await page.waitForFunction(() => { const s = window.CT_Checkers_UI.state; return s.ended || s.game.turn() === s.myColor; }, { timeout: 6000 }).catch(() => fail(`size ${size}: AI did not reply`));
      log(`size ${size}: human move applied + AI replied OK`);
    }

    const cspHits = await page.evaluate(() => window.__csp || []);
    const scriptCsp = [...csp, ...cspHits].filter(x => /script-src/i.test(x));
    if (scriptCsp.length) fail('script-src CSP violations:\n' + scriptCsp.join('\n'));
    if (errors.length) fail('page errors:\n' + errors.join('\n'));
    log('PASS — checkers plays vs computer on 8x8 + 10x10, 0 errors, 0 script-src CSP violations');
    return 0;
  } finally {
    try { await browser.close(); } catch {}
    try { await new Promise(r => srv.close(r)); } catch {}
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[checkers-ui] FAIL:', e.message); process.exit(1); });
