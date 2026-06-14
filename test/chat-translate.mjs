#!/usr/bin/env node
/*
 * chat-translate.mjs — end-to-end test for NETWORKED in-game chat + the
 * auto-translation proxy.
 *
 * Until now the in-game chat was localStorage-only (messages never reached the
 * opponent — the client never wired the server `chat` socket handler). This test
 * boots the REAL backend on a throwaway SQLite DB + ephemeral port, matches two
 * humans in a casual 1v1, and asserts:
 *
 *   1) DELIVERY — A emits `chat` and BOTH players receive it (server echoes to the
 *      whole game room) with the enriched shape { gameId, from, name, text, lang, at }.
 *   2) SANITIZATION — angle brackets/control chars are stripped from text; the lang
 *      code is reduced to letters/hyphen.
 *   3) PARTICIPANT GUARD — a signed-in user who is NOT in the game cannot inject
 *      chat into its room (the opponent receives nothing).
 *   4) TRANSLATE PROXY — POST /api/translate degrades GRACEFULLY when no upstream
 *      is configured ({ translated:false, disabled:true, translatedText:q }),
 *      no-ops when source===target, requires auth, and validates input.
 *
 * Run:   node test/chat-translate.mjs   (exit 0 = PASS)
 * Needs: server deps installed (cd server && npm i) incl. socket.io-client.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[chat-translate]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

const serverRequire = createRequire(path.join(SERVER_DIR, 'package.json'));
const CLIENT_PKG = pathToFileURL(serverRequire.resolve('socket.io-client')).href;

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function waitForHealth(url, t = 15000) {
  const end = Date.now() + t;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  fail('health timeout');
}
function once(sock, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { sock.off(event, h); reject(new Error(`timeout waiting for "${event}"`)); }, timeoutMs);
    const h = (data) => { clearTimeout(t); resolve(data); };
    sock.once(event, h);
  });
}
// Resolve to the first matching event within the window, or null on timeout
// (used for the negative "should NOT arrive" assertion).
function maybe(sock, event, pred, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { sock.off(event, h); resolve(null); }, timeoutMs);
    const h = (data) => { if (pred && !pred(data)) return; clearTimeout(t); sock.off(event, h); resolve(data); };
    sock.on(event, h);
  });
}

async function bootServer(port, dbPath, extraEnv) {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', ...extraEnv },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errOut = '';
  proc.stderr.on('data', d => { errOut += d; });
  proc.on('exit', c => { if (c) log('server exited', c, errOut); });
  await waitForHealth(`http://localhost:${port}/health`);
  return proc;
}
async function killServer(proc) {
  if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
}
function rmDb(dbPath) {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} }
}

async function main() {
  const { io } = await import(CLIENT_PKG);
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-chat-${process.pid}-${port}.db`);
  const post = (p, body, token) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  const get = (p, token) => fetch(`${BASE}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const sockets = [];
  const mkSock = () => { const s = io(BASE, { transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
  let proc;

  try {
    proc = await bootServer(port, dbPath, {});
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-5);
    async function signup(tag) {
      const r = await post('/api/auth/signup', { email: `${tag}${RUN}@ct.local`, username: `${tag}${RUN}`, password: 'passw0rd', region: 'Test' });
      assert(r.ok, `signup ${tag} failed: ${r.status}`);
      const token = (await r.json()).token;
      const me = await (await get('/api/me', token)).json();
      return { token, id: me.id, username: me.username };
    }
    const a = await signup('A');
    const b = await signup('B');
    const c = await signup('C'); // a third user, NOT in the game
    log(`signed up ${a.username}, ${b.username}, ${c.username}`);

    const sa = mkSock(); await once(sa, 'connect'); sa.emit('auth', { token: a.token }); await once(sa, 'auth_ok');
    const sb = mkSock(); await once(sb, 'connect'); sb.emit('auth', { token: b.token }); await once(sb, 'auth_ok');
    const sc = mkSock(); await once(sc, 'connect'); sc.emit('auth', { token: c.token }); await once(sc, 'auth_ok');
    log('three sockets authenticated');

    // Match A + B in a casual 1v1.
    const matchA = once(sa, 'match_found', 10000);
    const matchB = once(sb, 'match_found', 10000);
    sa.emit('mm_join', { mode: 'casual' });
    sb.emit('mm_join', { mode: 'casual' });
    const [mA, mB] = await Promise.all([matchA, matchB]);
    assert(mA && mA.gameId && mA.gameId === mB.gameId, 'A and B should be in the SAME game');
    const gameId = mA.gameId;
    log(`matched game ${gameId}`);

    // === 1) DELIVERY: A's message reaches BOTH players with the enriched shape. ==
    const gotA = once(sa, 'chat', 6000);
    const gotB = once(sb, 'chat', 6000);
    sa.emit('chat', { gameId, text: 'Hola, buena suerte', lang: 'es', name: a.username });
    const [cA, cB] = await Promise.all([gotA, gotB]);
    for (const [who, msg] of [['A', cA], ['B', cB]]) {
      assert(msg && msg.gameId === gameId, `${who} chat should carry gameId`);
      assert(msg.from === a.id, `${who} chat 'from' should be A's id`);
      assert(msg.text === 'Hola, buena suerte', `${who} chat text wrong: ${msg.text}`);
      assert(msg.lang === 'es', `${who} chat lang should be 'es', got ${msg.lang}`);
      assert(msg.name === a.username, `${who} chat name should be A's username`);
      assert(typeof msg.at === 'number', `${who} chat should have a timestamp`);
    }
    log('delivery: A → both players receive { gameId, from, name, text, lang, at } ✓');

    // === 2) SANITIZATION: angle brackets/control chars stripped, lang cleaned. ===
    const gotB2 = once(sb, 'chat', 6000);
    sb.emit('chat', { gameId, text: 'hi <script>x</script> there', lang: 'EN-us!!@#', name: '<b>B</b>' });
    const c2 = await gotB2;
    assert(!/[<>]/.test(c2.text), `text should have no angle brackets, got: ${c2.text}`);
    assert(![...c2.text].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127), 'text should have no control chars');
    assert(/^[a-zA-Z-]+$/.test(c2.lang), `lang should be letters/hyphen only, got: ${c2.lang}`);
    assert(!/[<>]/.test(c2.name), 'name should be sanitized');
    log(`sanitization: text="${c2.text}" lang="${c2.lang}" name="${c2.name}" ✓`);

    // === 3) PARTICIPANT GUARD: outsider C cannot inject chat into the game room. ==
    const leak = maybe(sb, 'chat', (d) => d && d.from === c.id, 1500);
    sc.emit('chat', { gameId, text: 'I should not be here', lang: 'en', name: c.username });
    const leaked = await leak;
    assert(leaked === null, 'a non-participant must NOT be able to post to the game chat');
    log('guard: a non-participant cannot inject chat into the game room ✓');

    // === 4) POST-GAME "gg": chat still reaches the opponent after the game ends. =
    const goA = once(sa, 'game_over', 8000);
    const goB = once(sb, 'game_over', 8000);
    sa.emit('resign', { gameId });
    await Promise.all([goA, goB]);
    const ggB = once(sb, 'chat', 6000);
    sa.emit('chat', { gameId, text: 'gg wp', lang: 'en', name: a.username });
    const gg = await ggB;
    assert(gg && gg.from === a.id && gg.text === 'gg wp', `post-game "gg" should still reach the opponent, got ${JSON.stringify(gg)}`);
    // ...but once the game is gone AND a non-participant tries, still blocked.
    const ggLeak = maybe(sb, 'chat', (d) => d && d.from === c.id, 1200);
    sc.emit('chat', { gameId, text: 'still nope', lang: 'en', name: c.username });
    assert((await ggLeak) === null, 'a non-participant must NOT post to a finished game either');
    log('post-game: "gg" after the result reaches the opponent; outsiders still blocked ✓');

    // === 5) TRANSLATE PROXY: graceful + no-op + auth + validation. ===============
    // Graceful (no LIBRETRANSLATE_URL configured) -> original text, disabled flag.
    const tr = await (await post('/api/translate', { q: 'Hola', source: 'es', target: 'en' }, a.token)).json();
    assert(tr.translatedText === 'Hola' && tr.translated === false && tr.disabled === true,
      `translate should degrade gracefully when unconfigured, got ${JSON.stringify(tr)}`);
    // No-op when source === target.
    const tr2 = await (await post('/api/translate', { q: 'Hi', source: 'en', target: 'en' }, a.token)).json();
    assert(tr2.translated === false && tr2.translatedText === 'Hi', `same-language should be a no-op, got ${JSON.stringify(tr2)}`);
    // Requires auth.
    const trNoAuth = await post('/api/translate', { q: 'Hi', target: 'en' });
    assert(trNoAuth.status === 401, `translate without a token should be 401, got ${trNoAuth.status}`);
    // Validates input (missing target).
    const trBad = await post('/api/translate', { q: 'Hi' }, a.token);
    assert(trBad.status === 400, `translate without a target should be 400, got ${trBad.status}`);
    log('translate: graceful-when-unconfigured + same-lang no-op + auth-gated + validated ✓');

    // === 5) TRANSLATE PROXY (configured): forwards to the upstream + returns it. ==
    // Stand up a mock LibreTranslate that echoes back a recognizable translation,
    // boot a SECOND app server pointed at it, and assert /api/translate forwards.
    const mock = await import('node:http').then(({ default: http }) => new Promise((resolve) => {
      const srv = http.createServer((req, rq2) => {
        let body = '';
        req.on('data', d => { body += d; });
        req.on('end', () => {
          let q = '';
          try { q = JSON.parse(body).q; } catch {}
          rq2.writeHead(200, { 'Content-Type': 'application/json' });
          rq2.end(JSON.stringify({ translatedText: 'TR[' + q + ']', detectedLanguage: { language: 'es' } }));
        });
      });
      srv.listen(0, '127.0.0.1', () => resolve(srv));
    }));
    const mockUrl = `http://127.0.0.1:${mock.address().port}`;
    const port2 = await freePort();
    const db2 = path.join(os.tmpdir(), `ct-chat2-${process.pid}-${port2}.db`);
    const proc2 = await bootServer(port2, db2, { LIBRETRANSLATE_URL: mockUrl });
    try {
      const r2 = await fetch(`http://localhost:${port2}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `T${RUN}@ct.local`, username: `T${RUN}`, password: 'passw0rd', region: 'Test' }) });
      const tok = (await r2.json()).token;
      const tr3 = await (await fetch(`http://localhost:${port2}/api/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ q: 'Hola', source: 'es', target: 'en' }) })).json();
      assert(tr3.translated === true && tr3.translatedText === 'TR[Hola]', `configured proxy should forward to upstream, got ${JSON.stringify(tr3)}`);
      log(`translate (configured): proxies to upstream and returns "${tr3.translatedText}" ✓`);
    } finally {
      await killServer(proc2); rmDb(db2);
      await new Promise(r => mock.close(r));
    }

    log('PASS — in-game chat is networked (reaches the opponent), sanitized, participant-guarded; translate proxy is graceful AND forwards when configured');
    return 0;
  } finally {
    for (const s of sockets) { try { s.disconnect(); } catch {} }
    await killServer(proc);
    rmDb(dbPath);
  }
}

main().then(code => process.exit(code ?? 0)).catch(err => { console.error('[chat-translate] FAIL:', err.message); process.exit(1); });
