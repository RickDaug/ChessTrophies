// Stripe subscription billing (Stripe-hosted Checkout, redirect flow).
//
// Fully env-gated: the feature is OFF and every billing route is inert until
// BOTH STRIPE_SECRET_KEY and STRIPE_PRICE_ID are set. Mirrors email.js: when the
// provider isn't configured the module logs a warning and the endpoints respond
// 503 (config) / report disabled, without ever touching Stripe.
//
// Env vars (all optional):
//   STRIPE_SECRET_KEY      sk_...    — server-side Stripe API key (required to enable)
//   STRIPE_PRICE_ID        price_... — a RECURRING price (required to enable)
//   STRIPE_WEBHOOK_SECRET  whsec_... — verifies inbound webhook signatures
//   STRIPE_PUBLISHABLE_KEY pk_...    — optional; exposed to the client via /config
//   APP_URL                          — base for success/cancel/return redirects
//
// IMPORTANT: the webhook route (mountBillingWebhook) MUST be registered BEFORE
// the global express.json() body parser, because Stripe signature verification
// needs the RAW request body. See server.js wiring.

import express from 'express';
import { requireAuth } from './auth.js';
import * as store from './store.js';

// The Stripe SDK is imported lazily so the server boots fine even before
// `npm i stripe` has run (the dependency was just added to package.json) and so
// the driver is never loaded when billing is unconfigured. Cached after first
// successful construction.
let stripeClient = null;
let stripeLoadFailed = false;

export function billingEnabled() {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

export function appUrl() {
  return (process.env.APP_URL || '').replace(/\/+$/, '');
}

// True when the Stripe secret key is available — enough to verify inbound
// webhook signatures, independent of the subscription STRIPE_PRICE_ID.
export function stripeConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

// Lazily construct (and cache) the Stripe client from STRIPE_SECRET_KEY.
// Returns null when the secret is unset or the SDK can't be loaded — callers
// treat null as "billing unavailable" and respond 503. Never throws.
export async function getStripe() {
  if (stripeClient) return stripeClient;
  if (stripeLoadFailed) return null;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  try {
    const mod = await import('stripe');
    const Stripe = mod.default || mod;
    // Pin the API version so an `npm update stripe` can't silently change the
    // shape of webhook objects (event.data.object) out from under handleEvent.
    // This MUST match the API version configured on the LIVE webhook endpoint in
    // the Stripe Dashboard (Developers → Webhooks → endpoint → API version).
    // This account/endpoint is on 2026-05-27.dahlia (the version checkout was
    // verified working on); pin to it so an SDK upgrade can't silently shift it.
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-05-27.dahlia',
    });
    return stripeClient;
  } catch (e) {
    stripeLoadFailed = true;
    // Don't leak the secret; just note the SDK couldn't load.
    console.error('[billing] failed to load the Stripe SDK (run `npm i stripe`):', e && e.message ? e.message : e);
    return null;
  }
}

// Ensure the user has a Stripe Customer, creating + persisting one if needed.
// Returns the customer id, or null on failure.
export async function ensureCustomer(stripe, user) {
  if (user && user.stripe_customer_id) return user.stripe_customer_id;
  try {
    const customer = await stripe.customers.create({
      email: user && user.email ? user.email : undefined,
      metadata: { userId: user.id, username: user.username || '' },
    });
    await store.setStripeCustomer(user.id, customer.id);
    return customer.id;
  } catch (e) {
    console.error('[billing] ensureCustomer failed:', e && e.message ? e.message : e);
    return null;
  }
}

// Reconcile a user's premium flag against Stripe's LIVE subscription status — the
// source of truth. Self-healing: if the user has an active/trialing/past_due
// subscription, premium is (re)granted even when a webhook was missed or the
// is_premium flag drifted; if Stripe definitively shows no active subscription
// for any of their customers, premium is cleared. Looks the customer up by the
// stored stripe_customer_id AND by email (catches a missing/unpersisted mapping
// or a sub created under a different customer with the same email). On any Stripe
// error it leaves the flag UNCHANGED (never demote on a transient failure).
// Returns { isPremium, customerId } or null when billing/Stripe is unavailable.
async function reconcilePremiumForUser(stripe, user) {
  if (!stripe || !user) return null;
  try {
    const candidateIds = new Set();
    if (user.stripe_customer_id) candidateIds.add(user.stripe_customer_id);
    if (user.email) {
      try {
        const found = await stripe.customers.list({ email: user.email, limit: 10 });
        for (const c of (found && found.data) || []) candidateIds.add(c.id);
      } catch (e) { /* email lookup is best-effort */ }
    }
    if (candidateIds.size === 0) return { isPremium: !!user.is_premium, customerId: null };
    const PREMIUM_STATUSES = new Set(['active', 'trialing', 'past_due']);
    let activeCustomerId = null;
    for (const cid of candidateIds) {
      let subs;
      try {
        subs = await stripe.subscriptions.list({ customer: cid, status: 'all', limit: 20 });
      } catch (e) { return null; /* transient — do NOT demote */ }
      if (((subs && subs.data) || []).some(s => PREMIUM_STATUSES.has(s.status))) { activeCustomerId = cid; break; }
    }
    if (activeCustomerId) {
      if (!user.stripe_customer_id) { try { await store.setStripeCustomer(user.id, activeCustomerId); } catch (e) {} }
      if (!user.is_premium) await store.setPremiumByUserId(user.id, true, 'active');
      return { isPremium: true, customerId: activeCustomerId };
    }
    // Customers exist but none has a premium-worthy subscription -> not premium.
    if (user.is_premium) await store.setPremiumByUserId(user.id, false, 'canceled');
    return { isPremium: false, customerId: user.stripe_customer_id || null };
  } catch (e) {
    console.error('[billing] reconcilePremiumForUser failed:', e && e.message ? e.message : e);
    return null;
  }
}

