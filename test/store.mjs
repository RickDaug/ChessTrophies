#!/usr/bin/env node
/*
 * store.mjs — tests for the cosmetic STORE (themed piece-sets as a PREMIUM
 * perk). NO real Stripe network calls.
 *
 * The monetization model CHANGED: the themed sets are no longer one-time
 * microtransactions — they're a premium-subscriber perk (access while premium
 * is active, revoked on cancel via the premium reconcile). So there is no
 * /api/store/checkout route, no per-set price env, no ownership/entitlement.
 *
 * Integration: boot the REAL backend on a throwaway SQLite DB (no Stripe env
 * needed) and assert:
 *   - GET  /api/store/catalog (unauth) -> 19 sets, each { sku, name, factions,
 *     premium:true }, and NO ownership/pricing fields
 *   - POST /api/store/checkout no longer exists (404/405/410, never 200)
 *   - /api/me has NO ownedSets field (access is purely is_premium)
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

async function testCatalogAndNoCheckout() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-store-int-${process.pid}-${port}.db`);
  const post = (p, body, headers = {}) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });

  let proc, errOut = '';
  try {
    // No Stripe env required — the catalog is just a static list of premium
    // cosmetic sets; access is gated on is_premium, not per-set purchase.
    const env = { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development' };
    delete env.STRIPE_SECRET_KEY; delete env.STRIPE_PRICE_ID; delete env.STRIPE_WEBHOOK_SECRET; delete env.STRIPE_PUBLISHABLE_KEY;
    for (const k of Object.keys(env)) if (k.startsWith('STRIPE_PRICE_SET_')) delete env[k];
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    // Catalog is PUBLIC and lists the 19 premium sets.
    const catRes = await fetch(`${BASE}/api/store/catalog`);
    assert(catRes.ok, `catalog failed: ${catRes.status}`);
    const cat = await catRes.json();
    assert(Array.isArray(cat) && cat.length === 19, `catalog should list 19 sets, got ${cat && cat.length}`);
    assert(cat.every(p => p.premium === true), 'every set should be premium:true');
    assert(cat.every(p => p.sku && p.name && p.factions && p.factions.w && p.factions.b), 'each set carries sku + name + factions');
    // The new model drops ownership + pricing from the catalog entirely.
    assert(cat.every(p => !('owned' in p) && !('priceCents' in p) && !('comingSoon' in p) && !('stripe_price_id' in p)),
      'catalog must NOT carry owned/priceCents/comingSoon/stripe_price_id (premium-only, no purchase)');
    const samurai = cat.find(p => p.sku === 'samurai-ninja');
    assert(samurai && samurai.name === 'Samurai vs Ninja', 'samurai-ninja present with its display name');
    log('GET /api/store/catalog -> 19 sets, premium:true, no ownership/pricing ✓');

    // Sign up to get a bearer token (used for /api/me + the removed-route check).
    const RUN = Date.now().toString(36).slice(-5);
    const username = `S${RUN}`;
    const su = await post('/api/auth/signup', { email: `s${RUN}@store.local`, username, password: 'passw0rd' });
    assert(su.ok, `signup failed: ${su.status}`);
    const token = (await su.json()).token;
    assert(typeof token === 'string' && token, 'signup should return a token');
    const authH = { Authorization: `Bearer ${token}` };

    // The one-time checkout route is GONE: POST /api/store/checkout must NOT
    // succeed. Express returns 404 for an unmounted route (auth/unauth alike).
    const coNoAuth = await post('/api/store/checkout', { sku: 'samurai-ninja' });
    assert(coNoAuth.status !== 200, `/api/store/checkout should not exist (unauth), got ${coNoAuth.status}`);
    assert([404, 405, 410].includes(coNoAuth.status), `/api/store/checkout should 404/405/410, got ${coNoAuth.status}`);
    const coAuth = await post('/api/store/checkout', { sku: 'samurai-ninja' }, authH);
    assert(coAuth.status !== 200, `/api/store/checkout should not exist (auth), got ${coAuth.status}`);
    assert([404, 405, 410].includes(coAuth.status), `/api/store/checkout should 404/405/410, got ${coAuth.status}`);
    log('POST /api/store/checkout removed -> 404/405/410 (never 200) ✓');

    // /api/me no longer exposes ownedSets — access is purely is_premium.
    const meRes = await fetch(`${BASE}/api/me`, { headers: authH });
    assert(meRes.ok, `/api/me failed: ${meRes.status}`);
    const me = await meRes.json();
    assert(!('ownedSets' in me), `/api/me should NOT carry ownedSets anymore, got ${JSON.stringify(me.ownedSets)}`);
    assert(me.isPremium === false, `a fresh user should be isPremium:false, got ${me.isPremium}`);
    log('GET /api/me -> no ownedSets; isPremium drives access ✓');
  } finally {
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    rmDb(dbPath);
  }
}

async function main() {
  await testCatalogAndNoCheckout();
  log('PASS — catalog lists 19 premium-only sets; no checkout route; /api/me has no ownedSets');
  return 0;
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[store] FAIL:', e.message); process.exit(1); });
