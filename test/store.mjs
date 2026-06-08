#!/usr/bin/env node
/*
 * store.mjs — tests for the cosmetic STORE (one-time piece-set purchases +
 * entitlements). NO real Stripe network calls.
 *
 * Part 1 (integration): boot the REAL backend on a throwaway SQLite DB with a
 *   DUMMY STRIPE_SECRET_KEY but NO per-set price env vars, so every set is
 *   `comingSoon` (preview-only). Assert:
 *     - GET  /api/store/catalog (unauth) -> 19 sets, all owned:false, all comingSoon
 *     - POST /api/store/checkout (no auth) -> 401
 *     - POST /api/store/checkout (authed, unknown sku) -> 400
 *     - POST /api/store/checkout (authed, real-but-comingSoon sku) -> 400
 *     - /api/me ownedSets is [] for a fresh user
 *
 * Part 2 (unit): import SQLite db.js directly (throwaway DATABASE_PATH) and
 *   exercise the entitlements data layer:
 *     - grantEntitlement is idempotent (same user+sku twice = ONE row, true then false)
 *     - userOwnsSku reflects the grant; a different sku is not owned
 *     - listUserSkus returns the granted skus
 *     - revokeEntitlement removes ownership
 *
 * Run:  node test/store.mjs   (exit 0 = PASS, 1 = FAIL)
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[store]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function waitForHealth(url, t = 15000) {
  const end = Date.now() + t;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  fail('health timeout');
}
function rmDb(p) {
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch {} } }
}

// --- Part 1: integration (catalog + checkout validation) --------------------
async function testCatalogAndCheckout() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-store-int-${process.pid}-${port}.db`);
  const post = (p, body, headers = {}) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });

  let proc, errOut = '';
  try {
    // Dummy secret key so stripeConfigured() is TRUE (so checkout validates the
    // sku and returns 400 rather than short-circuiting 503), but NO per-set
    // price env vars, so every real set stays comingSoon -> a valid sku never
    // reaches a real Stripe call. Strip the subscription price too.
    const env = { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development', STRIPE_SECRET_KEY: 'sk_test_dummy_for_store_tests' };
    delete env.STRIPE_PRICE_ID; delete env.STRIPE_WEBHOOK_SECRET; delete env.STRIPE_PUBLISHABLE_KEY;
    // Defensively strip any per-set price env that might be inherited.
    for (const k of Object.keys(env)) if (k.startsWith('STRIPE_PRICE_SET_')) delete env[k];
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy (dummy Stripe secret, no per-set prices)');

    // Catalog is PUBLIC and returns owned:false for an anonymous caller.
    const catRes = await fetch(`${BASE}/api/store/catalog`);
    assert(catRes.ok, `catalog failed: ${catRes.status}`);
    const cat = await catRes.json();
    assert(Array.isArray(cat) && cat.length === 19, `catalog should list 19 sets, got ${cat && cat.length}`);
    assert(cat.every(p => p.owned === false), 'every set should be owned:false for an anonymous caller');
    assert(cat.every(p => p.comingSoon === true), 'every set should be comingSoon (no per-set price env)');
    assert(cat.every(p => p.priceCents === 299), 'every set should be priced 299 cents');
    const samurai = cat.find(p => p.sku === 'samurai-ninja');
    assert(samurai && samurai.name && samurai.factions && samurai.factions.w && samurai.factions.b, 'sets carry name + factions');
    log('GET /api/store/catalog -> 19 sets, owned:false, comingSoon, $2.99 ✓');

    // Sign up to get a bearer token.
    const RUN = Date.now().toString(36).slice(-5);
    const username = `S${RUN}`;
    const su = await post('/api/auth/signup', { email: `s${RUN}@store.local`, username, password: 'passw0rd' });
    assert(su.ok, `signup failed: ${su.status}`);
    const token = (await su.json()).token;
    assert(typeof token === 'string' && token, 'signup should return a token');
    const authH = { Authorization: `Bearer ${token}` };

    // checkout requires auth.
    const noAuth = await post('/api/store/checkout', { sku: 'samurai-ninja' });
    assert(noAuth.status === 401, `checkout without auth should be 401, got ${noAuth.status}`);

    // unknown sku -> 400.
    const badSku = await post('/api/store/checkout', { sku: 'not-a-real-set' }, authH);
    assert(badSku.status === 400, `unknown sku should be 400, got ${badSku.status}`);

    // missing sku -> 400.
    const noSku = await post('/api/store/checkout', {}, authH);
    assert(noSku.status === 400, `missing sku should be 400, got ${noSku.status}`);

    // real but comingSoon sku -> 400 (not available for purchase yet).
    const comingSoon = await post('/api/store/checkout', { sku: 'samurai-ninja' }, authH);
    assert(comingSoon.status === 400, `comingSoon sku should be 400, got ${comingSoon.status}`);
    const csBody = await comingSoon.json();
    assert(/not available/i.test(csBody.error || ''), `comingSoon 400 should explain unavailability, got ${JSON.stringify(csBody)}`);
    log('POST /api/store/checkout -> 401 unauth, 400 unknown/missing/comingSoon sku ✓');

    // /api/me ownedSets is [] for a fresh user.
    const meRes = await fetch(`${BASE}/api/me`, { headers: authH });
    assert(meRes.ok, `/api/me failed: ${meRes.status}`);
    const me = await meRes.json();
    assert(Array.isArray(me.ownedSets) && me.ownedSets.length === 0, `ownedSets should be [] for a fresh user, got ${JSON.stringify(me.ownedSets)}`);
    log('GET /api/me -> ownedSets:[] for a fresh user ✓');
  } finally {
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    rmDb(dbPath);
  }
}

// --- Part 2: unit-test the SQLite entitlements data layer directly ----------
async function testEntitlementsLayer() {
  const dbPath = path.join(os.tmpdir(), `ct-store-unit-${process.pid}-${Date.now().toString(36)}.db`);
  process.env.DATABASE_PATH = dbPath;
  const dbUrl = new URL(`file://${path.join(SERVER_DIR, 'db.js').replace(/\\/g, '/')}`);
  const db = await import(dbUrl.href);
  try {
    const uid = 'u_store_' + Math.random().toString(36).slice(2, 8);
    const other = 'u_store_' + Math.random().toString(36).slice(2, 8);
    db.createUser({ id: uid, email: `${uid}@unit.local`, username: uid, region: '', pw_hash: 'x' });
    db.createUser({ id: other, email: `${other}@unit.local`, username: other, region: '', pw_hash: 'x' });

    // Fresh user owns nothing.
    assert(db.userOwnsSku(uid, 'samurai-ninja') === false, 'fresh user should not own samurai-ninja');
    assert(db.listUserSkus(uid).length === 0, 'fresh user listUserSkus should be empty');

    // First grant inserts a NEW row (returns true); second grant is a no-op (false).
    const first = db.grantEntitlement(uid, 'samurai-ninja', 'evt_1');
    assert(first === true, 'first grant should insert a new row (true)');
    const second = db.grantEntitlement(uid, 'samurai-ninja', 'evt_2');
    assert(second === false, 'duplicate grant should be a no-op (false)');
    const cntRow = db.db.prepare('SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ? AND sku = ?').get(uid, 'samurai-ninja');
    assert(Number(cntRow.n) === 1, `same user+sku twice should yield ONE row, got ${cntRow.n}`);
    log('grantEntitlement is idempotent on (user_id, sku) ✓');

    // userOwnsSku reflects the grant; a different sku / different user does not.
    assert(db.userOwnsSku(uid, 'samurai-ninja') === true, 'userOwnsSku should be true after grant');
    assert(db.userOwnsSku(uid, 'vikings-saxons') === false, 'unowned sku should be false');
    assert(db.userOwnsSku(other, 'samurai-ninja') === false, 'another user should not own it');
    log('userOwnsSku reflects ownership (scoped to user+sku) ✓');

    // listUserSkus returns all granted skus for the user.
    db.grantEntitlement(uid, 'vikings-saxons', 'evt_3');
    const skus = db.listUserSkus(uid).sort();
    assert(skus.length === 2 && skus[0] === 'samurai-ninja' && skus[1] === 'vikings-saxons', `listUserSkus should return both skus, got ${JSON.stringify(skus)}`);
    assert(db.listUserSkus(other).length === 0, 'other user still owns nothing');
    log('listUserSkus returns the granted skus ✓');

    // grantSetPurchase (the webhook path): atomic grant + payment, both
    // idempotent on the Stripe event id, and it must NEVER flip is_premium.
    db.grantSetPurchase({ userId: uid, sku: 'pirates-navy', eventId: 'evt_wh', amountCents: 299, currency: 'usd' });
    db.grantSetPurchase({ userId: uid, sku: 'pirates-navy', eventId: 'evt_wh', amountCents: 299, currency: 'usd' });
    const entRow = db.db.prepare('SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ? AND sku = ?').get(uid, 'pirates-navy');
    const payRow = db.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE stripe_event_id = ?').get('evt_wh');
    assert(Number(entRow.n) === 1, `webhook retry should yield ONE entitlement row, got ${entRow.n}`);
    assert(Number(payRow.n) === 1 && Number(payRow.s) === 299, `webhook retry should record revenue ONCE (299), got n=${payRow.n} s=${payRow.s}`);
    assert(db.userOwnsSku(uid, 'pirates-navy') === true, 'grantSetPurchase should grant ownership');
    assert(!db.getUserById(uid).is_premium, 'grantSetPurchase must NOT flip is_premium (isolated from subscription path)');
    log('grantSetPurchase: atomic + idempotent grant+payment, premium untouched ✓');

    // revokeEntitlement removes ownership (refund / dispute path).
    const revoked = db.revokeEntitlement(uid, 'samurai-ninja');
    assert(revoked === true, 'revokeEntitlement should remove the row (true)');
    assert(db.userOwnsSku(uid, 'samurai-ninja') === false, 'sku should not be owned after revoke');
    assert(db.revokeEntitlement(uid, 'samurai-ninja') === false, 'revoking again is a no-op (false)');
    const remaining = db.listUserSkus(uid).sort();
    assert(remaining.join(',') === 'pirates-navy,vikings-saxons', `only the non-revoked skus remain, got ${JSON.stringify(remaining)}`);
    log('revokeEntitlement removes ownership ✓');

    db.db.close();
  } finally {
    rmDb(dbPath);
  }
}

async function main() {
  await testCatalogAndCheckout();
  await testEntitlementsLayer();
  log('PASS — catalog public + ownership server-verified; checkout validated; entitlements idempotent + revocable');
  return 0;
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[store] FAIL:', e.message); process.exit(1); });
