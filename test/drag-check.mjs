#!/usr/bin/env node
/*
 * drag-check.mjs — verifies DRAG-AND-DROP piece movement on the built dist/.
 *
 * Builds dist/, serves it WITH the CSP intact (same harness as build-smoke),
 * drives a guest into a Practice game, then:
 *   - DRAGS a legal first move (mouse pointer down on source square center,
 *     move across the board, up over the target) and asserts the move APPLIED
 *     (state.game FEN advanced + the dragged piece left its source square).
 *   - asserts CLICK-TO-MOVE still works (two taps) for a subsequent move.
 *   - asserts 0 script-src CSP violations and no page errors.
 *
 * Run:  node test/drag-check.mjs    Exit 0 = PASS, non-zero = FAIL.
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

const log = (...a) => console.log('[drag-check]', ...a);
const fail = (msg) => { throw new Error(msg); };
const assert = (cond, msg) => { if (!cond) fail(msg); };

async function main() {
  log('running build: node scripts/build.mjs');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stdout, b.stderr); fail('scripts/build.mjs exited non-zero'); }
  assert(fs.existsSync(path.join(DIST, 'index.html')), 'dist/index.html missing after build');

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
    const ctx = await browser.newContext();
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.origin === BASE) return route.continue();
      if (/socket\.io/.test(u.href)) return route.fulfill({ contentType: 'application/javascript', body: 'window.io=function(){return {on(){},emit(){},close(){}}};' });
      return route.fulfill({ status: 200, body: '' });
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations.push({ directive: e.violatedDirective, blocked: e.blockedURI });
      });
    });

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CT && window.Chess && window.CT.state, { timeout: 15000 })
      .catch(() => fail('app did not boot'));

    // Guest -> lobby -> Practice.
    await page.click('#btn-continue-guest');
    await page.waitForFunction(() => document.getElementById('screen-lobby')?.classList.contains('active'), { timeout: 10000 })
      .catch(() => fail('lobby did not render'));
    await page.click('#btn-start-practice');
    await page.waitForFunction(() => {
      const g = document.getElementById('screen-game');
      const s = window.CT && window.CT.state;
      return g?.classList.contains('active') && document.querySelectorAll('#board .sq').length === 64 && s?.game && s.opponent?.isAI;
    }, { timeout: 10000 }).catch(() => fail('Practice game did not start'));

    // Wait until it's the human's turn (user color is randomized; AI may open).
    await page.waitForFunction(() => {
      const s = window.CT.state;
      return s.game && !s.aiThinking && !s.animatingMove && s.game.turn() === s.userColor;
    }, { timeout: 20000 }).catch(() => fail('never reached the human turn'));

    // Helper: center of a board square in page coords.
    const sqCenter = async (sq) => page.evaluate((s) => {
      const el = document.querySelector(`#board .sq[data-sq="${s}"]`);
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, sq);

    // ---- 1) DRAG a legal move ----
    const dragMv = await page.evaluate(() => {
      const g = window.CT.state.game;
      const m = g.moves({ verbose: true }).find(x => !x.promotion);
      return m ? { from: m.from, to: m.to, san: m.san } : null;
    });
    assert(dragMv, 'no legal move to drag');
    const fenBefore = await page.evaluate(() => window.CT.state.game.fen());
    const a = await sqCenter(dragMv.from);
    const c = await sqCenter(dragMv.to);

    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    // Move in steps so the drag lifts (passes the move threshold) and tracks.
    await page.mouse.move((a.x + c.x) / 2, (a.y + c.y) / 2, { steps: 6 });
    // Assert the lift happened (floating clone present + targets shown).
    const lifted = await page.evaluate(() => {
      const s = window.CT.state;
      return !!(s.drag && s.drag.lifted) && !!document.querySelector('#board-overlay .drag-piece') && s.legalTargets.length > 0;
    });
    assert(lifted, 'drag did not lift (no floating clone / targets) — piece is not following the pointer');
    await page.mouse.move(c.x, c.y, { steps: 6 });
    await page.mouse.up();

    await page.waitForFunction((args) => {
      const s = window.CT && window.CT.state;
      if (!s || !s.game) return false;
      const fenChanged = s.game.fen() !== args.fenBefore;
      const movedAway = !s.game.get(args.from);
      return fenChanged && movedAway;
    }, { fenBefore, from: dragMv.from }, { timeout: 8000 })
      .catch(() => fail(`DRAG move ${dragMv.san} (${dragMv.from}->${dragMv.to}) did not apply`));
    // The drag session must be fully torn down (no leftover clone).
    const cleanedUp = await page.evaluate(() => !window.CT.state.drag && !document.querySelector('#board-overlay .drag-piece'));
    assert(cleanedUp, 'drag session not cleaned up after drop');
    log(`DRAG ok — ${dragMv.san} (${dragMv.from}->${dragMv.to}) applied; piece left source; clone removed`);

    // Wait for AI reply + control back to the human (so we can test click-to-move next).
    await page.waitForFunction(() => {
      const s = window.CT.state;
      return s.game && (s.game.game_over() || (!s.aiThinking && !s.animatingMove && s.game.turn() === s.userColor));
    }, { timeout: 20000 }).catch(() => fail('AI never replied after the drag move'));

    // ---- 2) CLICK-TO-MOVE still works (two taps) ----
    if (!(await page.evaluate(() => window.CT.state.game.game_over()))) {
      const clickMv = await page.evaluate(() => {
        const g = window.CT.state.game;
        const m = g.moves({ verbose: true }).find(x => !x.promotion);
        return m ? { from: m.from, to: m.to, san: m.san } : null;
      });
      assert(clickMv, 'no legal move to click');
      const fen2 = await page.evaluate(() => window.CT.state.game.fen());
      await page.click(`#board .sq[data-sq="${clickMv.from}"]`);
      // After the first tap, the source must be selected (targets shown) — proves
      // pointerdown did NOT pre-select+toggle it off.
      const selectedOk = await page.evaluate((f) => window.CT.state.selected === f && window.CT.state.legalTargets.length > 0, clickMv.from);
      assert(selectedOk, 'click-to-move: first tap did not select the piece (drag may have broken tap selection)');
      await page.click(`#board .sq[data-sq="${clickMv.to}"]`);
      await page.waitForFunction((args) => {
        const s = window.CT.state;
        return s.game && (s.game.fen() !== args.fen2) && !s.game.get(args.from);
      }, { fen2, from: clickMv.from }, { timeout: 8000 })
        .catch(() => fail(`CLICK move ${clickMv.san} did not apply`));
      log(`CLICK-TO-MOVE ok — ${clickMv.san} (${clickMv.from}->${clickMv.to}) applied via two taps`);
    } else {
      log('game ended after drag move; skipping click-to-move sub-check (still validated drag)');
    }

    // ---- gates ----
    const v = await page.evaluate(() => window.__cspViolations || []);
    const scriptViolations = v.filter(x => /script-src/i.test(x.directive || ''));
    assert(scriptViolations.length === 0, 'script-src CSP violations: ' + JSON.stringify(scriptViolations));
    assert(errors.length === 0, 'page errors:\n' + errors.join('\n'));

    log('PASS — drag-and-drop applies moves, click-to-move still works, 0 CSP/script errors');
    return 0;
  } finally {
    try { await browser.close(); } catch {}
    try { await new Promise(r => srv.close(r)); } catch {}
  }
}

main().then(code => process.exit(code ?? 0)).catch(err => { console.error('[drag-check] FAIL:', err.message); process.exit(1); });
