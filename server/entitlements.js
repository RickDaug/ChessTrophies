// Cosmetic STORE — one-time purchases of themed piece-sets + entitlements.
//
// NON-PREDATORY: each set is a $2.99 one-time purchase, owned forever, cosmetic
// only (zero competitive impact). This module reuses the existing Stripe
// integration (server/billing.js) for the checkout-session + webhook plumbing;
// it only adds the catalog + one-time checkout routes here. The webhook GRANT
// itself lives in billing.js handleEvent (so a single verified webhook delivery
// drives both subscription premium-flips and one-time set grants), keyed off
// session.mode / metadata.kind so the two paths never interfere.
//
// Ownership is SERVER-VERIFIED: the catalog's `owned` flag and /api/me's
// ownedSets come from the entitlements table, never from the client.
//
// Pricing/rollout (STORE_DESIGN.md §6): every set is $2.99. A set is sellable
// only once its one-time Stripe Price id is configured via env
// STRIPE_PRICE_SET_<SLUG_UPPER_SNAKE> (e.g. STRIPE_PRICE_SET_SAMURAI_NINJA).
// Until then the catalog marks it `comingSoon:true` (preview only) — this env
// gate is what keeps un-reviewed art unsold.

import { requireAuth, verifyToken } from './auth.js';
import * as store from './store.js';
import { getStripe, ensureCustomer, appUrl, stripeConfigured } from './billing.js';

// The 19 themed sets (slugs + faction names mirror STORE_DESIGN.md §5). The
// price is a flat 299 cents each. `name`/`factions` are server-owned display
// metadata so the catalog is authoritative (the client never decides what a SKU
// is or costs). To add/seasonally-rotate sets, edit this list.
export const STORE_PRICE_CENTS = 299;

const SETS = [
  { sku: 'samurai-ninja',         name: 'Samurai vs Ninja',            factions: { w: 'Samurai', b: 'Ninja' } },
  { sku: 'medieval-crusaders',    name: 'Medieval vs Crusaders',       factions: { w: 'Medieval Europe', b: 'Crusaders' } },
  { sku: 'romans-barbarians',     name: 'Romans vs Barbarians',        factions: { w: 'Romans', b: 'Barbarians' } },
  { sku: 'spartans-persians',     name: 'Spartans vs Persians',        factions: { w: 'Spartans', b: 'Persians' } },
  { sku: 'vikings-saxons',        name: 'Vikings vs Anglo-Saxons',     factions: { w: 'Vikings', b: 'Anglo-Saxons' } },
  { sku: 'pirates-navy',          name: 'Pirates vs Royal Navy',       factions: { w: 'Pirates', b: 'Royal Navy' } },
  { sku: 'templars-saracens',    name: 'Templars vs Saracens',        factions: { w: 'Knights Templar', b: 'Saracens' } },
  { sku: 'aztecs-conquistadors',  name: 'Aztecs vs Conquistadors',     factions: { w: 'Aztecs', b: 'Conquistadors' } },
  { sku: 'egypt-nubia',           name: 'Egypt vs Nubia',              factions: { w: 'Ancient Egypt', b: 'Nubia' } },
  { sku: 'gods-titans',           name: 'Gods vs Titans',              factions: { w: 'Greek Gods', b: 'Titans' } },
  { sku: 'arthur-morgan',         name: 'Arthur vs Morgan Le Fay',     factions: { w: 'King Arthur', b: 'Morgan Le Fay' } },
  { sku: 'dragons-slayers',       name: 'Dragons vs Dragon Slayers',   factions: { w: 'Dragons', b: 'Dragon Slayers' } },
  { sku: 'angels-demons',         name: 'Angels vs Demons',            factions: { w: 'Angels', b: 'Demons' } },
  { sku: 'orcs-elves',            name: 'Elves vs Orcs',               factions: { w: 'Elves', b: 'Orcs' } },
  { sku: 'wizards-necromancers',  name: 'Wizards vs Necromancers',     factions: { w: 'Wizards', b: 'Necromancers' } },
  { sku: 'steampunk-clockwork',   name: 'Steampunk vs Clockwork',      factions: { w: 'Steampunk Empire', b: 'Clockwork Rebels' } },
  { sku: 'aliens-humans',         name: 'Humans vs Aliens',            factions: { w: 'Humans', b: 'Aliens' } },
  { sku: 'robots-cyborgs',        name: 'Robots vs Cyborgs',           factions: { w: 'Robots', b: 'Cyborgs' } },
  { sku: 'zombies-survivors',     name: 'Survivors vs Zombies',        factions: { w: 'Survivors', b: 'Zombies' } },
];

const SETS_BY_SKU = new Map(SETS.map(s => [s.sku, s]));

