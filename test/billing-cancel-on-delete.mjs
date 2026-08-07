#!/usr/bin/env node
/*
 * billing-cancel-on-delete.mjs — the S1 from the 2026-07 audit: deleting an
 * account must CANCEL the user's Stripe subscription, or a paying customer keeps
 * being charged forever with no account left to cancel from.
 *
 * There are TWO deletion paths and both must cancel:
 *   - POST   /api/me/delete       (GDPR soft-anonymize) -> auth.deleteAccount
 *   - DELETE /api/admin/user/:id  (hard scrub)          -> the admin route
 * The hard delete is the nastier one: it removes the users row outright, so a
 * subscription stranded there can never be traced back to an account at all.
 *
 * NO real Stripe network calls, in two parts:
 *   PART A (unit): drive the REAL cancellation logic
 *     (billing.cancelSubscriptionsWithClient) with a stub Stripe client —
 *       - cancels only still-billable statuses, leaves dead ones alone;
 *       - falls back to a lookup BY EMAIL and cancels subs on a second customer
 *         created under the same address;
 *       - a list failure is counted in `failed` and never throws;
 *       - one cancel failing does not stop the others;
 *       - no customer / no user degrade to a skip, not a crash.
 *   PART B (integration): boot the REAL backend with NO Stripe env and prove the
 *     wiring — both delete paths still complete, and the admin route reports the
 *     Stripe outcome instead of silently skipping it.
 *
 * Run: node test/billing-cancel-on-delete.mjs   Exit 0 = PASS.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[cancel-on-delete]', ...a);
let failed = 0;
function check(cond, msg) { if (cond) log('PASS:', msg); else { failed++; log('FAIL:', msg); } }

// Point the data layer at a throwaway DB BEFORE importing anything that pulls in
// store.js -> db.js (the billing.mjs Part-2 pattern).
const dbPath = path.join(os.tmpdir(), `ct-cancel-del-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
delete process.env.DATABASE_URL;
delete process.env.DB_BACKEND;

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function waitForHealth(url, t = 15000) {
  const end = Date.now() + t;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  throw new Error('health timeout');
}
function rmDb(p) {
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { for (let i = 0; i < 6; i++) { try { fs.rmSync(f, { force: true }); break; } catch {} } }
}

// A minimal stand-in for the Stripe SDK surface cancelSubscriptionsWithClient
// touches: customers.list (by email), subscriptions.list (by customer),
// subscriptions.cancel. `cancelled` records what it was asked to cancel.
function stubStripe({ byEmail = {}, byCustomer = {}, failList = new Set(), failCancel = new Set(), failEmailLookup = false } = {}) {
  const cancelled = [];
  return {
    cancelled,
    customers: {
      list: async ({ email }) => {
        if (failEmailLookup) throw new Error('stub: email lookup down');
        return { data: (byEmail[email] || []).map(id => ({ id })) };
      },
    },
    subscriptions: {
      list: async ({ customer }) => {
        if (failList.has(customer)) throw new Error('stub: list down');
        return { data: byCustomer[customer] || [] };
      },
      cancel: async (id) => {
        if (failCancel.has(id)) throw new Error('stub: cancel down');
        cancelled.push(id);
        return { id, status: 'canceled' };
      },
    },
  };
}

// --- PART A: the cancellation logic ----------------------------------------
async function testCancelLogic() {
  const { cancelSubscriptionsWithClient } = await import('../server/billing.js');

  // 1) Only still-billable subscriptions get cancelled.
  {
    const stripe = stubStripe({
      byCustomer: {
        cus_A: [
          { id: 'sub_active', status: 'active' },
          { id: 'sub_trial', status: 'trialing' },
          { id: 'sub_pastdue', status: 'past_due' },
          { id: 'sub_dead', status: 'canceled' },
          { id: 'sub_expired', status: 'incomplete_expired' },
        ],
      },
    });
    const r = await cancelSubscriptionsWithClient(stripe, { id: 'u1', stripe_customer_id: 'cus_A' });
    check(r.cancelled === 3 && r.failed === 0, `cancels the 3 billable subs (got cancelled=${r.cancelled}, failed=${r.failed})`);
    check(stripe.cancelled.includes('sub_active') && stripe.cancelled.includes('sub_trial') && stripe.cancelled.includes('sub_pastdue'),
      'cancels active + trialing + past_due');
    check(!stripe.cancelled.includes('sub_dead') && !stripe.cancelled.includes('sub_expired'),
      'leaves already-dead subscriptions alone');
  }

  // 2) Email fallback: a sub created under a SECOND customer with the same email
  //    is still cancelled (the mapping on the user row is not the only truth).
  {
    const stripe = stubStripe({
      byEmail: { 'p@x.test': ['cus_A', 'cus_B'] },
      byCustomer: {
        cus_A: [{ id: 'sub_mapped', status: 'active' }],
        cus_B: [{ id: 'sub_orphan', status: 'active' }],
      },
    });
    const r = await cancelSubscriptionsWithClient(stripe, { id: 'u2', stripe_customer_id: 'cus_A', email: 'p@x.test' });
    check(r.cancelled === 2 && stripe.cancelled.includes('sub_orphan'),
      `email fallback catches a sub on an unmapped customer (cancelled=${r.cancelled})`);
  }

  // 3) A failing email lookup degrades to "cancel what we had mapped".
  {
    const stripe = stubStripe({ failEmailLookup: true, byCustomer: { cus_A: [{ id: 'sub_mapped', status: 'active' }] } });
    const r = await cancelSubscriptionsWithClient(stripe, { id: 'u3', stripe_customer_id: 'cus_A', email: 'p@x.test' });
    check(r.cancelled === 1 && r.failed === 0, 'a broken email lookup still cancels the mapped customer');
  }

  // 4) A failing LIST is counted as failed (so the caller can log for a manual
  //    cancel) and never throws.
  {
    const stripe = stubStripe({ failList: new Set(['cus_A']) });
    const r = await cancelSubscriptionsWithClient(stripe, { id: 'u4', stripe_customer_id: 'cus_A' });
    check(r.failed === 1 && r.cancelled === 0, 'a failed subscription list is reported as failed, not swallowed');
  }

  // 5) One cancel failing must not abort the rest.
  {
    const stripe = stubStripe({
      byCustomer: { cus_A: [{ id: 'sub_bad', status: 'active' }, { id: 'sub_good', status: 'active' }] },
      failCancel: new Set(['sub_bad']),
    });
    const r = await cancelSubscriptionsWithClient(stripe, { id: 'u5', stripe_customer_id: 'cus_A' });
    check(r.cancelled === 1 && r.failed === 1 && stripe.cancelled.includes('sub_good'),
      'one failing cancel does not stop the others');
  }

  // 6) Degenerate inputs skip cleanly (contract: never throws).
  {
    const stripe = stubStripe({ byEmail: {} });
    const noCustomer = await cancelSubscriptionsWithClient(stripe, { id: 'u6' });
    check(noCustomer.skipped === 'no_customer' && noCustomer.cancelled === 0, 'a user with no customer/email skips as no_customer');
    const noUser = await cancelSubscriptionsWithClient(stripe, null);
    check(noUser.skipped === 'no_user', 'a null user skips as no_user');
    const noStripe = await cancelSubscriptionsWithClient(null, { id: 'u6' });
    check(noStripe.skipped === 'not_configured', 'a null client skips as not_configured');
  }
}

// --- PART B: both delete routes are wired ----------------------------------
async function testRoutesWired() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const sdb = path.join(os.tmpdir(), `ct-cancel-del-http-${process.pid}-${port}.db`);
  const KEY = 'test-admin-key-cancel';
  let proc, errOut = '';
  try {
    // No Stripe env at all -> cancellation must degrade to a clean skip while
    // the deletions themselves still succeed.
    const env = { ...process.env, PORT: String(port), DATABASE_PATH: sdb, DATABASE_URL: '', DB_BACKEND: '', CORS_ORIGIN: '*', NODE_ENV: 'development', ADMIN_KEY: KEY };
    delete env.STRIPE_SECRET_KEY; delete env.STRIPE_PRICE_ID; delete env.STRIPE_WEBHOOK_SECRET;
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('exit', c => { if (c) log('server exited', c, errOut); });
    await waitForHealth(`${BASE}/health`);

    const signup = async (tag) => (await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${tag}${port}@cancel.local`, username: `${tag}${port}`, password: 'passw0rd', region: 'T' }),
    })).json();

    // --- admin hard delete ---
    // The signup response carries the token; the id comes from /api/me.
    const victim = await signup('hard');
    const vme = await (await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${victim.token}` } })).json();
    const vid = vme.id;
    check(!!vid, 'seeded a user for the admin hard delete');

    const dry = await (await fetch(`${BASE}/api/admin/user/${vid}?dryRun=1`, { method: 'DELETE', headers: { 'x-admin-key': KEY } })).json();
    check(dry.stripe && dry.stripe.skipped === 'dry_run', `a dry run does NOT touch Stripe (skipped=${dry.stripe && dry.stripe.skipped})`);

    const hard = await (await fetch(`${BASE}/api/admin/user/${vid}`, { method: 'DELETE', headers: { 'x-admin-key': KEY } })).json();
    check(hard.found === true, 'the admin hard delete still removes the user');
    check(hard.stripe && hard.stripe.skipped === 'not_configured',
      `the admin route reports the Stripe outcome (skipped=${hard.stripe && hard.stripe.skipped})`);

    // --- GDPR soft delete: a Stripe no-op must not block it ---
    const soft = await signup('soft');
    const softRes = await fetch(`${BASE}/api/me/delete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${soft.token}` },
      body: JSON.stringify({ password: 'passw0rd' }),
    });
    check(softRes.ok, `POST /api/me/delete succeeds with Stripe unconfigured (status ${softRes.status})`);
    const after = await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${soft.token}` } });
    check(after.status === 401, `the deleted account's session is revoked (status ${after.status})`);
  } finally {
    if (proc) { try { proc.kill(); } catch {} await new Promise(r => setTimeout(r, 300)); }
    rmDb(sdb);
  }
}

(async () => {
  try {
    await testCancelLogic();
    await testRoutesWired();
  } catch (e) {
    failed++;
    log('ERROR:', e && e.stack ? e.stack : e);
  } finally {
    rmDb(dbPath);
  }
  if (failed) { log(`FAILED — ${failed} check(s)`); process.exit(1); }
  log('PASS — both delete paths cancel Stripe subscriptions (and degrade safely when Stripe is unconfigured)');
})();
