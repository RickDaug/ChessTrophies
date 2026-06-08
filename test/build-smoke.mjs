#!/usr/bin/env node
/*
 * build-smoke.mjs — mandatory verification gate for the production build.
 *
 * Runs scripts/build.mjs, serves the resulting dist/ over http WITHOUT
 * stripping the CSP, stubs cross-origin requests (socket.io CDN, fonts) like
 * test/review-eval.mjs, opens dist/ in Playwright Chromium and asserts:
 *   - the app BOOTS from the minified bundle (window.CT, window.Chess,
 *     window.CT_AI, window.CT_reviewGame all present);
 *   - ZERO securitypolicyviolation with a script-src directive (listener
 *     installed before load), and zero page errors / "Refused to" console errors;
 *   - core flows work on the BUILT output: guest "Play now" -> lobby renders;
 *     Practice vs Computer + play one move (e2-e4); Game Review -> accuracy %;
 *   - the Web Worker path doesn't error (an AI move exercises ct-ai-worker.js
 *     -> importScripts of dist/ct-ai.js + chess960.js).
 *
 * Run:   node test/build-smoke.mjs        Exit 0 = PASS, non-zero = FAIL.
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

const log = (...a) => console.log('[build-smoke]', ...a);
const fail = (msg) => { throw new Error(msg); };
const assert = (cond, msg) => { if (!cond) fail(msg); };

async function main() {
  // 1) Build fresh.
  log('running build: node scripts/build.mjs');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stdout, b.stderr); fail('scripts/build.mjs exited non-zero'); }
  process.stdout.write(b.stdout);
  assert(fs.existsSync(path.join(DIST, 'index.html')), 'dist/index.html missing after build');
  assert(fs.existsSync(path.join(DIST, 'app.bundle.js')), 'dist/app.bundle.js missing after build');
  assert(fs.existsSync(path.join(DIST, 'ct-ai.js')), 'dist/ct-ai.js missing (worker importScripts needs it)');
  assert(fs.existsSync(path.join(DIST, 'chess960.js')), 'dist/chess960.js missing (worker importScripts needs it)');

  // 2) Serve dist/ WITH the CSP intact. Only the cross-origin stubs below let
  //    the test run offline; the app code + CSP under test are unchanged.
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    // The dist/ bundle is static (no backend); the real deploy serves /api/ from
    // the Railway server. Stub the few backend endpoints the boot flow hits so the
    // built client runs end-to-end without a 404 (matches the live API shape).
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
  const cspViolations = [];
  try {
    const ctx = await browser.newContext();
    // Stub cross-origin (socket.io CDN, Google fonts) — same shape as review-eval.
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.origin === BASE) return route.continue();
      if (/socket\.io/.test(u.href)) return route.fulfill({ contentType: 'application/javascript', body: 'window.io=function(){return {on(){},emit(){},close(){}}};' });
      return route.fulfill({ status: 200, body: '' });
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e));
    page.on('console', m => {
      if (m.type() === 'error') {
        const t = m.text();
        errors.push('console: ' + t);
        if (/Refused to/i.test(t)) cspViolations.push('console-refused: ' + t);
      }
    });

    // Install the securitypolicyviolation listener BEFORE any script loads.
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations.push({ directive: e.violatedDirective, blocked: e.blockedURI, src: e.sourceFile });
      });
    });

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });

    // 3) App boots from the minified bundle.
    await page.waitForFunction(
      () => window.CT && window.Chess && window.CT_AI && window.CT_AI.chooseMove && window.CT_reviewGame,
      { timeout: 15000 }
    ).catch(() => fail('app did not boot from minified bundle (CT / Chess / CT_AI / CT_reviewGame missing)'));
    log('app booted from minified dist bundle — CT, Chess, CT_AI, CT_reviewGame present');

    // CSP gate: zero script-src violations.
    const v = await page.evaluate(() => window.__cspViolations || []);
    const scriptViolations = v.filter(x => /script-src/i.test(x.directive || ''));
    cspViolations.push(...scriptViolations.map(x => JSON.stringify(x)));
    assert(scriptViolations.length === 0, 'script-src CSP violations:\n' + JSON.stringify(scriptViolations, null, 2));
    log(`CSP ok — 0 script-src violations (${v.length} total CSP events, all non-script if any)`);

    // 4a) Guest enters via "Continue as guest" -> lobby renders. (NOTE: "Play now"
    //     now drops a guest straight into a Practice game by design, so it can't be
    //     used as the lobby-entry step; "Continue as guest" is the lobby path.)
    await page.click('#btn-continue-guest');
    await page.waitForFunction(() => {
      const l = document.getElementById('screen-lobby');
      return l && l.classList.contains('active');
    }, { timeout: 10000 }).catch(() => fail('guest "Continue as guest" did not render the lobby'));
    log('guest "Continue as guest" -> lobby rendered');

    // 4b) Start Practice vs Computer. NOTE: in guest practice the user's color is
    //     randomized — if the user is Black, the AI (white) opens first, which
    //     already exercises the Web Worker. We drive the move color-agnostically.
    await page.click('#btn-start-practice');
    await page.waitForFunction(() => {
      const g = document.getElementById('screen-game');
      const s = window.CT && window.CT.state;
      return g && g.classList.contains('active') && document.querySelectorAll('#board .sq').length === 64
        && s && s.game && s.opponent && s.opponent.isAI;
    }, { timeout: 10000 }).catch(() => fail('Practice vs Computer did not start / board not rendered'));
    const hasDataSq = await page.evaluate(() => !!document.querySelector('#board .sq[data-sq]'));
    assert(hasDataSq, 'board squares missing data-sq — selector assumption wrong');
    const userColor = await page.evaluate(() => window.CT.state.userColor);
    log(`Practice vs Computer started — board rendered (user plays ${userColor === 'w' ? 'White' : 'Black'})`);

    // 4c) Web Worker path: if the AI moves first (user is Black) OR replies after
    //     our move, ct-ai-worker.js runs importScripts(dist/ct-ai.js + chess960.js).
    //     First, wait until it's the user's turn (covers AI-opens-first).
    await page.waitForFunction(() => {
      const s = window.CT && window.CT.state;
      return s && s.game && !s.aiThinking && !s.animatingMove && s.game.turn() === s.userColor;
    }, { timeout: 20000 }).catch(() => fail('never reached the user\'s turn (AI worker may have failed to open)'));

    // Pick a real legal move for the user and play it via two square clicks.
    const mv = await page.evaluate(() => {
      const g = window.CT.state.game;
      const m = g.moves({ verbose: true }).find(x => !x.promotion) || g.moves({ verbose: true })[0];
      return m ? { from: m.from, to: m.to, san: m.san } : null;
    });
    assert(mv, 'no legal move available for the user');
    await page.click(`#board .sq[data-sq="${mv.from}"]`);
    await page.click(`#board .sq[data-sq="${mv.to}"]`);
    // Confirm the move registered: the game FEN advanced past the user's move
    // (turn flips to the opponent or AI starts thinking).
    await page.waitForFunction((from) => {
      const s = window.CT && window.CT.state;
      if (!s || !s.game) return false;
      // The from-square should no longer hold the user's piece, OR it's now the
      // AI's turn / the AI is thinking (move accepted, worker invoked).
      const movedAway = !s.game.get(from);
      return movedAway || s.aiThinking || s.game.turn() !== s.userColor;
    }, mv.from, { timeout: 8000 }).catch(() => fail(`human move ${mv.san} did not register on the built board`));
    log(`played user move ${mv.san} on the built board`);

    // Now wait for the AI to reply via the Web Worker and control to return to us.
    await page.waitForFunction(() => {
      const s = window.CT && window.CT.state;
      return s && s.game && (s.game.game_over() || (!s.aiThinking && !s.animatingMove && s.game.turn() === s.userColor));
    }, { timeout: 20000 }).catch(() => fail('AI (worker) never replied — ct-ai-worker.js importScripts path likely broke'));
    log('AI replied during practice (control returned to user)');

    // 4c-2) DIRECT worker probe. ct-ai.js silently falls back to a SYNC engine if
    //   the worker errors, which would hide a broken dist worker. So construct the
    //   worker explicitly and assert it RESPONDS with a move and no importScripts
    //   error — this proves dist/ct-ai-worker.js -> importScripts(dist/chess.min.js,
    //   ct-ai.js, chess960.js) actually works in the built output.
    const workerResult = await page.evaluate(() => new Promise((resolve) => {
      try {
        const w = new Worker('ct-ai-worker.js');
        const to = setTimeout(() => resolve({ ok: false, why: 'worker timeout (12s) — importScripts likely failed' }), 12000);
        w.onerror = (e) => { clearTimeout(to); resolve({ ok: false, why: 'worker onerror: ' + (e.message || e.filename || 'unknown') }); };
        w.onmessage = (e) => {
          clearTimeout(to);
          const d = e.data || {};
          if (d.error) resolve({ ok: false, why: 'worker returned error: ' + d.error });
          else resolve({ ok: !!(d.move && d.move.from && d.move.to), move: d.move });
          w.terminate();
        };
        // startpos, ask for a move at 1500 elo.
        w.postMessage({ id: 1, fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', aiElo: 1500 });
      } catch (err) { resolve({ ok: false, why: 'worker construct threw: ' + err.message }); }
    }));
    assert(workerResult.ok, 'Web Worker probe failed: ' + (workerResult.why || JSON.stringify(workerResult)));
    log(`Web Worker probe ok — ct-ai-worker.js returned ${workerResult.move.from}${workerResult.move.to} via importScripts of dist ct-ai.js + chess960.js`);

    // 4d) Game Review produces an accuracy %.
    await page.evaluate(() => {
      const g = new window.Chess();
      ['e4','e5','Bc4','Bc5','Qh5','Nf6','Qxf7'].forEach(m => g.move(m));
      window.CT_reviewGame(g.history({ verbose: true }));
    });
    await page.waitForFunction(() => {
      const s = document.getElementById('rv-status');
      const w = document.getElementById('rv-acc-w');
      return s && s.textContent === '' && w && /%/.test(w.textContent);
    }, { timeout: 20000 }).catch(() => fail('Game Review never produced an accuracy %'));
    const acc = await page.evaluate(() => ({ w: document.getElementById('rv-acc-w').textContent, b: document.getElementById('rv-acc-b').textContent }));
    assert(/%/.test(acc.w) && /%/.test(acc.b), `accuracy not shown: w=${acc.w} b=${acc.b}`);
    log(`Game Review ok — accuracy W ${acc.w} / B ${acc.b}`);

    // Final gates.
    if (cspViolations.length) fail('CSP / Refused errors:\n' + cspViolations.join('\n'));
    if (errors.length) fail('page errors:\n' + errors.join('\n'));

    log('PASS — minified dist/ boots, runs core flows, worker path clean, 0 CSP/script errors');
    return 0;
  } finally {
    try { await browser.close(); } catch {}
    try { await new Promise(r => srv.close(r)); } catch {}
  }
}

main().then(code => process.exit(code ?? 0)).catch(err => { console.error('[build-smoke] FAIL:', err.message); process.exit(1); });
