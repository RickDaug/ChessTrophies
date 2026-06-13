#!/usr/bin/env node
/*
 * account-deletion-ui.mjs — client gate for the Delete-account flow.
 *
 * The server endpoint (POST /api/me/delete) is covered by test/account-deletion.mjs;
 * this guards the CLIENT wiring in the real built bundle: the Profile "Danger zone"
 * card, the password-confirmation modal, and the sign-out on success. Serves the
 * built dist/ with the CSP intact (like arena-ui) and stubs /api/me/delete -> 200.
 *
 * Asserts:
 *   - a GUEST does NOT see the danger card (it's account-only);
 *   - clicking "Delete account" opens the confirm modal; Cancel closes it;
 *   - confirming with a password calls the endpoint and signs the user out (back
 *     to the auth screen) — all CSP-safe (0 script-src violations / page errors).
 *
 * Run:  node test/account-deletion-ui.mjs    Exit 0 = PASS.
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
const log = (...a) => console.log('[account-deletion-ui]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

async function main() {
  const b = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stdout, b.stderr); fail('build failed'); }

  let deleteCalls = 0;
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    if (p === '/api/guest') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ username: 'GuestTest', isGuest: true, activeGuests: 1 })); return; }
    if (p === '/api/me/delete') { deleteCalls++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return; }
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

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CT, { timeout: 15000 });
    await page.click('#btn-continue-guest');
    await page.waitForFunction(() => document.getElementById('screen-lobby')?.classList.contains('active'), { timeout: 10000 });

    // Go to Profile.
    await page.evaluate(() => window.CT.showScreen('profile'));
    await page.waitForFunction(() => document.getElementById('screen-profile')?.classList.contains('active'), { timeout: 8000 });

    // 1) A GUEST must NOT see the danger card (account-only).
    const guestSeesDanger = await page.evaluate(() => {
      const dz = document.getElementById('profile-danger');
      return dz ? getComputedStyle(dz).display !== 'none' : null;
    });
    assert(guestSeesDanger === false, `a guest should NOT see the danger zone, got display-visible=${guestSeesDanger}`);
    log('guest does not see the Danger zone ✓');

    // Simulate a signed-in account: the card renders the same; reveal it (renderProfile
    // does this for a real non-guest) so we can drive the modal wiring.
    await page.evaluate(() => { document.getElementById('profile-danger').style.display = ''; });

    // 2) Delete account -> confirm modal opens.
    await page.click('#btn-delete-account');
    await page.waitForSelector('#modal-delete-account.show', { timeout: 5000 }).catch(() => fail('the delete-account confirm modal did not open'));
    log('clicking Delete account opens the confirm modal ✓');

    // 3) Cancel closes it.
    await page.click('#btn-delete-account-cancel');
    await page.waitForFunction(() => !document.getElementById('modal-delete-account')?.classList.contains('show'), { timeout: 5000 })
      .catch(() => fail('Cancel did not close the modal'));
    log('Cancel closes the modal ✓');

    // 4) Re-open, confirm with a password -> endpoint called + signed out (auth screen).
    await page.click('#btn-delete-account');
    await page.waitForSelector('#modal-delete-account.show', { timeout: 5000 });
    await page.fill('#delete-account-pw', 'mypassword');
    await page.click('#btn-delete-account-confirm');
    await page.waitForFunction(() => document.getElementById('screen-auth')?.classList.contains('active'), { timeout: 8000 })
      .catch(() => fail('confirming deletion did not sign the user out to the auth screen'));
    assert(deleteCalls === 1, `POST /api/me/delete should have been called once, got ${deleteCalls}`);
    log('confirming deletion calls the endpoint + signs out to the auth screen ✓');

    assert(errors.length === 0, 'page errors / CSP violations:\n' + errors.join('\n'));
    log('PASS — Delete-account UI: account-only danger zone, confirm modal, sign-out on success, CSP-clean');
    return 0;
  } finally {
    await browser.close();
    srv.close();
  }
}

main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[account-deletion-ui] FAIL:', e.message); process.exit(1); });
