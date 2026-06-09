// Cosmetic STORE — themed piece-sets as a PREMIUM-SUBSCRIBER PERK.
//
// MONETIZATION MODEL (changed): the themed piece-sets are NO LONGER one-time
// microtransactions. They are now a perk of the active premium subscription —
// accessible only while the user's premium is active, and access revokes
// automatically when they cancel/suspend (the existing premium reconcile in
// billing.js handles revocation). There is no per-set purchase, no entitlement
// to grant, and no ownership to track: a user can equip ANY set iff is_premium.
//
// This module now only exposes the public catalog so the client knows which
// cosmetic sets exist; the client gates equip on the user's is_premium (from
// /api/me). The old POST /api/store/checkout one-time route + the entitlements
// grant/revoke call sites have been removed.

// The 19 themed sets (slugs + faction names mirror STORE_DESIGN.md §5).
// `name`/`factions` are server-owned display metadata so the catalog is
// authoritative (the client never decides what a SKU is). To add/seasonally-
// rotate sets, edit this list.
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

// The full catalog: premium-only cosmetics. Order matches STORE_DESIGN.md §5.
// `premium:true` signals these are gated on an active premium subscription; the
// client decides whether to allow equip based on the user's is_premium.
export function listProducts() {
  return SETS.map(s => ({ sku: s.sku, name: s.name, factions: s.factions, premium: true }));
}

// Register the store route. Mounted AFTER express.json() in server.js.
export function mountStore(app) {
  // PUBLIC catalog of the premium cosmetic sets. No ownership / pricing — these
  // are a premium perk; the client gates equip on the user's is_premium.
  app.get('/api/store/catalog', (req, res) => {
    res.json(listProducts());
  });
}

// Startup diagnostic: how many premium cosmetic sets exist.
export function logStoreStatus() {
  console.log(`[store] ${SETS.length} premium cosmetic piece-set(s) available to active premium subscribers.`);
}
