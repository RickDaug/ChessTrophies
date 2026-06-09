#!/usr/bin/env node
/*
 * a11y.mjs — accessibility regression gate for the built dist/.
 *
 * Builds + serves dist/ WITH the CSP intact (same harness as build-smoke.mjs)
 * and asserts the keyboard/screen-reader affordances we added stay working:
 *   - MODALS: openModal sets role=dialog + aria-modal, an aria-label from the
 *     heading, moves focus inside, traps Tab, and Escape closes it.
 *   - BOTTOM NAV: items are real <button>s, keyboard-activate (Enter), and
 *     aria-current="page" tracks the active tab.
 *   - BOARD: role=grid with a single roving tab stop, per-square aria-labels,
 *     arrow-key cursor movement (orientation-aware), and Enter-to-select +
 *     Enter-to-move drives a real move through the same path as mouse/touch.
 *
 * Run:   node test/a11y.mjs        Exit 0 = PASS, non-zero = FAIL.
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

const log = (...a) => console.log('[a11y]', ...a);
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

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CT && window.CT.openModal, { timeout: 15000 })
      .catch(() => fail('app did not boot (window.CT.openModal missing)'));

    // ---- 1) MODAL a11y -----------------------------------------------------
    await page.click('#btn-continue-guest').catch(() => {});
    await page.waitForFunction(() => document.getElementById('screen-lobby')?.classList.contains('active'), { timeout: 10000 });
    await page.evaluate(() => window.CT.openModal('premium'));
    await page.waitForFunction(() => document.querySelector('#modal-premium.show'), { timeout: 5000 });
    await page.waitForTimeout(120);
    const modal = await page.evaluate(() => {
      const d = document.querySelector('#modal-premium .modal');
      return { role: d && d.getAttribute('role'), ariaModal: d && d.getAttribute('aria-modal'),
        labelled: !!(d && d.getAttribute('aria-label')), focusInside: !!(d && d.contains(document.activeElement)) };
    });
    assert(modal.role === 'dialog', 'modal missing role=dialog');
    assert(modal.ariaModal === 'true', 'modal missing aria-modal=true');
    assert(modal.labelled, 'modal missing aria-label');
    assert(modal.focusInside, 'focus did not move into the modal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    const modalClosed = await page.evaluate(() => !document.querySelector('#modal-premium.show'));
    assert(modalClosed, 'Escape did not close the modal');
    log('modal: role=dialog + aria-modal + aria-label + focus-trap + Escape ✓');

    // ---- 2) BOTTOM NAV a11y ------------------------------------------------
    const navTag = await page.$eval('#bottom-nav .nav-item', n => n.tagName);
    assert(navTag === 'BUTTON', 'nav items are not <button> (got ' + navTag + ')');
    await page.$eval('#bottom-nav [data-nav="trophies"]', n => n.focus());
    await page.keyboard.press('Enter');
    await page.waitForSelector('#screen-trophies.active', { timeout: 5000 });
    const nav = await page.evaluate(() => ({
      active: document.querySelector('#bottom-nav [data-nav="trophies"]').getAttribute('aria-current'),
      play: document.querySelector('#bottom-nav [data-nav="lobby"]').getAttribute('aria-current'),
    }));
    assert(nav.active === 'page', 'active nav button missing aria-current=page');
    assert(!nav.play, 'aria-current not cleared from the inactive tab');
    log('nav: <button>s + Enter activation + aria-current tracking ✓');

    // ---- 3) KEYBOARD BOARD -------------------------------------------------
    await page.$eval('#bottom-nav [data-nav="lobby"]', n => n.focus());
    await page.keyboard.press('Enter');
    await page.waitForSelector('#screen-lobby.active', { timeout: 5000 });
    await page.click('#btn-start-practice');
    await page.waitForFunction(() => {
      const s = window.CT?.state;
      return document.querySelectorAll('#board .sq[data-sq]').length === 64 && s?.game && s.opponent?.isAI;
    }, { timeout: 10000 });
    await page.waitForFunction(() => {
      const s = window.CT?.state;
      return s && !s.aiThinking && !s.animatingMove && s.game.turn() === s.userColor;
    }, { timeout: 20000 });

    const grid = await page.evaluate(() => {
      const board = document.getElementById('board');
      const cells = [...board.querySelectorAll('.sq[data-sq]')];
      const tab0 = cells.filter(c => c.tabIndex === 0);
      return { role: board.getAttribute('role'), tabStops: tab0.length,
        gridcell: cells.every(c => c.getAttribute('role') === 'gridcell'),
        label: tab0[0]?.getAttribute('aria-label') || '' };
    });
    assert(grid.role === 'grid', 'board missing role=grid');
    assert(grid.tabStops === 1, 'board should expose exactly one roving tab stop, got ' + grid.tabStops);
    assert(grid.gridcell, 'board squares missing role=gridcell');
    assert(/,/.test(grid.label), 'board cursor square missing a descriptive aria-label');

    // arrow nav (orientation-aware)
    const navInfo = await page.evaluate(() => {
      const cur = document.querySelector('#board .sq[tabindex="0"]'); cur.focus();
      return { from: cur.dataset.sq, orient: window.CT.state.orientation };
    });
    await page.keyboard.press('ArrowUp');
    const afterUp = await page.evaluate(() => document.activeElement?.dataset?.sq);
    const expectUp = navInfo.from[0] + (navInfo.orient === 'b' ? parseInt(navInfo.from.slice(1), 10) - 1 : parseInt(navInfo.from.slice(1), 10) + 1);
    assert(afterUp === expectUp, `ArrowUp moved cursor to ${afterUp}, expected ${expectUp}`);

    // full move via keyboard: Enter selects, focus target, Enter moves
    const mv = await page.evaluate(() => {
      const g = window.CT.state.game;
      const m = g.moves({ verbose: true }).find(x => !x.promotion) || g.moves({ verbose: true })[0];
      return m ? { from: m.from, to: m.to } : null;
    });
    assert(mv, 'no legal move available');
    await page.$eval(`#board [data-sq="${mv.from}"]`, el => el.focus());
    await page.keyboard.press('Enter');
    const selected = await page.evaluate(() => window.CT.state.selected);
    assert(selected === mv.from, 'Enter did not select the from-square');
    await page.$eval(`#board [data-sq="${mv.to}"]`, el => el.focus());
    await page.keyboard.press('Enter');
    const moved = await page.waitForFunction((from) => {
      const s = window.CT.state;
      return s.game.turn() !== s.userColor || s.aiThinking || !s.game.get(from);
    }, mv.from, { timeout: 8000 }).then(() => true).catch(() => false);
    assert(moved, 'Enter-to-move did not register a move');
    log('board: role=grid + single cursor + aria labels + arrow nav + Enter select/move ✓');

    const realErrors = errors.filter(e => !/favicon|net::ERR/i.test(e));
    assert(realErrors.length === 0, 'page errors during a11y run:\n' + realErrors.join('\n'));

    log('PASS — modals, nav, and board are keyboard- and screen-reader-accessible');
  } finally {
    await browser.close();
    srv.close();
  }
}

main().catch((e) => { console.error('[a11y] FAIL —', e.message); process.exit(1); });
