#!/usr/bin/env node
/*
 * billing-churn.mjs — Stripe subscription CHURN over the REAL webhook HTTP path.
 *
 * test/billing.mjs covers purchase + renewal (checkout.session.completed +
 * invoice.payment_succeeded) but never the REVOKE side: server/billing.js's
 * handleEvent() also handles `customer.subscription.deleted` and
 * `customer.subscription.updated` (to a cancel/non-active status), which clear
 * is_premium. Those paths were untested — a regression there would let a churned
 * subscriber keep premium forever.
 *
 * Like billing.mjs this makes NO real Stripe network calls: it boots the backend
 * WITH Stripe configured (dummy keys — constructEvent + the SDK constructor are
 * pure-local) and signs events with the SDK's own generateTestHeaderString, then
 * drives POST /api/billing/webhook over real HTTP.
 *
 * Setup note: the churn events (customer.subscription.deleted/.updated) are keyed
 * ONLY by Stripe customer id, and the handler resolves the user via
 * getUserByStripeCustomer — so the user<->customer mapping must already exist.
 * In production that mapping is persisted by ensureCustomer() when the user opens
 * Checkout (POST /api/billing/checkout), BEFORE any subscription webhook fires.
 * We can't run that path here (it would hit the real Stripe API), so we seed the
 * mapping the same way ensureCustomer does — store.setStripeCustomer — by opening
 * the throwaway SQLite DB directly (the billing.mjs Part-2 pattern). Premium is
 * then granted/revoked purely through the REAL HTTP webhook + handleEvent.
 *
 * Asserts:
 *   1) invoice.payment_succeeded GRANTS premium by customer (the precondition);
 *   2) customer.subscription.deleted REVOKES premium (over HTTP, observed via /api/me);
 *   3) a DUPLICATE delivery of the delete event is idempotent (still 200, stays revoked);
 *   4) re-granting then customer.subscription.updated to a CANCEL status (e.g.
 *      'canceled'/'unpaid') REVOKES premium;
 *   5) customer.subscription.updated to 'active' RE-GRANTS premium.
 *
 * Run:  node test/billing-churn.mjs   (exit 0 = PASS, 1 = FAIL)
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[billing-churn]', ...a);
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
function rmDb(p) { for (const f of [p, `${p}-wal`, `${p}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch {} } } }

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-billing-churn-${process.pid}-${port}.db`);
  const WH_SECRET = 'whsec_test_' + Math.random().toString(36).slice(2, 14);
  const RUN = Date.now().toString(36).slice(-5);
  const CUST = 'cus_churn_' + RUN;

  const requireFromServer = createRequire(path.join(SERVER_DIR, 'db.js'));
  const Stripe = requireFromServer('stripe');
  const stripe = new Stripe('sk_test_dummy', { apiVersion: '2026-05-27.dahlia' });
  const sign = (payloadStr) => stripe.webhooks.generateTestHeaderString({ payload: payloadStr, secret: WH_SECRET });
  const postRaw = (p, bodyStr, headers = {}) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: bodyStr });

  let proc, errOut = '';
  try {
    const env = {
      ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development',
      STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_PRICE_ID: 'price_dummy', STRIPE_WEBHOOK_SECRET: WH_SECRET,
    };
    delete env.STRIPE_PUBLISHABLE_KEY;
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy (Stripe configured w/ dummy keys)');

    // A real user we will grant/revoke premium for.
    const su = await postRaw('/api/auth/signup', JSON.stringify({ email: `c${RUN}@churn.local`, username: `C${RUN}`, password: 'passw0rd' }));
    assert(su.ok, `signup failed: ${su.status}`);
    const token = (await su.json()).token;
    const me = () => fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
    const me0 = await me();
    assert(me0.id && me0.isPremium === false, 'seeded user should exist and start non-premium');

    // Seed the user<->customer mapping the way ensureCustomer() does at Checkout
    // time (we can't call that path without the real Stripe API). Open the same
    // throwaway SQLite DB the server is using (WAL — a 2nd connection is fine).
    {
      const dbUrl = new URL(`file://${path.join(SERVER_DIR, 'db.js').replace(/\\/g, '/')}`);
      // db.js reads DATABASE_PATH at import time — point it at the server's DB.
      const prev = process.env.DATABASE_PATH;
      process.env.DATABASE_PATH = dbPath;
      const dbmod = await import(dbUrl.href);
      try {
        dbmod.setStripeCustomer(me0.id, CUST);
        const seeded = dbmod.getUserByStripeCustomer(CUST);
        assert(seeded && seeded.id === me0.id, 'customer mapping should be seeded (ensureCustomer-equivalent)');
      } finally {
        try { dbmod.db.close(); } catch {}
        if (prev === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = prev;
      }
    }
    log(`seeded stripe_customer_id mapping ${CUST} -> ${me0.username} (ensureCustomer-equivalent) ✓`);

    const post = (payloadObj) => {
      const s = JSON.stringify(payloadObj);
      return postRaw('/api/billing/webhook', s, { 'Stripe-Signature': sign(s) });
    };

    // --- 1) GRANT via invoice.payment_succeeded (keyed by customer). --------------
    const grant = await post({ id: 'evt_inv_' + RUN, type: 'invoice.payment_succeeded', livemode: false, data: { object: { customer: CUST, amount_paid: 500, currency: 'usd' } } });
    assert(grant.status === 200, `grant should be 200, got ${grant.status} (${await grant.text().catch(() => '')})`);
    assert((await me()).isPremium === true, 'invoice.payment_succeeded should grant premium by customer');
    log('invoice.payment_succeeded -> premium GRANTED by customer ✓');

    // --- 2) customer.subscription.deleted REVOKES premium. -----------------------
    const delId = 'evt_del_' + RUN;
    const del = await post({ id: delId, type: 'customer.subscription.deleted', livemode: false, data: { object: { customer: CUST, status: 'canceled' } } });
    assert(del.status === 200, `delete should be 200, got ${del.status} (${await del.text().catch(() => '')})`);
    const afterDel = await me();
    assert(afterDel.isPremium === false, 'customer.subscription.deleted MUST revoke premium over HTTP');
    log('customer.subscription.deleted -> premium REVOKED ✓');

    // --- 3) DUPLICATE delete delivery is idempotent (still 200, stays revoked). ---
    const delDup = await post({ id: delId, type: 'customer.subscription.deleted', livemode: false, data: { object: { customer: CUST, status: 'canceled' } } });
    assert(delDup.status === 200, `duplicate delete should still be 200, got ${delDup.status}`);
    assert((await me()).isPremium === false, 'premium should remain revoked after a duplicate delete');
    log('duplicate customer.subscription.deleted -> 200, stays revoked (idempotent) ✓');

    // --- 4) Re-grant, then customer.subscription.updated -> cancel status REVOKES.
    const regrant = await post({ id: 'evt_co2_' + RUN, type: 'checkout.session.completed', livemode: false, data: { object: { client_reference_id: me0.id, customer: CUST } } });
    assert(regrant.status === 200, `re-grant should be 200, got ${regrant.status}`);
    assert((await me()).isPremium === true, 're-grant should restore premium before the .updated revoke test');

    const upd = await post({ id: 'evt_upd_' + RUN, type: 'customer.subscription.updated', livemode: false, data: { object: { customer: CUST, status: 'unpaid' } } });
    assert(upd.status === 200, `updated(unpaid) should be 200, got ${upd.status}`);
    assert((await me()).isPremium === false, "customer.subscription.updated to a cancel status ('unpaid') MUST revoke premium");
    log("customer.subscription.updated -> 'unpaid' REVOKES premium ✓");

    // --- 5) customer.subscription.updated -> 'active' RE-GRANTS premium. ----------
    const updActive = await post({ id: 'evt_upd2_' + RUN, type: 'customer.subscription.updated', livemode: false, data: { object: { customer: CUST, status: 'active' } } });
    assert(updActive.status === 200, `updated(active) should be 200, got ${updActive.status}`);
    assert((await me()).isPremium === true, "customer.subscription.updated to 'active' should re-grant premium");
    log("customer.subscription.updated -> 'active' RE-GRANTS premium ✓");

    log('PASS — churn webhooks revoke premium (.deleted + .updated cancel), re-grant on active, idempotent on duplicate delivery');
    return 0;
  } finally {
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    rmDb(dbPath);
  }
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[billing-churn] FAIL:', e.message); process.exit(1); });
