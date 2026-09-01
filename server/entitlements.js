// Cosmetic STORE — themed piece-sets, free for everyone.
//
// There is no monetization here. The sets were once one-time microtransactions,
// then a premium-subscription perk; subscription billing was removed in 2026-08
// and every set is now simply free. There is no purchase route, no entitlement
// to grant, and no ownership to track — anyone can equip any set.
//
// This module exposes only the public catalog, so the client knows which sets
// exist.

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

// The full catalog. Order matches STORE_DESIGN.md §5. No price and no gate —
// every set is equippable by anyone.
export function listProducts() {
  return SETS.map(s => ({ sku: s.sku, name: s.name, factions: s.factions }));
}

// Register the store route. Mounted AFTER express.json() in server.js.
export function mountStore(app) {
  // PUBLIC catalog of the cosmetic sets. No ownership, no pricing, no gate.
  app.get('/api/store/catalog', (req, res) => {
    res.json(listProducts());
  });
}

// Startup diagnostic: how many cosmetic sets exist.
export function logStoreStatus() {
  console.log(`[store] ${SETS.length} cosmetic piece-set(s) available, free to everyone.`);
}
