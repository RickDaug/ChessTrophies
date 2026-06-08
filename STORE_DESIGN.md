# ChessTrophies — Themed Piece-Set Store (design + art bible + progress)

**Status:** IN PROGRESS (started 2026-06-08). This is the living, resumable spec for the
cosmetic Store + the 19 themed chess-piece/board sets. Read this first when resuming.

---

## 1. Goal & principles (NON-PREDATORY)

Sell premium **themed chess-piece + board sets** ($2.99 each, owned forever) via a **Store
under Profile**. Cosmetic only — zero competitive impact. Rules we hold to:

- **Generous free base.** Classic Staunton + the existing 8 board / 5 piece themes stay FREE.
- **Owned forever**, one-time purchase. No subscriptions-to-keep, no rentals.
- **Preview before buy** — the user sees the full set on a live mini-board first.
- **No loot boxes, no randomness, no pay-to-win, never rating-affecting.**
- Clear price, clear ownership, instant equip after purchase.
- Subscriber ("Supporter") perk later: unlock all sets — makes the sub more compelling.

## 2. Architecture

### Data shape — `sets/<slug>.json` (one file per set; art agents own these)
```json
{
  "slug": "samurai-ninja",
  "name": "Samurai vs Ninja",
  "factions": { "w": "Samurai", "b": "Ninja" },
  "board": { "light": "#e8d8b0", "dark": "#8a5a34", "border": "#2e2013",
             "lastMove": "#d9b35a", "select": "#f0c850", "hint": "#5aa9e6" },
  "pieces": {
    "w": { "p": "<svg viewBox=\"0 0 45 45\">…</svg>", "n": "…", "b": "…", "r": "…", "q": "…", "k": "…" },
    "b": { "p": "…", "n": "…", "b": "…", "r": "…", "q": "…", "k": "…" }
  }
}
```

### Client engine — `piece-sets.js` (manifest + loader; OWNED BY MAIN, not agents)
- `window.CT_PIECE_SETS_MANIFEST` — light metadata for all sets (slug, name, factions, price, era, accent).
- `window.CT_Sets` — `manifest()`, `get(slug)`, `load(slug)` (lazy-fetch `sets/<slug>.json`, cache),
  `equip(slug)` (apply board colors + set active piece SVGs + persist + re-render), `activeSet()`,
  `pieceSVG(type,color)` (returns themed SVG or null).
- `app.js` `pieceSVG()` first calls `window.CT_Sets.pieceSVG(type,color)`; falls back to Staunton.
- Lazy-load keeps the main bundle lean: heavy SVG only fetched when a set is previewed/equipped/owned.

### Backend — entitlements (OWNED BY THE BACKEND AGENT)
- `products` table (sku, name, type='piece_set', price_cents, stripe_price_id, active).
- `entitlements` table (user_id, sku, granted_at, source_event_id) — UNIQUE(user_id, sku).
- `GET /api/store/catalog` (public) — sets + price + `owned` flag for the auth'd user.
- `POST /api/store/checkout` (auth) — Stripe Checkout `mode:'payment'`, one-time, `metadata.sku` + `client_reference_id`.
- Webhook: extend `checkout.session.completed` (one-time path) → grant entitlement in the SAME tx as the payment row (idempotent on event id). Handle `charge.refunded` → revoke.
- `GET /api/me` includes `ownedSets:[...]`. **Equip is server-verified** — never trust a client-only unlock.
- Until a set has a real `stripe_price_id` configured, catalog marks it `comingSoon` (preview only). This is the gate that keeps art un-sold until reviewed.

## 3. Store UX (under Profile)
- A **"🛍️ Store"** entry on the Profile screen (and a lobby/nav hook later).
- Grid of set cards: faction names, a live mini-board thumbnail (8×8 of the actual SVGs), price or "Owned"/"Equip"/"Coming soon".
- Tap a card → detail sheet: full board preview with both factions in starting position, "Buy $2.99" (Stripe) or "Equip" if owned. Purchase success → confetti + the set sweeps onto the board (reuse `ctCelebrate`).

## 4. ART BIBLE (every set MUST follow this)

**Canvas:** every piece is `<svg viewBox="0 0 45 45">` (identical footprint to the Staunton
`pieceSVG`, so it drops into the same board cells, sized to 88%). No width/height attrs.

