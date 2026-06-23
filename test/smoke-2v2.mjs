#!/usr/bin/env node
/*
 * smoke-2v2.mjs — end-to-end smoke test for online ranked 2v2.
 *
 * Spins up the REAL backend (server/) against a throwaway SQLite DB, serves the
 * real web client, and drives FOUR isolated browser sessions through:
 *   signup -> socket auth -> join 2v2 queue -> server match -> alternating moves
 * asserting the move stream stays server-authoritative and in sync across all
 * four clients (seat rotation w0 -> b0 -> w1 -> b1).
 *
 * This is the regression guard for the 2026-06-01 JWT-drop bug, which silently
 * broke ALL online play (the socket never connected after login/signup) and was
 * invisible to single-player / REST-only checks.
 *
 * Run:   npm run smoke:2v2
 * Needs: server deps installed (cd server && npm i) and Playwright's Chromium
 *        (npx playwright install chromium). Exits 0 on PASS, 1 on FAIL.
 *
 * Harness-only shims (NO app logic touched): the served index.html CSP
 * connect-src is widened to allow the local backend (the same pattern
 * scripts/refresh-www.sh uses for the Vercel origin), and socket.io's client is
 * served from the local install instead of the CDN. Everything else is the real
 * shipped client + server.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const SIO_PATH = path.join(SERVER_DIR, 'node_modules/socket.io/client-dist/socket.io.min.js');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.css':'text/css' };

const log = (...a) => console.log('[smoke-2v2]', ...a);
const fail = (msg) => { console.error('[smoke-2v2] FAIL:', msg); throw new Error(msg); };

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function waitForHealth(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  fail(`server health check timed out (${url})`);
}

async function main() {
  // Preconditions
  if (!fs.existsSync(SIO_PATH)) fail(`socket.io client not found at ${SIO_PATH} — run \`cd server && npm i\` first`);

  const serverPort = await freePort();
  const SERVER_URL = `http://localhost:${serverPort}`;
  const dbPath = path.join(os.tmpdir(), `ct-smoke-2v2-${process.pid}-${serverPort}.db`);
  const SIO = fs.readFileSync(SIO_PATH, 'utf8');

  let serverProc, clientSrv, browser;
  let serverStderr = '';
  try {
    // 1) Boot the real backend on a throwaway DB.
    log(`starting backend on :${serverPort} (db ${dbPath})`);
    serverProc = spawn(process.execPath, ['server.js'], {
      cwd: SERVER_DIR,
      env: { ...process.env, PORT: String(serverPort), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', RANKED_ENABLED: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    serverProc.stderr.on('data', d => { serverStderr += d.toString(); });
    serverProc.on('exit', (code) => { if (code) log(`backend exited early (code ${code}):\n${serverStderr}`); });
    await waitForHealth(`${SERVER_URL}/health`);
    log('backend healthy');

    // 2) Serve the real client, with CSP widened for the local backend + local socket.io.
    clientSrv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
      if (p === '/index.html') {
        const html = fs.readFileSync(path.join(ROOT, p), 'utf8').replace(
          "connect-src 'self' ", `connect-src 'self' ${SERVER_URL} ws://localhost:${serverPort} `);
        res.writeHead(200, { 'Content-Type':'text/html' }); res.end(html); return;
      }
      fs.readFile(path.join(ROOT, p), (e, d) => {
        if (e) { res.writeHead(404); res.end('nf'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d);
      });
    });
    const clientPort = await new Promise(r => clientSrv.listen(0, () => r(clientSrv.address().port)));
    const CLIENT_URL = `http://localhost:${clientPort}`;
    log(`client served at ${CLIENT_URL}`);

    // 3) Four isolated sessions.
    browser = await chromium.launch();
    const errors = [];
    const pages = [];
    for (let i = 0; i < 4; i++) {
      const ctx = await browser.newContext();
      await ctx.route('**/socket.io.min.js', r => r.fulfill({ contentType:'application/javascript', headers:{ 'Access-Control-Allow-Origin':'*' }, body: SIO }));
      const page = await ctx.newPage();
      await page.addInitScript(url => { window.CT_SERVER_URL = url; }, SERVER_URL);
      page.on('pageerror', e => errors.push(`P${i+1} pageerror: ${e}`));
      page.on('console', m => { if (m.type() === 'error') errors.push(`P${i+1}: ${m.text()}`); });
      pages.push(page);
    }

    const RUN = Date.now().toString(36).slice(-5);
    const usernames = [1,2,3,4].map(n => `T${RUN}_${n}`);
    async function signup(page, n) {
      await page.goto(`${CLIENT_URL}/index.html`, { waitUntil:'domcontentloaded' });
      await page.click('.tab[data-tab="signup"]');
      await page.fill('#signup-email', `t${RUN}_${n}@smoke.local`);
      await page.fill('#signup-username', `T${RUN}_${n}`);
      await page.fill('#signup-password', 'passw0rd');
      await page.fill('#signup-region', 'Smoketown');
      // Skill is now tucked inside an optional <details> (front-door redesign,
      // 2026-06-15), so the <select> is hidden until that disclosure is open.
      // Expand it before selecting, or selectOption times out on a non-visible
      // control (this is what made the smoke test stale).
      await page.locator('#form-signup details').first().evaluate((d) => { d.open = true; });
      await page.selectOption('#signup-skill', '1200');
      await page.click('#form-signup button[type="submit"]');
      await page.waitForSelector('#screen-lobby.active', { timeout: 10000 });
      // The regression guard: only passes if the JWT survives signup and the socket connects.
      await page.waitForFunction(() => window.CTNet && window.CTNet.isReady(), { timeout: 12000 })
        .catch(() => fail(`P${n} socket never authenticated (JWT-drop regression?)`));
    }
    for (let i = 0; i < 4; i++) await signup(pages[i], i + 1);
    log('all 4 signed up + socket-authed');

    // 4) Open the time-control picker on each client. Since 2026-06-04 the picker
    //    offers exactly two controls (one timed + untimed) so a small queue isn't
    //    fragmented across buckets; assert that, then queue all four on the default.
    for (const p of pages) {
      await p.click('#btn-duo-online');
      await p.waitForSelector('#modal-timecontrol.show', { timeout: 8000 })
        .catch(() => fail('time-control picker did not open'));
    }
    const tcKeys = await pages[0].$$eval('#tc-grid .tc-opt', els => els.map(e => e.dataset.tc));
    if (tcKeys.length !== 2) fail(`expected 2 time-control options, got ${tcKeys.length}: ${tcKeys.join(',')}`);
    if (!(tcKeys.includes('10+0') && tcKeys.includes('unlimited')))
      fail(`time-control options should be [10+0, unlimited], got: ${tcKeys.join(',')}`);
    log(`time-control picker shows 2 options: ${tcKeys.join(', ')}`);

    // Queue all four on the default control -> server forms one team game.
    for (const p of pages) await p.click('#btn-tc-start');
    await Promise.all(pages.map((p, i) => p.waitForFunction(
      () => !!(window.__duo && window.__duo.online && window.__duo.game && document.querySelector('#screen-duo.active')),
      { timeout: 20000 }).catch(() => fail(`P${i+1} never entered a team game`))));

    const seats = await Promise.all(pages.map(async (p, i) => ({
      page: i, user: usernames[i], ...(await p.evaluate(() => ({
        gameId: window.__duo.gameId, youColor: window.__duo.youColor,
        youSeat: window.__duo.youSeat, fen: window.__duo.game.fen(),
      }))),
    })));
    if (new Set(seats.map(s => s.gameId)).size !== 1) fail('clients landed in different games: ' + JSON.stringify(seats.map(s => s.gameId)));
    if (new Set(seats.map(s => s.fen)).size !== 1) fail('clients disagree on start position');
    const sideSeat = seats.map(s => `${s.youColor}${s.youSeat}`).sort().join(',');
    if (sideSeat !== 'b0,b1,w0,w1') fail('seat assignment is not a valid 2-per-team split: ' + sideSeat);
    log(`matched into ${seats[0].gameId}; seats ${sideSeat}`);

    // 5) Drive 4 moves (w0 -> b0 -> w1 -> b1); each must sync to all four clients.
    let prevFen = seats[0].fen;
    for (let k = 0; k < 4; k++) {
      const st = await pages[0].evaluate(() => {
        const d = window.__duo; const fen = d.game.fen();
        return { turn: fen.split(' ')[1], turnCount: { w: d.turnCount.w, b: d.turnCount.b } };
      });
      const seat = st.turnCount[st.turn] % 2;
      const idx = seats.findIndex(s => s.youColor === st.turn && s.youSeat === seat);
      if (idx < 0) fail(`no client owns ${st.turn}/seat${seat}`);
      const ap = pages[idx];
      const mv = await ap.evaluate(() => { const m = window.__duo.game.moves({ verbose:true })[0]; return m ? { from:m.from, to:m.to, san:m.san } : null; });
      if (!mv) fail('no legal move available');
      await ap.click(`#duo-board .sq[data-sq="${mv.from}"]`);
      await ap.click(`#duo-board .sq[data-sq="${mv.to}"]`);
      await Promise.all(pages.map(p => p.waitForFunction(f => window.__duo.game.fen() !== f, prevFen, { timeout: 8000 })))
        .catch(() => fail(`move ${k+1} (${mv.san}) did not propagate to all clients`));
      const fens = await Promise.all(pages.map(p => p.evaluate(() => window.__duo.game.fen())));
      if (new Set(fens).size !== 1) fail(`move ${k+1} desynced clients`);
      log(`move ${k+1}: ${seats[idx].user} (${st.turn}/seat${seat}) ${mv.san} — synced to all 4`);
      prevFen = fens[0];
    }

    if (errors.length) fail('client console/page errors:\n' + errors.join('\n'));

    log('PASS — online 2v2 matchmaking + server-authoritative move sync verified across 4 clients');
    return 0;
  } finally {
    try { if (browser) await browser.close(); } catch {}
    try { if (clientSrv) await new Promise(r => clientSrv.close(r)); } catch {}
    // Wait for the backend to actually exit so Windows releases the SQLite file
    // handle before we delete the throwaway DB.
    if (serverProc && serverProc.exitCode === null) {
      await new Promise(res => { serverProc.once('exit', res); try { serverProc.kill(); } catch { res(); } setTimeout(res, 3000); });
    }
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      for (let i = 0; i < 6; i++) {
        try { fs.rmSync(f, { force: true }); break; }
        catch { await new Promise(r => setTimeout(r, 250)); }
      }
    }
  }
}

main().then(code => process.exit(code ?? 0)).catch(err => { console.error('[smoke-2v2]', err.message); process.exit(1); });
