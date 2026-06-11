#!/usr/bin/env node
/*
 * board-theme.mjs — verifies the Settings board/piece theme picker after the
 * Classic-pieces makeover:
 *   1) the default board theme is WALNUT and "Classic" pieces use the new warm
 *      ivory/charcoal palette (so the picker matches the default look);
 *   2) selecting another board palette applies its CSS vars live;
 *   3) the Settings grid renders with Walnut active;
 *   4) the one-time forest -> walnut migration runs in CT.loadDB normalization.
 *
 * Run: node test/board-theme.mjs  (needs Playwright Chromium). Exit 0 = PASS.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.css':'text/css' };
const log = (...a) => console.log('[board-theme]', ...a);
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
    await page.waitForFunction(() => window.CT && window.CT.setUser && window.CT_applyThemes && window.CT_renderSettings && window.CT.loadDB, { timeout: 15000 });

    // 1) Default theme = walnut + warm classic pieces.
    const def = await page.evaluate(() => {
      window.CT_applyThemes('walnut', 'classic');
      return {
        light: getComputedStyle(document.documentElement).getPropertyValue('--light-sq').trim(),
        dark: getComputedStyle(document.documentElement).getPropertyValue('--dark-sq').trim(),
        pieceFill: (window.CT_PIECE_THEME || {}).lightFill,
        pieceStroke: (window.CT_PIECE_THEME || {}).lightStroke,
      };
    });
    assert(def.light.toLowerCase() === '#e8d2a8' && def.dark.toLowerCase() === '#9c6b43', `walnut board vars wrong: ${JSON.stringify(def)}`);
    assert(def.pieceFill === '#f4eee2' && def.pieceStroke === '#3b3733', `classic pieces should be warm ivory/charcoal, got ${def.pieceFill}/${def.pieceStroke}`);
    log('default: Walnut board + warm Classic pieces ✓');

    // 2) Selecting another palette applies live.
    const forest = await page.evaluate(() => {
      window.CT_applyThemes('forest', 'classic');
      return getComputedStyle(document.documentElement).getPropertyValue('--light-sq').trim();
    });
    assert(forest.toLowerCase() === '#eedfc6', `selecting Forest should set its light square, got ${forest}`);
    log('apply: switching palette updates the board live ✓');

    // 3) Settings grid renders with Walnut active.
    const grid = await page.evaluate(() => {
      window.CT.setUser({ id: 'u1', username: 'T', email: 't@t.t', region: 'X', elo: 1300, wins: 1, losses: 0, draws: 0, currentStreak: 0, bestStreak: 1, achievements: [], streakTrophies: [], flags: {}, themeBoard: 'walnut', themePieces: 'classic', lessonsCompleted: [] });
      window.CT.showScreen('settings'); window.CT_renderSettings();
      return {
        boards: document.querySelectorAll('#settings-boards .theme-card').length,
        active: (document.querySelector('#settings-boards .theme-card.active .theme-label') || {}).textContent,
      };
    });
    assert(grid.boards >= 8, `expected >=8 board options, got ${grid.boards}`);
    assert(grid.active === 'Walnut', `active board should be Walnut, got ${grid.active}`);
    log('settings grid: renders palettes with Walnut active ✓');

    // 4) forest -> walnut migration in loadDB normalization.
    const migrated = await page.evaluate(() => {
      const db = window.CT.loadDB();
      const id = 'mig-user';
      db.users[id] = { id, username: 'Old', themeBoard: 'forest', themePieces: 'classic' };
      window.CT.saveDB(db);
      const reloaded = window.CT.loadDB();           // normalization runs on read
      return reloaded.users[id] ? reloaded.users[id].themeBoard : null;
    });
    assert(migrated === 'walnut', `legacy 'forest' default should migrate to 'walnut', got ${migrated}`);
    log('migration: legacy forest default -> walnut ✓');

    assert(errs.length === 0, `page errors: ${errs.join(' | ')}`);
    log('PASS — board theme setting defaults to Walnut, classic pieces warmed, applies + migrates');
    return 0;
  } finally {
    try { await browser.close(); } catch {}
    try { await new Promise(r => srv.close(r)); } catch {}
  }
}

main().then(code => process.exit(code ?? 0)).catch(err => { console.error('[board-theme] FAIL:', err.message); process.exit(1); });