**Legibility is law (chess first, theme second):**
- **White-side ("w") pieces must read as LIGHT** — predominantly ivory/cream/pale fills with a
  dark outline. **Black-side ("b") pieces must read as DARK** — charcoal/near-black fills with a
  light/steel outline. This holds REGARDLESS of theme, so the board is always playable.
- Theme identity comes through **silhouette + a faction ACCENT color + a small emblem**, never by
  making the white side dark. (e.g. Samurai=ivory armor w/ red+gold accents; Ninja=charcoal w/ steel accents.)

**Style:** bold, flat, **heraldic silhouette** — clean iconic shapes, strong negative space, 1.2–1.6px
outline (`stroke`), minimal gradients (a single soft highlight/shadow pair max). Think premium flat
game-icon, not clip-art and not fussy detail that vanishes at ~40px.

**Construction (consistency across all 228 pieces):**
- Every piece in a set sits on the **same base/plinth** (a simple 2–3 tier stand or themed footing) so
  the set looks like one family.
- Recognizable **chess-role silhouette** per piece (a player must instantly tell pawn from bishop):
  - **pawn** = the most numerous/foot unit (soldier, minion, grunt) — smallest, simplest.
  - **knight** = a mounted figure or beast head (keep a horse-like profile cue where possible — players expect the "knight = horse-ish profile").
  - **bishop** = a tall, slender caster/priest/standard (vertical, mitre/hood/staff cue).
  - **rook** = a structure/fortress (tower, ship, gate, monolith) — blocky, wide, stable.
  - **queen** = the most powerful figure (crowned/regal/divine female or apex icon) — tall, ornate, widest crown.
  - **king** = the leader/boss (tallest, a crown/helm + a cross/orb/emblem on top to distinguish from queen).
