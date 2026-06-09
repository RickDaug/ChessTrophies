#!/usr/bin/env node
/*
 * push.mjs — tests for the Web Push re-engagement backend.
 *
 * NO real push network calls, and web-push need NOT be installed (the SDK is
 * imported lazily in a try/catch, so the server boots without it). Three parts:
 *
 *   1) Integration: mount the REAL push routes (push.js -> mountPush) on a
 *      minimal express app over a throwaway SQLite DB, with NO VAPID env vars,
 *      and prove the feature is inert —
 *        - GET  /api/push/config        -> { enabled:false, publicKey:null }
 *        - POST /api/push/subscribe      (no auth)   -> 401
 *        - POST /api/push/subscribe      (authed)    -> 503 (unconfigured)
 *      Mounting the real push.js (which lazy-imports web-push only inside
 *      sendPushToUser) also confirms importing it never pulls in web-push at
 *      module load — so the server boots fine with web-push NOT installed.
 *      We mount in-process (rather than editing server.js, which the main loop
 *      wires) so the routes are exercised exactly as server.js will run them.
 *
 *   2) Store facade: import store.js (SQLite path) and exercise the push data
 *      layer — addPushSub is IDEMPOTENT on endpoint (same endpoint twice = 1
 *      row), listPushSubs reflects it, removeDeadSub / removePushSub prune.
 *
 *   3) sendPushToUser is a SAFE NO-OP when disabled (resolves { disabled:true },
 *      never throws), even with subs present.
 *
 * Run:  node test/push.mjs   (exit 0 = PASS, 1 = FAIL)
 */
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[push]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
function rmDb(p) {
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch {} } }
}
function importFrom(file) {
  const url = new URL(`file://${path.join(SERVER_DIR, file).replace(/\\/g, '/')}`);
  return import(url.href);
}

// --- Part 1: integration (feature inert with no VAPID env) ------------------
// Mount the REAL push routes on a minimal express app (same wiring server.js
// uses) over a throwaway SQLite DB, with no VAPID env. The express dep lives in
// server/node_modules, so we import it from there.
async function testInertWhenUnconfigured(dbPath) {
  // Make sure push is OFF for this part.
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT;
  process.env.DATABASE_PATH = dbPath;

  const expressMod = await importFrom('node_modules/express/index.js');
  const express = expressMod.default || expressMod;
  const auth = await importFrom('auth.js');
  const push = await importFrom('push.js');

  const app = express();
  app.use(express.json());
  push.mountPush(app);

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, headers = {}) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });

  try {
    // Importing push.js must NOT have pulled in web-push (lazy import contract).
    assert(push.pushEnabled() === false, 'pushEnabled() should be false with no VAPID env');
    log('push.js imports cleanly without web-push installed (lazy import) ✓');

    // /api/push/config is PUBLIC and reports disabled.
    const cfgRes = await fetch(`${BASE}/api/push/config`);
    assert(cfgRes.ok, `push/config failed: ${cfgRes.status}`);
    const cfg = await cfgRes.json();
    assert(cfg.enabled === false, `config.enabled should be false, got ${cfg.enabled}`);
    assert(cfg.publicKey === null, `config.publicKey should be null, got ${cfg.publicKey}`);
    log('GET /api/push/config -> { enabled:false, publicKey:null } ✓');

    // Mint a real JWT for an authed request (mirrors a signed-in user).
    const uid = 'u_push_auth_' + Math.random().toString(36).slice(2, 8);
    const db = await importFrom('db.js');
    db.createUser({ id: uid, email: `${uid}@push.local`, username: uid.slice(0, 18), region: '', pw_hash: 'x' });
    const token = auth.makeToken ? auth.makeToken(uid) : null;
    assert(token, 'auth.makeToken should mint a token');

    // subscribe requires auth: no token -> 401.
    const noAuth = await post('/api/push/subscribe', { subscription: { endpoint: 'https://x/y', keys: { p256dh: 'a', auth: 'b' } } });
    assert(noAuth.status === 401, `subscribe without auth should be 401, got ${noAuth.status}`);

    // subscribe with auth but push OFF -> 503.
    const sub = await post('/api/push/subscribe',
      { subscription: { endpoint: 'https://x/y', keys: { p256dh: 'a', auth: 'b' } } },
      { Authorization: `Bearer ${token}` });
    assert(sub.status === 503, `subscribe should be 503 when unconfigured, got ${sub.status}`);
    const subBody = await sub.json();
    assert(/not configured/i.test(subBody.error || ''), `503 should explain not configured, got ${JSON.stringify(subBody)}`);
    log('POST /api/push/subscribe -> 401 (no auth) / 503 (unconfigured) ✓');

    // unsubscribe + test also 503 when unconfigured.
    const unsub = await post('/api/push/unsubscribe', { endpoint: 'https://x/y' }, { Authorization: `Bearer ${token}` });
    assert(unsub.status === 503, `unsubscribe should be 503 when unconfigured, got ${unsub.status}`);
    const test = await post('/api/push/test', {}, { Authorization: `Bearer ${token}` });
    assert(test.status === 503, `test should be 503 when unconfigured, got ${test.status}`);
    log('POST /api/push/unsubscribe + /api/push/test -> 503 when unconfigured ✓');
  } finally {
    await new Promise(r => server.close(r));
  }
}

