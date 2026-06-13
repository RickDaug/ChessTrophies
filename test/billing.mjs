#!/usr/bin/env node
/*
 * billing.mjs — tests for the Stripe subscription billing backend.
 *
 * NO real Stripe network calls. Two parts:
 *   1) Integration: boot the REAL backend on a throwaway SQLite DB with NO
 *      Stripe env vars and prove the feature is inert —
 *        - GET  /api/billing/config  -> { enabled: false }
 *        - POST /api/billing/checkout (authed) -> 503
 *   2) Unit: import the SQLite db.js directly (throwaway DATABASE_PATH) and
 *      exercise the billing data layer —
 *        - recordPayment is idempotent on stripe_event_id (one row, counted once)
 *        - revenueStats() sums month/year/all-time from controlled created_at
 *        - setPremiumByCustomer flips is_premium + getUserByStripeCustomer resolves
 *
 * Run:  node test/billing.mjs   (exit 0 = PASS, 1 = FAIL)
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
const log = (...a) => console.log('[billing]', ...a);
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

// --- Part 1: integration (feature inert with no Stripe env) -----------------
async function testInertWhenUnconfigured() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-billing-int-${process.pid}-${port}.db`);
  const post = (p, body, headers = {}) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });

  let proc, errOut = '';
  try {
    // Deliberately strip any Stripe vars from the inherited env so billing is OFF.
    const env = { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development' };
    delete env.STRIPE_SECRET_KEY; delete env.STRIPE_PRICE_ID; delete env.STRIPE_WEBHOOK_SECRET; delete env.STRIPE_PUBLISHABLE_KEY;
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy (no Stripe env)');

    // /api/billing/config is PUBLIC and reports disabled.
    const cfgRes = await fetch(`${BASE}/api/billing/config`);
    assert(cfgRes.ok, `billing/config failed: ${cfgRes.status}`);
    const cfg = await cfgRes.json();
    assert(cfg.enabled === false, `config.enabled should be false, got ${cfg.enabled}`);
    assert(cfg.mode === 'subscription', `config.mode should be 'subscription', got ${cfg.mode}`);
    assert(cfg.publishableKey === null, `config.publishableKey should be null, got ${cfg.publishableKey}`);
    log('GET /api/billing/config -> { enabled:false } ✓');

    // Sign up + log in to get a bearer token for the authed checkout route.
    const RUN = Date.now().toString(36).slice(-5);
    const username = `B${RUN}`;
    const password = 'passw0rd';
    const su = await post('/api/auth/signup', { email: `b${RUN}@bill.local`, username, password });
    assert(su.ok, `signup failed: ${su.status}`);
    const token = (await su.json()).token;
    assert(typeof token === 'string' && token, 'signup should return a token');

    // checkout requires auth: no token -> 401.
    const noAuth = await post('/api/billing/checkout', {});
    assert(noAuth.status === 401, `checkout without auth should be 401, got ${noAuth.status}`);

    // checkout with auth but billing OFF -> 503.
    const co = await post('/api/billing/checkout', {}, { Authorization: `Bearer ${token}` });
    assert(co.status === 503, `checkout should be 503 when unconfigured, got ${co.status}`);
    const coBody = await co.json();
    assert(/not configured/i.test(coBody.error || ''), `checkout 503 should explain not configured, got ${JSON.stringify(coBody)}`);
    log('POST /api/billing/checkout -> 503 when unconfigured (401 without auth) ✓');

    // portal also 503 when unconfigured.
    const portal = await post('/api/billing/portal', {}, { Authorization: `Bearer ${token}` });
    assert(portal.status === 503, `portal should be 503 when unconfigured, got ${portal.status}`);
    log('POST /api/billing/portal -> 503 when unconfigured ✓');
  } finally {
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    rmDb(dbPath);
  }
}

// --- Part 2: unit-test the SQLite billing data layer directly ---------------
async function testDbLayer() {
  const dbPath = path.join(os.tmpdir(), `ct-billing-unit-${process.pid}-${Date.now().toString(36)}.db`);
  // db.js reads DATABASE_PATH at import time — set it BEFORE importing.
  process.env.DATABASE_PATH = dbPath;
  // Import the backend module relative to the server dir (its node_modules has
  // better-sqlite3). Use a file:// URL so Windows paths resolve correctly.
  const dbUrl = new URL(`file://${path.join(SERVER_DIR, 'db.js').replace(/\\/g, '/')}`);
  const db = await import(dbUrl.href);
  try {
    const now = Date.now();
    // Seed a user with a known Stripe customer id.
    const uid = 'u_test_' + Math.random().toString(36).slice(2, 8);
    const cust = 'cus_test_' + Math.random().toString(36).slice(2, 8);
    db.createUser({ id: uid, email: `${uid}@unit.local`, username: uid, region: '', pw_hash: 'x' });
    db.setStripeCustomer(uid, cust);
    const u = db.getUserByStripeCustomer(cust);
    assert(u && u.id === uid, 'getUserByStripeCustomer should resolve the seeded user');
    assert((u.stripe_customer_id || '') === cust, 'stripe_customer_id should be persisted');
    log('setStripeCustomer + getUserByStripeCustomer ✓');

    // setPremiumByCustomer flips is_premium.
    assert(!u.is_premium, 'user should start non-premium');
    db.setPremiumByCustomer(cust, true, 'active');
    let u2 = db.getUserByStripeCustomer(cust);
    assert(!!u2.is_premium, 'setPremiumByCustomer(true) should flip is_premium to 1');
    assert(u2.subscription_status === 'active', `subscription_status should be 'active', got ${u2.subscription_status}`);
    db.setPremiumByCustomer(cust, false, 'canceled');
    u2 = db.getUserByStripeCustomer(cust);
    assert(!u2.is_premium, 'setPremiumByCustomer(false) should flip is_premium to 0');
    assert(u2.subscription_status === 'canceled', 'subscription_status should be canceled');
    // Restore premium so it counts as an active subscriber below.
    db.setPremiumByCustomer(cust, true, 'active');
    log('setPremiumByCustomer flips is_premium + status ✓');

    // recordPayment idempotency: same stripe_event_id twice -> one row, once.
    const evt = 'evt_test_' + Math.random().toString(36).slice(2, 8);
    db.recordPayment({ userId: uid, eventId: evt, amountCents: 500, currency: 'usd', kind: 'subscription', createdAt: now });
    db.recordPayment({ userId: uid, eventId: evt, amountCents: 500, currency: 'usd', kind: 'subscription', createdAt: now });
    const cntRow = db.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE stripe_event_id = ?').get(evt);
    assert(Number(cntRow.n) === 1, `duplicate event should yield ONE row, got ${cntRow.n}`);
    assert(Number(cntRow.s) === 500, `amount should be counted once (500), got ${cntRow.s}`);
    log('recordPayment is idempotent on stripe_event_id ✓');

    // revenueStats: seed payments this month, earlier this year, last year.
    const d = new Date();
    const thisMonth = new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0).getTime() + 3600000; // ~start of month + 1h
    // Earlier this year but a DIFFERENT month: pick January 15 if we're past Jan,
    // else use this month's start minus nothing handled by month bucket. To be
    // robust regardless of current month, use a fixed earlier-in-year date when
    // the current month is not January; when it IS January everything in-year is
    // also in-month, which the assertions below account for.
    const isJan = d.getMonth() === 0;
    const earlierThisYear = new Date(d.getFullYear(), 0, 15, 12, 0, 0).getTime(); // Jan 15 this year
    const lastYear = new Date(d.getFullYear() - 1, 5, 15, 12, 0, 0).getTime();    // Jun 15 last year

    db.recordPayment({ userId: uid, eventId: 'evt_month_' + evt, amountCents: 1000, currency: 'usd', createdAt: thisMonth });
    db.recordPayment({ userId: uid, eventId: 'evt_year_' + evt, amountCents: 2000, currency: 'usd', createdAt: earlierThisYear });
    db.recordPayment({ userId: uid, eventId: 'evt_old_' + evt, amountCents: 4000, currency: 'usd', createdAt: lastYear });

    const rev = db.revenueStats();
    log('revenueStats:', JSON.stringify(rev), isJan ? '(current month is January)' : '');

    // Last-year payment must NOT appear in month or year totals.
    // The earlier-this-record (500, idempotent test) also lands this month/year.
    // Expected this-year total = 500 (idempotent test) + 1000 (this month) + 2000 (Jan).
    assert(rev.allTimeCents === 500 + 1000 + 2000 + 4000, `allTimeCents should be 7500, got ${rev.allTimeCents}`);
    assert(rev.yearCents === 500 + 1000 + 2000, `yearCents should be 3500 (excludes last year), got ${rev.yearCents}`);
    if (isJan) {
      // In January, Jan-15 + this-month + idempotent all fall in the current month.
      assert(rev.monthCents === 500 + 1000 + 2000, `monthCents (January) should be 3500, got ${rev.monthCents}`);
    } else {
      // Otherwise only the idempotent (now) + this-month seed are in the current month.
      assert(rev.monthCents === 500 + 1000, `monthCents should be 1500 (this month only), got ${rev.monthCents}`);
    }
    assert(rev.activeSubscribers === 1, `activeSubscribers should be 1, got ${rev.activeSubscribers}`);
    assert(rev.currency === 'usd', `currency should be usd, got ${rev.currency}`);
    log('revenueStats sums month/year/all-time correctly + activeSubscribers ✓');

    db.db.close();
  } finally {
    rmDb(dbPath);
  }
}

// --- Part 3: the REAL webhook HTTP path (signature + handleEvent dispatch) ----
// The two parts above never touch POST /api/billing/webhook — they exercise the
// inert path and the DB layer directly, which (per the audit) MASKS the live
// webhook: signature verification and the handleEvent dispatch were untested.
// Here we boot the backend WITH Stripe configured (dummy keys — constructEvent +
// the SDK constructor are pure-local, no network), sign events with the SDK's
// own generateTestHeaderString, and drive the webhook over real HTTP:
//   - a bad / missing signature is rejected (400);
//   - a VALID checkout.session.completed dispatches through handleEvent and flips
//     the user to premium (observed via authed GET /api/me);
//   - a duplicate delivery is idempotent (still 200);
//   - invoice.payment_succeeded delivered TWICE (same event.id) records revenue
//     EXACTLY ONCE (verified by reading the payments table directly afterward).
async function testWebhookHttpPath() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-billing-wh-${process.pid}-${port}.db`);
  const WH_SECRET = 'whsec_test_' + Math.random().toString(36).slice(2, 14);
  const RUN = Date.now().toString(36).slice(-5);
  const invEventId = 'evt_inv_' + RUN;

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

    // A real user (for the premium-flip assertion via client_reference_id).
    const su = await postRaw('/api/auth/signup', JSON.stringify({ email: `w${RUN}@bill.local`, username: `W${RUN}`, password: 'passw0rd' }));
    assert(su.ok, `signup failed: ${su.status}`);
    const token = (await su.json()).token;
    const me0 = await (await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const userId = me0.id;
    assert(userId && me0.isPremium === false, 'seeded user should exist and start non-premium');

    // 1) BAD signature -> 400.
    const badPayload = JSON.stringify({ id: 'evt_bad', type: 'checkout.session.completed', data: { object: {} } });
    const bad = await postRaw('/api/billing/webhook', badPayload, { 'Stripe-Signature': 't=1,v1=deadbeefdeadbeef' });
    assert(bad.status === 400, `bad signature should be 400, got ${bad.status}`);
    // 2) MISSING signature -> 400.
    const miss = await postRaw('/api/billing/webhook', badPayload, {});
    assert(miss.status === 400, `missing signature should be 400, got ${miss.status}`);
    log('webhook rejects bad + missing signatures (400) ✓');

    // 3) VALID checkout.session.completed -> 200 + premium flip over HTTP.
    const coPayload = JSON.stringify({ id: 'evt_co_' + RUN, type: 'checkout.session.completed', livemode: false, data: { object: { client_reference_id: userId, customer: 'cus_' + RUN } } });
    const co = await postRaw('/api/billing/webhook', coPayload, { 'Stripe-Signature': sign(coPayload) });
    assert(co.status === 200, `valid event should be 200, got ${co.status} (${await co.text().catch(() => '')})`);
    const me1 = await (await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert(me1.isPremium === true, 'checkout.session.completed should flip the user to premium over the HTTP webhook');
    log('valid checkout.session.completed -> 200 + premium granted over HTTP ✓');

    // 4) DUPLICATE delivery of the same event -> still 200 (idempotent, no crash).
    const coDup = await postRaw('/api/billing/webhook', coPayload, { 'Stripe-Signature': sign(coPayload) });
    assert(coDup.status === 200, `duplicate event should still be 200, got ${coDup.status}`);
    log('duplicate checkout.session.completed -> 200 (idempotent) ✓');

    // 5) invoice.payment_succeeded delivered TWICE (same event.id) -> 200/200.
    const invPayload = JSON.stringify({ id: invEventId, type: 'invoice.payment_succeeded', livemode: false, data: { object: { customer: 'cus_unknown_' + RUN, amount_paid: 500, currency: 'usd' } } });
    const inv1 = await postRaw('/api/billing/webhook', invPayload, { 'Stripe-Signature': sign(invPayload) });
    const inv2 = await postRaw('/api/billing/webhook', invPayload, { 'Stripe-Signature': sign(invPayload) });
    assert(inv1.status === 200 && inv2.status === 200, `invoice deliveries should be 200/200, got ${inv1.status}/${inv2.status}`);
    log('valid invoice.payment_succeeded delivered twice -> 200/200 ✓');
  } finally {
    if (proc && proc.exitCode === null) await new Promise(r => { proc.once('exit', r); try { proc.kill(); } catch { r(); } setTimeout(r, 3000); });
    // Server is down — read the payments table directly to prove the duplicate
    // webhook delivery recorded revenue EXACTLY ONCE (the idempotency guarantee
    // that matters over the real HTTP path, not just at the DB-helper level).
    try {
      const Database = requireFromServer('better-sqlite3');
      const sdb = new Database(dbPath, { readonly: true });
      const row = sdb.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE stripe_event_id = ?').get(invEventId);
      sdb.close();
      assert(Number(row.n) === 1, `duplicate invoice.payment_succeeded should record ONE payment, got ${row.n}`);
      assert(Number(row.s) === 500, `revenue should be counted once (500), got ${row.s}`);
      log('webhook HTTP path: duplicate invoice.payment_succeeded recorded revenue ONCE ✓');
    } finally {
      rmDb(dbPath);
    }
  }
}

async function main() {
  await testInertWhenUnconfigured();
  await testDbLayer();
  await testWebhookHttpPath();
  log('PASS — billing inert when unconfigured; DB layer idempotent + revenue correct; webhook HTTP path verifies signatures + dispatches + dedupes');
  return 0;
}
main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[billing] FAIL:', e.message); process.exit(1); });