- **Distinct queen vs king** silhouettes (the #1 failure mode — make them clearly different heights/headpieces).

**Per piece, keep it tasteful:** 6–25 path elements, grouped in `<g>`, fills from the set's palette
(2–3 faction colors + 1 metallic accent + outline). Validate every SVG parses as well-formed XML.

**Quality checklist (each set):** (1) white reads light / black reads dark on both square colors;
(2) all 6 roles distinguishable in silhouette; (3) queen≠king; (4) consistent base across the set;
(5) faction theme obvious within ~1s; (6) no text, no tiny illegible detail; (7) board colors chosen
for piece contrast.

## 5. The 19 sets (w = lighter faction, b = darker faction)

For each: slug — w-faction / b-faction — palette cue — signature motifs. Pieces follow the role rules above.

1. **samurai-ninja** — Samurai / Ninja — ivory+red+gold / charcoal+steel — pawn: ashigaru spearman/ninja w/ tanto; knight: armored warhorse/ninja on shadow-steed; bishop: monk w/ staff/ninja w/ kusarigama; rook: pagoda castle/watchtower; queen: onna-bugeisha w/ naginata/kunoichi; king: daimyo in kabuto+crest/ninja grandmaster, crown-emblem on top.
2. **medieval-crusaders** — Medieval Europe / Crusaders — silver+blue+gold / white+crimson-cross+steel — pawn: man-at-arms/crusader footman; knight: barded destrier; bishop: mitred bishop/templar chaplain; rook: stone keep/siege tower; queen: crowned queen/regal abbess; king: crowned king w/ cross / crusader king w/ red-cross helm.
3. **romans-barbarians** — Romans / Barbarians — ivory+imperial-red+gold / iron+brown+fur — pawn: legionary w/ scutum/barbarian warrior; knight: cavalry horse/wild horse; bishop: senator/druid w/ staff; rook: castrum tower/wooden palisade; queen: roman matron/shieldmaiden; king: Caesar laurel crown/barbarian chieftain w/ horned helm.
4. **spartans-persians** — Spartans / Persians — bronze+crimson-cloak+ivory / royal-purple+gold+dark — pawn: hoplite w/ lambda shield/immortal w/ wicker shield; knight: war horse; bishop: oracle/magi w/ fire; rook: phalanx gate/persian gate; queen: spartan queen/persian noblewoman; king: Leonidas crested helm/Xerxes tall crown.
5. **vikings-saxons** — Vikings / Anglo-Saxons — steel+sky-blue+silver / earth-green+gold+bronze — pawn: viking raider w/ axe/saxon fyrd spearman; knight: nordic horse; bishop: seer/monk; rook: longship prow/burh palisade; queen: shieldmaiden/saxon lady; king: jarl horned-ish helm (no over-horned cliché, use winged)/saxon king w/ crown.
6. **pirates-navy** — Pirates / Royal Navy — bone-white+black+red / navy-blue+gold+white — pawn: pirate w/ cutlass/marine w/ musket; knight: ?? use a seahorse or a charging horse w/ naval barding; bishop: ship's quartermaster w/ spyglass/chaplain; rook: galleon stern/man-o-war w/ cannons; queen: pirate captain (tricorne)/admiral's lady; king: pirate king w/ skull-emblem hat/naval admiral w/ bicorne.
7. **templars-saracens** — Knights Templar / Saracens — white+red-cross+steel / desert-tan+green+gold — pawn: templar sergeant/saracen footman w/ scimitar; knight: barded horse; bishop: templar chaplain/imam-scholar; rook: crusader fortress/desert citadel; queen: noble lady/sultana; king: grand master w/ cross/sultan w/ turban-crown.
8. **aztecs-conquistadors** — Aztecs / Conquistadors — jade-green+turquoise+gold / steel+crimson+silver — pawn: jaguar warrior/spanish soldier w/ pike; knight: ?? feathered serpent mount/spanish warhorse; bishop: feathered priest/friar w/ cross; rook: step-pyramid/spanish fort; queen: aztec priestess/spanish noblewoman; king: emperor w/ feather headdress/conquistador captain w/ morion helm.
9. **egypt-nubia** — Ancient Egypt / Nubia — gold+lapis-blue+ivory / ebony+gold+red-ochre — pawn: spearman/nubian archer; knight: chariot horse; bishop: priest of Ra/nubian shaman; rook: pylon temple/desert fortress (Kerma deffufa); queen: Cleopatra/Nubian queen (Kandake); king: pharaoh w/ nemes+cobra/nubian king w/ tall crown.
10. **gods-titans** — Greek Gods / Titans — marble-white+sky-gold / storm-grey+earthen+ember — pawn: hoplite-of-olympus/titan-spawn; knight: pegasus/primordial beast; bishop: oracle/elder titan; rook: olympian temple/mountain (Othrys); queen: Hera/Gaia; king: Zeus w/ lightning crown/Cronus w/ scythe motif.
11. **arthur-morgan** — King Arthur / Morgan Le Fay — silver+camelot-blue+gold / dark-violet+green+black — pawn: knight of the round table/fae warrior; knight: white steed/nightmare steed; bishop: Merlin-esque sage/sorceress acolyte; rook: Camelot tower/dark spire; queen: Guinevere/Morgan le Fay (apex sorceress); king: Arthur w/ Excalibur+crown/dark fae king or evoke Morgan’s consort — keep king male leader.
12. **dragons-slayers** — Dragons / Dragon Slayers — emerald+gold+amber / steel+crimson+iron — pawn: drake/slayer soldier; knight: wyvern/slayer on warhorse; bishop: dragon-priest/order chaplain; rook: dragon-roost crag/fortified keep; queen: dragon matriarch (winged)/slayer-queen w/ lance; king: elder dragon w/ horned crown/dragon-slayer king w/ trophy-helm.
13. **angels-demons** — Angels / Demons — radiant-white+gold+sky / obsidian+ember-red+brass — pawn: lesser angel/imp; knight: winged celestial steed/hell-steed; bishop: seraph w/ scroll/warlock; rook: heavenly gate/infernal tower; queen: archangel (wide wings)/demon queen (horns+wings); king: high seraph w/ halo-crown/demon lord w/ crown of horns.
14. **orcs-elves** — Elves (w) / Orcs (b) — pale-gold+forest-green+silver / dark-iron+blood-red+bone — pawn: elf archer/orc grunt; knight: stag or elk mount/dire-wolf or boar mount; bishop: elven druid/orc shaman; rook: living-tree fortress/spiked war-tower; queen: elven queen (elegant)/orc warqueen; king: elf-king w/ leaf crown/orc warlord w/ tusked helm.
15. **wizards-necromancers** — Wizards / Necromancers — azure+silver+gold / sickly-green+bone+violet — pawn: apprentice/skeleton; knight: enchanted horse/bone-steed; bishop: archmage/lich-priest; rook: wizard tower/bone spire; queen: sorceress/necro-queen; king: archwizard w/ star-crown+staff/necromancer-king w/ skull-crown.
16. **steampunk-clockwork** — Steampunk Empire / Clockwork Rebels — brass+ivory+copper / gunmetal+teal+bronze — pawn: goggled rifleman/clockwork soldier; knight: mechanical horse/cog-beast; bishop: inventor w/ wrench-staff/automaton-priest; rook: brass tower w/ gears/clockwork fortress; queen: airship-captain lady/clockwork queen; king: steam-emperor w/ gear-crown/rebel leader w/ clockwork crown.
17. **aliens-humans** — Humans (w) / Aliens (b) — white+steel-blue+orange / black+bio-green+violet — pawn: marine/alien drone; knight: combat mech or warhorse-APC/bio-beast; bishop: officer w/ comms/hive-priest; rook: bunker/biomech tower; queen: commander/alien hive-queen (apex); king: human general w/ insignia crown/alien overlord w/ crown of mandibles.
18. **robots-cyborgs** — Robots / Cyborgs — chrome-white+cyan+steel / dark-gunmetal+red+amber — pawn: utility bot/cyborg soldier; knight: quadruped robot/cyber-steed; bishop: sensor-droid/cyber-oracle; rook: server-tower/reactor fortress; queen: android queen/cyber-empress; king: central-AI core w/ crown-array/cyborg king w/ optic-crown.
19. **zombies-survivors** — Survivors (w) / Zombies (b) — khaki+steel+orange / rotten-green+grey+blood — pawn: survivor w/ bat/shambler zombie; knight: survivor on horse/zombie-horse; bishop: medic/radio-operator/plague-bringer; rook: barricaded outpost/ruined tower; queen: survivor leader (female)/zombie brute-queen; king: survivor commander/zombie patient-zero w/ grisly crown.

## 6. Pricing & rollout
- $2.99 / set (USD), one-time, `mode:'payment'`. Stripe one-time Price per SKU (created later by the owner).
- Launch state: catalog visible with **previews**; "Buy" shows "Coming soon" until each set's `stripe_price_id` is configured. Owner reviews art → creates Stripe prices → flips live.
- Future: "Supporter" sub unlocks all; thematic bundles; seasonal sets.

## 7. PROGRESS TRACKER
Legend: ⬜ not started · 🟨 art drafted (needs render-review) · ✅ reviewed/approved · 🔧 infra

### Infrastructure
- 🔧 STORE_DESIGN.md (this doc) — DONE
- ⬜ piece-sets.js manifest + loader (CT_Sets) — main
- ⬜ app.js pieceSVG themed override + equip/board application — main
- ⬜ Store UI under Profile (shop.js + screen) — main
- ⬜ Backend entitlements (products/entitlements, catalog, one-time checkout, webhook grant, ownedSets) — backend agent
- ⬜ Build: include sets/ + piece-sets.js in dist; lazy-load wiring
- ⬜ Tests (entitlements, catalog ownership, webhook grant idempotency)

### Art sets (sets/<slug>.json)
| # | slug | status |
|---|------|--------|
|1|samurai-ninja|⬜|
|2|medieval-crusaders|⬜|
|3|romans-barbarians|⬜|
|4|spartans-persians|⬜|
|5|vikings-saxons|⬜|
|6|pirates-navy|⬜|
|7|templars-saracens|⬜|
|8|aztecs-conquistadors|⬜|
|9|egypt-nubia|⬜|
|10|gods-titans|⬜|
|11|arthur-morgan|⬜|
|12|dragons-slayers|⬜|
|13|angels-demons|⬜|
|14|orcs-elves|⬜|
|15|wizards-necromancers|⬜|
|16|steampunk-clockwork|⬜|
|17|aliens-humans|⬜|
|18|robots-cyborgs|⬜|
|19|zombies-survivors|⬜|

**Note:** Superheroes vs Supervillains intentionally DROPPED (copyright risk, per owner).
Art is a first pass authored as vector silhouettes — owner to review rendered previews before enabling sales.
