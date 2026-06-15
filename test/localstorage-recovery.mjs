#!/usr/bin/env node
/*
 * localstorage-recovery.mjs — the app must NOT white-screen on corrupt / hostile
 * localStorage.
 *
 * A brand-new or returning visitor can arrive with garbage in localStorage:
 *   - the persisted DB blob (chesstrophies_db_v1) is invalid JSON (a half-written
 *     write, a manual edit, a different app on the same origin, a truncated value);
 *   - the session blob (chesstrophies_session_v1) is invalid JSON;
 *   - storage is effectively read-only / over quota, so writes throw
 *     (Safari private mode, a full origin) — saveDB / setItem must not crash boot.
 *
 * ct-auth.js loadDB()/getSession() already JSON.parse inside try/catch and
 * saveDB() swallows quota errors; ct-onerror.js is the global safety net. This
 * test PROVES that contract end-to-end in a real browser: it serves the REAL
 * client and, for each hostile-storage scenario, asserts the app still BOOTS
 * (window.CT present, the auth/lobby UI rendered — i.e. NOT a white screen) with
 * no fatal page error.
 *
 * Run:   node test/localstorage-recovery.mjs   (exit 0 = PASS, non-zero = FAIL)
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
const log = (...a) => console.log('[localstorage-recovery]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

const DB_KEY = 'chesstrophies_db_v1';
const SESSION_KEY = 'chesstrophies_session_v1';

async function main() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    // Same-origin API stubs so the offline boot doesn't hang on the backend.
    if (p === '/api/guest') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ username: 'BraveGuest', isGuest: true, activeGuests: 1 })); return; }
    if (p.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return; }
    fs.readFile(file, (e, d) => {
      if (e) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d);
    });
  });
  const port = await new Promise(r => srv.listen(0, () => r(srv.address().port)));
  const BASE = `http://localhost:${port}`;
  log(`client served at ${BASE}`);

  const browser = await chromium.launch();
  try {
    // Each scenario installs a hostile-storage init script BEFORE any app code,
    // loads the app, and asserts a clean boot (no white screen).
    async function scenario(name, initFn) {
      const ctx = await browser.newContext();
      await ctx.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.origin === BASE) return route.continue();
        if (/socket\.io/.test(u.href)) return route.fulfill({ contentType: 'application/javascript', body: 'window.io=function(){return {on(){},emit(){},close(){},io:{on(){}}}};' });
        return route.fulfill({ status: 200, body: '' });
      });
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));
      // Install the corruption on the page's origin BEFORE the document scripts run.
      await page.addInitScript(initFn);

      await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });

      // The app booted if window.CT is wired up. A white-screen / fatal parse
      // error would leave CT undefined and this would time out.
      await page.waitForFunction(() => window.CT && typeof window.CT.showScreen === 'function', { timeout: 15000 })
        .catch(() => fail(`[${name}] app did NOT boot (window.CT missing) — white screen on hostile storage`));

      // And there must be VISIBLE UI (an active screen or the auth screen), not a
      // blank body. Either screen-auth or screen-lobby should be active.
      const ui = await page.evaluate(() => {
        const active = document.querySelector('.screen.active');
        const auth = document.getElementById('screen-auth');
        const bodyText = (document.body && document.body.innerText || '').trim().length;
        return { hasActive: !!active, activeId: active && active.id, hasAuth: !!auth, bodyText };
      });
      assert(ui.hasActive || ui.hasAuth, `[${name}] no visible screen rendered (white screen)`);
      assert(ui.bodyText > 0, `[${name}] body has no visible text (white screen)`);

      // loadDB() must return a USABLE default db despite the corruption, never throw.
      const dbOk = await page.evaluate(() => {
        try { const db = window.CT.loadDB(); return !!(db && typeof db === 'object' && db.users && typeof db.users === 'object'); }
        catch (e) { return false; }
      });
      assert(dbOk, `[${name}] CT.loadDB() did not recover to a usable default db`);

      // No fatal page error should have escaped (ct-onerror logs but the page lives).
      assert(pageErrors.length === 0, `[${name}] fatal page error(s):\n${pageErrors.join('\n')}`);

      log(`[${name}] booted cleanly to ${ui.activeId || 'screen-auth'} (loadDB recovered) ✓`);
      await ctx.close();
    }

    // 1) Corrupt DB blob — invalid JSON.
    await scenario('corrupt-db-json', () => {
      try { localStorage.setItem('chesstrophies_db_v1', '{ this is : not, valid json ]['); } catch (e) {}
    });

    // 2) Corrupt session blob — invalid JSON.
    await scenario('corrupt-session-json', () => {
      try {
        localStorage.setItem('chesstrophies_session_v1', '%%%not-json%%%');
        sessionStorage.setItem('chesstrophies_session_v1', '<<broken>>');
      } catch (e) {}
    });

    // 3) DB blob is the wrong SHAPE (valid JSON, but not the expected object).
    await scenario('wrong-shape-db', () => {
      try { localStorage.setItem('chesstrophies_db_v1', '[1,2,3]'); } catch (e) {}
    });

    // 4) Over-quota / read-only storage: setItem throws on every write. The app
    //    must still boot (saveDB swallows the error). We monkey-patch setItem to
    //    throw a QuotaExceededError, after planting a corrupt DB to exercise the
    //    read path too.
    await scenario('quota-exceeded-writes', () => {
      try { localStorage.setItem('chesstrophies_db_v1', '{bad'); } catch (e) {}
      try {
        const proto = Object.getPrototypeOf(window.localStorage);
        proto.setItem = function () { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
      } catch (e) {}
    });

    log('PASS — app boots without white-screen on corrupt/over-quota localStorage (graceful recovery)');
    return 0;
  } finally {
    try { await browser.close(); } catch {}
    try { await new Promise(r => srv.close(r)); } catch {}
  }
}
main().then(code => process.exit(code ?? 0)).catch(err => { console.error('[localstorage-recovery] FAIL:', err.message); process.exit(1); });