// Register the JSON billing routes (config / checkout / portal). These run AFTER
// express.json() in server.js so req.body is parsed normally.
export function mountBilling(app) {
  // PUBLIC: lets the client decide whether to show the upgrade UI.
  app.get('/api/billing/config', (req, res) => {
    res.json({
      enabled: billingEnabled(),
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
      mode: 'subscription',
    });
  });

  // AUTH: create a Stripe-hosted Checkout Session (subscription) + return its URL.
  app.post('/api/billing/checkout', requireAuth, async (req, res) => {
    if (!billingEnabled()) return res.status(503).json({ error: 'Billing is not configured yet.' });
    try {
      const stripe = await getStripe();
      if (!stripe) return res.status(503).json({ error: 'Billing is not configured yet.' });
      const customerId = await ensureCustomer(stripe, req.user);
      if (!customerId) return res.status(502).json({ error: 'Could not start checkout. Please try again.' });
      const base = appUrl();
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
        customer: customerId,
        client_reference_id: req.userId,
        success_url: `${base}/?billing=success`,
        cancel_url: `${base}/?billing=cancel`,
        allow_promotion_codes: true,
      });
      res.json({ url: session.url });
    } catch (e) {
      console.error('[billing] checkout failed:', e && e.message ? e.message : e);
      res.status(502).json({ error: 'Could not start checkout. Please try again.' });
    }
  });

  // AUTH: open the Stripe Billing Portal so the user can manage/cancel.
  app.post('/api/billing/portal', requireAuth, async (req, res) => {
    if (!billingEnabled()) return res.status(503).json({ error: 'Billing is not configured yet.' });
    const customerId = req.user && req.user.stripe_customer_id;
    if (!customerId) return res.status(503).json({ error: 'No subscription to manage yet.' });
    try {
      const stripe = await getStripe();
      if (!stripe) return res.status(503).json({ error: 'Billing is not configured yet.' });
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${appUrl()}/`,
      });
      res.json({ url: session.url });
    } catch (e) {
      console.error('[billing] portal failed:', e && e.message ? e.message : e);
      res.status(502).json({ error: 'Could not open the billing portal. Please try again.' });
    }
  });

  // AUTH: self-heal premium from Stripe's live subscription status. The client
  // calls this on login so a paying user always gets premium back even if a
  // webhook was missed/dropped or the flag drifted. Idempotent + safe to call
  // often; returns the reconciled premium state.
  app.post('/api/billing/sync', requireAuth, async (req, res) => {
    const current = !!(req.user && req.user.is_premium);
    if (!billingEnabled()) return res.json({ enabled: false, isPremium: current });
    try {
      const stripe = await getStripe();
      if (!stripe) return res.json({ enabled: false, isPremium: current });
      const r = await reconcilePremiumForUser(stripe, req.user);
      res.json({ enabled: true, isPremium: r ? r.isPremium : current });
    } catch (e) {
      console.error('[billing] sync failed:', e && e.message ? e.message : e);
      res.json({ enabled: true, isPremium: current });
    }
  });
}

// --- Webhook ---------------------------------------------------------------
// Registered BEFORE express.json() with express.raw() so the raw body is intact
// for Stripe signature verification.

const CANCEL_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired']);

// Resolve a user id from a Stripe customer id (for premium flips that arrive
// keyed only by customer). Returns null if not found.
async function userIdForCustomer(customerId) {
  if (!customerId) return null;
  try {
    const u = await store.getUserByStripeCustomer(customerId);
    return u ? u.id : null;
  } catch (e) {
    console.error('[billing] userIdForCustomer failed:', e && e.message ? e.message : e);
    return null;
  }
}

// Handle a single verified Stripe event. Errors are RETHROWN so the webhook
// handler can return 500 and let Stripe retry (we must not silently drop a paid
// upgrade). Recording is idempotent on event.id, so a retry can't double-count.
//
// Revenue is recorded from EXACTLY ONE event type (invoice.payment_succeeded).
// Stripe fires BOTH checkout.session.completed AND invoice.paid/.payment_succeeded
// for a new subscription's first charge, each with a distinct event.id — so the
// stripe_event_id UNIQUE constraint does NOT dedupe them. To avoid double-counting,
// checkout.session.completed does the premium flip ONLY (no recordPayment), and
// invoice.paid is ignored for revenue.
async function handleEvent(event) {
  const type = event.type;
  const obj = (event.data && event.data.object) || {};

  // Defense-in-depth: in production the live endpoint must only ever see
  // live-mode events. If a misconfigured TEST secret were pointed at the live
  // webhook, test events would otherwise grant premium / record fake revenue.
  if (process.env.NODE_ENV === 'production' && event.livemode !== true) {
    console.error(`[billing] dropping non-livemode event ${event.id} (${type}) in production — refusing to mutate premium/ledger.`);
    return;
  }

  try {
    if (type === 'checkout.session.completed') {
      // SUBSCRIPTION premium flip ONLY. Themed piece-sets are now a premium
      // perk (no one-time purchases), so this path is purely the subscription
      // upgrade. Revenue is recorded on invoice.payment_succeeded so the first
      // charge isn't counted twice.
      const customerId = typeof obj.customer === 'string' ? obj.customer : (obj.customer && obj.customer.id);
      const userId = obj.client_reference_id || (await userIdForCustomer(customerId));
      if (userId) await store.setPremiumByUserId(userId, true, 'active');
      else if (customerId) await store.setPremiumByCustomer(customerId, true, 'active');
    } else if (type === 'invoice.payment_succeeded') {
      // The single source of truth for revenue (idempotent on event.id). Also
      // (re)affirm premium so renewals keep the user active.
      const customerId = typeof obj.customer === 'string' ? obj.customer : (obj.customer && obj.customer.id);
      const userId = await userIdForCustomer(customerId);
      if (customerId) await store.setPremiumByCustomer(customerId, true, 'active');
      await store.recordPayment({
        userId,
        eventId: event.id,
        amountCents: obj.amount_paid != null ? obj.amount_paid : 0,
        currency: obj.currency || 'usd',
        kind: 'subscription',
        createdAt: Date.now(),
      });
    } else if (type === 'invoice.paid') {
      // Intentionally NOT recording revenue here (would double-count with
      // invoice.payment_succeeded). Keep premium affirmed for safety.
      const customerId = typeof obj.customer === 'string' ? obj.customer : (obj.customer && obj.customer.id);
      if (customerId) await store.setPremiumByCustomer(customerId, true, 'active');
    } else if (type === 'customer.subscription.deleted') {
      const customerId = typeof obj.customer === 'string' ? obj.customer : (obj.customer && obj.customer.id);
      if (customerId) await store.setPremiumByCustomer(customerId, false, obj.status || 'canceled');
    } else if (type === 'customer.subscription.updated') {
      const customerId = typeof obj.customer === 'string' ? obj.customer : (obj.customer && obj.customer.id);
      if (customerId && CANCEL_STATUSES.has(obj.status)) {
        await store.setPremiumByCustomer(customerId, false, obj.status);
      } else if (customerId && obj.status === 'active') {
        await store.setPremiumByCustomer(customerId, true, 'active');
      }
    }
    // Unhandled event types are acknowledged (200) and ignored.
  } catch (e) {
    // Log for visibility, then RETHROW so the webhook returns 500 and Stripe
    // retries. Per-event-type isolation is preserved because each event is a
    // separate HTTP delivery — one failing type can't block another.
    console.error(`[billing] handler error for ${type} (${event.id}):`, e && e.message ? e.message : e);
    throw e;
  }
}

// Register POST /api/billing/webhook. MUST be mounted BEFORE express.json().
export function mountBillingWebhook(app) {
  app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    // Gate on the Stripe SECRET KEY (enough to verify webhook signatures),
    // independent of the subscription STRIPE_PRICE_ID.
    if (!stripeConfigured()) return res.status(503).json({ error: 'Billing is not configured yet.' });
    const stripe = await getStripe();
    if (!stripe) return res.status(503).json({ error: 'Billing is not configured yet.' });
    const sig = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;
    try {
      // req.body is a Buffer here thanks to express.raw().
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (e) {
      console.error('[billing] webhook signature verification failed:', e && e.message ? e.message : e);
      return res.status(400).json({ error: 'Invalid signature' });
    }
    // Process BEFORE acknowledging: the work is a couple of idempotent DB writes,
    // so it's fine to do inline. Only return 200 on success; on failure return
    // 500 so Stripe retries (otherwise a paid upgrade could be silently dropped).
    try {
      await handleEvent(event);
    } catch (e) {
      console.error('[billing] handleEvent failed, returning 500 for Stripe retry:', e && e.message ? e.message : e);
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
    res.json({ received: true });
  });
}

// Startup diagnostic (mirrors email.js): make the billing state obvious in logs.
export function logBillingStatus() {
  if (billingEnabled()) {
    console.log(`[billing] Stripe configured (subscription mode). Webhook: ${appUrl()}/api/billing/webhook` +
      (process.env.STRIPE_WEBHOOK_SECRET ? '' : ' — WARNING: STRIPE_WEBHOOK_SECRET is NOT set, webhooks will be rejected.'));
  } else {
    console.warn('[billing] STRIPE_SECRET_KEY / STRIPE_PRICE_ID not set — subscription billing is DISABLED (all /api/billing/* routes inert).');
  }
}

// --- Accurate revenue, straight from Stripe (the source of truth) -----------
// Immune to local-ledger double-counting (e.g. the historical bug that recorded
// one charge under checkout.session.completed AND both invoice events). Sums
// SUCCEEDED charges net of refunds, plus MRR / active-subscriber counts from
// live subscriptions, and a 30-day daily series for the dashboard chart.
// Cached ~5min (Stripe pagination is the expensive part). THROWS on failure so
// the admin endpoint can fall back to the local ledger.
let _revCache = { at: 0, data: null };
const REV_CACHE_MS = 5 * 60 * 1000;

export async function stripeRevenueStats() {
  if (!billingEnabled()) throw new Error('billing not configured');
  const now = Date.now();
  if (_revCache.data && (now - _revCache.at) < REV_CACHE_MS) return _revCache.data;
  const stripe = await getStripe();
  if (!stripe) throw new Error('stripe unavailable');

  const som = new Date(now); som.setUTCDate(1); som.setUTCHours(0, 0, 0, 0);
  const soy = new Date(now); soy.setUTCMonth(0, 1); soy.setUTCHours(0, 0, 0, 0);
  const monthMs = som.getTime(), yearMs = soy.getTime();
  const DAY = 86400000, since30 = now - 30 * DAY;

  let allTimeCents = 0, monthCents = 0, yearCents = 0, currency = 'usd';
  const daily = {}; const recent = []; let scanned = 0;
  for await (const ch of stripe.charges.list({ limit: 100 }).autoPagingEach()) {
    if (++scanned > 2000) break; // bound the scan so a big account can't hang the dashboard
    if (ch.status !== 'succeeded' || ch.paid !== true) continue;
    const net = (ch.amount || 0) - (ch.amount_refunded || 0);
    if (net <= 0) continue;
    if (ch.currency) currency = ch.currency;
    const ms = (ch.created || 0) * 1000;
    allTimeCents += net;
    if (ms >= monthMs) monthCents += net;
    if (ms >= yearMs) yearCents += net;
    if (ms >= since30) { const d = new Date(ms).toISOString().slice(0, 10); daily[d] = (daily[d] || 0) + net; }
    if (recent.length < 10) {
      const label = ch.description || (ch.billing_details && ch.billing_details.email) || ch.receipt_email || 'subscription';
      recent.push({ amountCents: net, currency: ch.currency || currency, createdAt: ms, label });
    }
  }

  let mrrCents = 0, activeSubscribers = 0;
  try {
    for await (const sub of stripe.subscriptions.list({ status: 'active', limit: 100 }).autoPagingEach()) {
      activeSubscribers++;
      for (const it of ((sub.items && sub.items.data) || [])) {
        const price = it.price || {};
        const amt = (price.unit_amount || 0) * (it.quantity || 1);
        const rec = price.recurring || {};
        const interval = rec.interval || 'month', ic = rec.interval_count || 1;
        let monthly = amt / ic;
        if (interval === 'year') monthly = amt / (12 * ic);
        else if (interval === 'week') monthly = amt * (52 / 12) / ic;
        else if (interval === 'day') monthly = amt * (365 / 12) / ic;
        mrrCents += Math.round(monthly);
      }
    }
  } catch (e) { /* MRR is best-effort */ }

  const dailyCents = [];
  for (let i = 29; i >= 0; i--) { const d = new Date(now - i * DAY).toISOString().slice(0, 10); dailyCents.push({ date: d, cents: daily[d] || 0 }); }
  recent.sort((a, b) => b.createdAt - a.createdAt);
  const arpuCents = activeSubscribers > 0 ? Math.round(allTimeCents / activeSubscribers) : allTimeCents;

  const data = {
    source: 'stripe', currency,
    allTimeCents, monthCents, yearCents,
    mrrCents, activeSubscribers, arpuCents,
    recentPayments: recent, dailyCents,
  };
  _revCache = { at: now, data };
  return data;
}