// Map a slug to its env var name: 'samurai-ninja' -> STRIPE_PRICE_SET_SAMURAI_NINJA.
function priceEnvName(sku) {
  return 'STRIPE_PRICE_SET_' + String(sku).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

// The configured one-time Stripe Price id for a SKU, or '' if not set yet.
function stripePriceId(sku) {
  return (process.env[priceEnvName(sku)] || '').trim();
}

// Resolve a product record (with live pricing/comingSoon) for a SKU, or null.
// A set is `comingSoon` (preview only, not purchasable) until BOTH Stripe is
// configured AND this SKU has its one-time price id in env.
export function getProduct(sku) {
  const meta = SETS_BY_SKU.get(sku);
  if (!meta) return null;
  const priceId = stripePriceId(sku);
  const comingSoon = !(stripeConfigured() && priceId);
  return {
    sku: meta.sku,
    name: meta.name,
    factions: meta.factions,
    priceCents: STORE_PRICE_CENTS,
    stripePriceId: priceId || null,
    comingSoon,
  };
}

// The full catalog (no ownership). Order matches STORE_DESIGN.md §5.
export function listProducts() {
  return SETS.map(s => getProduct(s.sku));
}

// Best-effort optional auth: resolve a user id from a Bearer token if present
// and valid, else null. Never throws and never 401s — public routes use this so
// an anonymous caller simply gets owned:false.
async function optionalUserId(req) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token ? verifyToken(token) : null;
    return payload && payload.uid ? payload.uid : null;
  } catch {
    return null;
  }
}

// Register the JSON store routes. Mounted AFTER express.json() (so req.body is
// parsed) and AFTER mountBilling in server.js. The webhook GRANT is handled in
// billing.js (single raw-body webhook), not here.
export function mountStore(app) {
  // PUBLIC catalog. `owned` is true only when a valid Bearer token resolves to a
  // user who owns the SKU (optional auth); anonymous callers get owned:false.
  app.get('/api/store/catalog', async (req, res, next) => {
    try {
      const userId = await optionalUserId(req);
      const owned = userId ? new Set(await store.listUserSkus(userId)) : new Set();
      const catalog = listProducts().map(p => ({
        sku: p.sku,
        name: p.name,
        factions: p.factions,
        priceCents: p.priceCents,
        comingSoon: p.comingSoon,
        owned: owned.has(p.sku),
      }));
      res.json(catalog);
    } catch (e) { next(e); }
  });

  // AUTH: start a one-time Stripe Checkout Session for a single set.
  app.post('/api/store/checkout', requireAuth, async (req, res) => {
    if (!stripeConfigured()) return res.status(503).json({ error: 'The store is not configured yet.' });
    const sku = req.body && typeof req.body.sku === 'string' ? req.body.sku : '';
    const product = getProduct(sku);
    if (!product) return res.status(400).json({ error: 'Unknown set.' });
    if (product.comingSoon || !product.stripePriceId) {
      return res.status(400).json({ error: 'This set is not available for purchase yet.' });
    }
    // Already owned — don't let the user pay twice for the same cosmetic.
    try {
      if (await store.userOwnsSku(req.userId, sku)) {
        return res.status(400).json({ error: 'You already own this set.' });
      }
    } catch (e) { /* fall through; the grant stays idempotent regardless */ }
    try {
      const stripe = await getStripe();
      if (!stripe) return res.status(503).json({ error: 'The store is not configured yet.' });
      const customerId = await ensureCustomer(stripe, req.user);
      if (!customerId) return res.status(502).json({ error: 'Could not start checkout. Please try again.' });
      const base = appUrl();
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: product.stripePriceId, quantity: 1 }],
        customer: customerId,
        client_reference_id: req.userId,
        metadata: { sku: product.sku, kind: 'piece_set' },
        // Mirror the metadata onto the resulting PaymentIntent so refund/dispute
        // events (which arrive on the charge, not the session) can resolve the sku.
        payment_intent_data: { metadata: { sku: product.sku, kind: 'piece_set', userId: req.userId } },
        success_url: `${base}/?store=success`,
        cancel_url: `${base}/?store=cancel`,
        allow_promotion_codes: true,
      });
      res.json({ url: session.url });
    } catch (e) {
      console.error('[store] checkout failed:', e && e.message ? e.message : e);
      res.status(502).json({ error: 'Could not start checkout. Please try again.' });
    }
  });
}

// Startup diagnostic: how many sets are live vs preview-only.
export function logStoreStatus() {
  const live = listProducts().filter(p => !p.comingSoon).length;
  if (!stripeConfigured()) {
    console.warn(`[store] STRIPE_SECRET_KEY not set — all ${SETS.length} sets are preview-only (comingSoon).`);
  } else {
    console.log(`[store] ${live}/${SETS.length} piece-set(s) live for purchase; the rest are preview-only until STRIPE_PRICE_SET_<SLUG> is set.`);
  }
}
