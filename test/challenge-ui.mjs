#!/usr/bin/env node
/*
 * challenge-ui.mjs — client RECEIVE flow for the growth loop.
 *
 * Serves built dist/ with a stubbed /api/challenges/:id, opens the app via a
 * ?c=<id> link (as a brand-new visitor would), and asserts:
 *   - the challenge landing modal shows the challenger, the difficulty, and the
 *     "N tried · M beat it" social proof;
 *   - "Accept" drops the visitor straight into a guest bot game at the EXACT
 *     challenge difficulty (no signup), with the challenge context tracked.
 * CSP-clean, zero page errors.
 *
 * Run:  node test/challenge-ui.mjs   Exit 0 = PASS.
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
const log = (...a) => console.log('[challenge-ui]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

const CHALLENGE = { id: 'cstub', challengerName: 'Rick', kind: 'beat_bot', elo: 1500, meta: { result: 'won', moves: 30 }, plays: 5, beats: 2 };

async function main() {
  const b = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stdout, b.stderr); fail('build failed'); }

  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    if (/^\/api\/challenges\/[^/]+$/.test(p)) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(CHALLENGE)); return; }
    if (p === '/api/guest') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ username: 'GuestTester', isGuest: true })); return; }
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
    page.on('console', m => { if (m.type() === 'error' && /Refused to/i.test(m.text())) errors.push('csp: ' + m.text()); });
    await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective)); });

    // Open as a brand-new visitor via a challenge link.
    await page.goto(`${BASE}/index.html?c=cstub`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CT && window.CT.state, { timeout: 15000 });

    // 1) landing modal shows the challenge.
    await page.waitForSelector('#modal-challenge.show', { timeout: 8000 }).catch(() => fail('challenge landing modal did not open from ?c='));
    const ui = await page.evaluate(() => ({
      title: document.getElementById('challenge-title')?.textContent || '',
      body: document.getElementById('challenge-body')?.textContent || '',
      proof: document.getElementById('challenge-proof')?.textContent || '',
      csp: (window.__csp || []).filter(d => /script-src/i.test(d)),
    }));
    assert(/Rick/.test(ui.title), `landing should name the challenger, got "${ui.title}"`);
    assert(/1500/.test(ui.body), `landing should state the difficulty (elo 1500), got "${ui.body}"`);
    assert(/5 players/.test(ui.proof) && /2 beat it/.test(ui.proof), `proof should show "5 players ... 2 beat it", got "${ui.proof}"`);
    assert(ui.csp.length === 0, 'script-src CSP violations: ' + JSON.stringify(ui.csp));
    log(`landing: "${ui.title}" / "${ui.body}" / proof "${ui.proof}" ✓`);

    // 2) Accept -> guest bot game at the EXACT challenge difficulty.
    await page.click('#btn-challenge-accept');
    await page.waitForFunction(() => {
      const s = window.CT.state;
      return s.user && s.user.isGuest && s.opponent && s.opponent.isAI && s._challenge &&
        document.getElementById('screen-game')?.classList.contains('active');
    }, { timeout: 10000 }).catch(() => fail('Accept did not start a guest game'));
    const g = await page.evaluate(() => ({ elo: window.CT.state.opponent.elo, chId: window.CT.state._challenge && window.CT.state._challenge.id, guest: !!window.CT.state.user.isGuest }));
    assert(g.elo === 1500, `the bot should be at the challenge elo 1500, got ${g.elo}`);
    assert(g.chId === 'cstub', `challenge context should be tracked, got ${g.chId}`);
    assert(g.guest, 'the new visitor should be playing as a guest (no signup)');
    assert(errors.length === 0, 'page errors:\n' + errors.join('\n'));
    log('accept: dropped into a guest bot game at elo 1500, challenge tracked ✓');

    log('PASS — challenge link → landing (with social proof) → accept → guest game at the right difficulty');
  } finally {
    await browser.close();
    srv.close();
  }
}
main().catch((e) => { console.error('[challenge-ui] FAIL —', e.message); process.exit(1); });
