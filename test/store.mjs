#!/usr/bin/env node
/*
 * store.mjs — tests for the cosmetic STORE (themed piece-sets).
 *
 * There is no monetization left: the sets were one-time microtransactions, then
 * a premium-subscriber perk, and are now simply FREE for everyone. Subscription
 * billing was removed in 2026-08, so there is no /api/store/checkout route, no
 * price env, no ownership/entitlement and no premium gate.
 *
 * Integration: boot the REAL backend on a throwaway SQLite DB and assert:
 *   - GET  /api/store/catalog (unauth) -> 19 sets, each { sku, name, factions },
 *     and NO ownership/pricing/premium fields
 *   - POST /api/store/checkout no longer exists (404/405/410, never 200)
 *   - /api/me carries neither ownedSets nor isPremium
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
    // The catalog is just a static list of free cosmetic sets. The STRIPE_* deletes
    // below stay as a guard: a stray key in the environment must not resurrect billing.
    const env = { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development' };
    delete env.STRIPE_SECRET_KEY; delete env.STRIPE_PRICE_ID; delete env.STRIPE_WEBHOOK_SECRET; delete env.STRIPE_PUBLISHABLE_KEY;
    for (const k of Object.keys(env)) if (k.startsWith('STRIPE_PRICE_SET_')) delete env[k];
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    // Catalog is PUBLIC and lists the 19 free sets.
    const catRes = await fetch(`${BASE}/api/store/catalog`);
    assert(catRes.ok, `catalog failed: ${catRes.status}`);
    const cat = await catRes.json();
    assert(Array.isArray(cat) && cat.length === 19, `catalog should list 19 sets, got ${cat && cat.length}`);
    assert(cat.every(p => p.sku && p.name && p.factions && p.factions.w && p.factions.b), 'each set carries sku + name + factions');
    // The new model drops ownership + pricing from the catalog entirely.
    assert(cat.every(p => !('owned' in p) && !('priceCents' in p) && !('comingSoon' in p) && !('premium' in p) && !('stripe_price_id' in p)),
      'catalog must NOT carry owned/priceCents/comingSoon/premium/stripe_price_id — every set is free');
    const samurai = cat.find(p => p.sku === 'samurai-ninja');
    assert(samurai && samurai.name === 'Samurai vs Ninja', 'samurai-ninja present with its display name');
    log('GET /api/store/catalog -> 19 sets, no gate, no ownership/pricing ✓');

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

    // /api/me exposes neither ownedSets nor any premium flag — every set is free.
    const meRes = await fetch(`${BASE}/api/me`, { headers: authH });
    assert(meRes.ok, `/api/me failed: ${meRes.status}`);
    const me = await meRes.json();
    assert(!('ownedSets' in me), `/api/me should NOT carry ownedSets anymore, got ${JSON.stringify(me.ownedSets)}`);
    assert(!('isPremium' in me), `/api/me should NOT carry isPremium anymore, got ${me.isPremium}`);
    log('GET /api/me -> no ownedSets, no isPremium ✓');
  } finally {
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    rmDb(dbPath);
  }
}

async function main() {
  await testCatalogAndNoCheckout();
  log('PASS — catalog lists 19 free sets; no checkout route; /api/me has no ownedSets or isPremium');
  return 0;
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[store] FAIL:', e.message); process.exit(1); });
