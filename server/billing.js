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

function appUrl() {
  return (process.env.APP_URL || '').replace(/\/+$/, '');
}

// Lazily construct (and cache) the Stripe client from STRIPE_SECRET_KEY.
// Returns null when the secret is unset or the SDK can't be loaded — callers
// treat null as "billing unavailable" and respond 503. Never throws.
async function getStripe() {
  if (stripeClient) return stripeClient;
  if (stripeLoadFailed) return null;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  try {
    const mod = await import('stripe');
    const Stripe = mod.default || mod;
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
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
async function ensureCustomer(stripe, user) {
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

// Handle a single verified Stripe event. Each branch is wrapped so one failing
// event type can't crash the process; recording is idempotent on event.id.
async function handleEvent(event) {
  const type = event.type;
  const obj = (event.data && event.data.object) || {};
  try {
    if (type === 'checkout.session.completed') {
      const customerId = typeof obj.customer === 'string' ? obj.customer : (obj.customer && obj.customer.id);
      const userId = obj.client_reference_id || (await userIdForCustomer(customerId));
      if (userId) await store.setPremiumByUserId(userId, true, 'active');
      else if (customerId) await store.setPremiumByCustomer(customerId, true, 'active');
      if (obj.amount_total != null) {
        await store.recordPayment({
          userId,
          eventId: event.id,
          amountCents: obj.amount_total,
          currency: obj.currency || 'usd',
          kind: 'subscription',
          createdAt: Date.now(),
        });
      }
    } else if (type === 'invoice.paid' || type === 'invoice.payment_succeeded') {
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
    console.error(`[billing] handler error for ${type}:`, e && e.message ? e.message : e);
  }
}

// Register POST /api/billing/webhook. MUST be mounted BEFORE express.json().
export function mountBillingWebhook(app) {
  app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!billingEnabled()) return res.status(503).json({ error: 'Billing is not configured yet.' });
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
    // Acknowledge fast; process best-effort (handleEvent never throws).
    res.json({ received: true });
    handleEvent(event).catch((e) => console.error('[billing] handleEvent rejected:', e && e.message ? e.message : e));
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