// --- Part 2 + 3: store facade idempotency + sendPushToUser no-op ------------
// Shares the same throwaway DB (set in Part 1) so the db.js module-cached handle
// is reused. Push stays DISABLED for the no-op assertion.
async function testStoreLayerAndNoop() {
  const store = await importFrom('store.js');
  const db = await importFrom('db.js');
  const push = await importFrom('push.js');
  let closed = false;
  try {
    // Seed a user (push_subscriptions has no FK, but a real user keeps it honest).
    const uid = 'u_push_' + Math.random().toString(36).slice(2, 8);
    db.createUser({ id: uid, email: `${uid}@unit.local`, username: uid, region: '', pw_hash: 'x' });

    const endpoint = 'https://push.example/abc123';
    // Idempotency: same endpoint twice -> ONE row.
    await store.addPushSub({ userId: uid, endpoint, p256dh: 'KEY1', auth: 'AUTH1' });
    await store.addPushSub({ userId: uid, endpoint, p256dh: 'KEY2', auth: 'AUTH2' }); // upsert
    let subs = await store.listPushSubs(uid);
    assert(subs.length === 1, `same endpoint twice should yield ONE row, got ${subs.length}`);
    assert(subs[0].endpoint === endpoint, 'listPushSubs should reflect the endpoint');
    assert(subs[0].p256dh === 'KEY2' && subs[0].auth === 'AUTH2', 'upsert should refresh the keys');
    log('addPushSub is idempotent on endpoint + listPushSubs reflects it (upsert) ✓');

    // A second distinct endpoint -> two rows.
    await store.addPushSub({ userId: uid, endpoint: endpoint + '-2', p256dh: 'K', auth: 'A' });
    subs = await store.listPushSubs(uid);
    assert(subs.length === 2, `a distinct endpoint should add a row, got ${subs.length}`);
    log('a distinct endpoint adds a separate row ✓');

    // removeDeadSub prunes by endpoint (the 404/410 path).
    await store.removeDeadSub(endpoint + '-2');
    subs = await store.listPushSubs(uid);
    assert(subs.length === 1, `removeDeadSub should prune one, got ${subs.length}`);
    // removePushSub (user-scoped) prunes the rest.
    await store.removePushSub(uid, endpoint);
    subs = await store.listPushSubs(uid);
    assert(subs.length === 0, `removePushSub should prune the last, got ${subs.length}`);
    log('removeDeadSub + removePushSub prune correctly ✓');

    // pushEnabled() is false when unconfigured.
    assert(push.pushEnabled() === false, 'pushEnabled() should be false with no VAPID env');

    // sendPushToUser is a SAFE NO-OP when disabled — even with a sub present.
    await store.addPushSub({ userId: uid, endpoint: endpoint + '-noop', p256dh: 'K', auth: 'A' });
    const r = await push.sendPushToUser(uid, { title: 'x', body: 'y' });
    assert(r && r.disabled === true, `sendPushToUser should report disabled, got ${JSON.stringify(r)}`);
    assert(r.sent === 0, `sendPushToUser should send 0 when disabled, got ${r.sent}`);
    log('sendPushToUser is a safe no-op (disabled, never throws) when unconfigured ✓');

    db.db.close();
    closed = true;
  } finally {
    if (!closed) { try { (await importFrom('db.js')).db.close(); } catch {} }
  }
}

async function main() {
  const dbPath = path.join(os.tmpdir(), `ct-push-${process.pid}-${Date.now().toString(36)}.db`);
  try {
    await testInertWhenUnconfigured(dbPath);
    await testStoreLayerAndNoop();
    log('PASS — push feature inert + boots without web-push; store idempotent on endpoint; sendPushToUser safe no-op when disabled');
    return 0;
  } finally {
    rmDb(dbPath);
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[push] FAIL:', e.message); process.exit(1); });
