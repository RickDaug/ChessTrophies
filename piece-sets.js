/*
 * piece-sets.js — Premium themed piece/board SET engine (manifest + lazy loader).
 *
 * A "set" = a full board palette + 12 themed SVG pieces (6 roles x 2 sides), sold
 * in the Store ($2.99, owned forever). See STORE_DESIGN.md for the art bible + data
 * shape. Heavy SVG lives in sets/<slug>.json and is fetched ONLY when a set is
 * previewed/equipped — the main bundle stays lean.
 *
 * Integration: app.js pieceSVG() calls window.CT_Sets.pieceSVG(type,color) first and
 * falls back to the built-in Staunton renderer when no themed set is active or the
 * piece isn't available. Board colors are applied via CSS vars on <html>.
 *
 * Ownership is server-authoritative (entitlements); this client engine only renders
 * what the user owns/previews. Equipping a not-owned set is allowed for PREVIEW but
 * the Store gates the actual purchase server-side.
 */
(function () {
  'use strict';

  // Light metadata for every set (no heavy SVG). price in cents. accent = a CSS color
  // used for the Store card's faction chip. era = grouping label.
  var MANIFEST = [
    { slug: 'samurai-ninja',       name: 'Samurai vs Ninja',                 factions: { w: 'Samurai', b: 'Ninja' },              price: 299, era: 'Feudal Japan',   accent: '#c0392b' },
    { slug: 'medieval-crusaders',  name: 'Medieval Europe vs Crusaders',     factions: { w: 'Knights', b: 'Crusaders' },          price: 299, era: 'Middle Ages',    accent: '#c0392b' },
    { slug: 'romans-barbarians',   name: 'Romans vs Barbarians',             factions: { w: 'Romans', b: 'Barbarians' },          price: 299, era: 'Antiquity',      accent: '#b03a2e' },
    { slug: 'spartans-persians',   name: 'Spartans vs Persians',             factions: { w: 'Spartans', b: 'Persians' },          price: 299, era: 'Antiquity',      accent: '#7d3c98' },
    { slug: 'vikings-saxons',      name: 'Vikings vs Anglo-Saxons',          factions: { w: 'Vikings', b: 'Anglo-Saxons' },       price: 299, era: 'Dark Ages',      accent: '#2e86c1' },
    { slug: 'pirates-navy',        name: 'Pirates vs Royal Navy',            factions: { w: 'Pirates', b: 'Royal Navy' },         price: 299, era: 'Age of Sail',    accent: '#1f3a93' },
    { slug: 'templars-saracens',   name: 'Knights Templar vs Saracens',      factions: { w: 'Templars', b: 'Saracens' },          price: 299, era: 'Crusades',       accent: '#229954' },
    { slug: 'aztecs-conquistadors',name: 'Aztecs vs Conquistadors',          factions: { w: 'Aztecs', b: 'Conquistadors' },       price: 299, era: 'New World',      accent: '#16a085' },
    { slug: 'egypt-nubia',         name: 'Ancient Egypt vs Nubia',           factions: { w: 'Egypt', b: 'Nubia' },                price: 299, era: 'Ancient',        accent: '#c9a227' },
    { slug: 'gods-titans',         name: 'Greek Gods vs Titans',             factions: { w: 'Gods', b: 'Titans' },                price: 299, era: 'Mythology',      accent: '#d4ac0d' },
    { slug: 'arthur-morgan',       name: 'King Arthur vs Morgan Le Fay',     factions: { w: 'Camelot', b: 'Morgan' },             price: 299, era: 'Arthurian',      accent: '#5b2c6f' },
    { slug: 'dragons-slayers',     name: 'Dragons vs Dragon Slayers',        factions: { w: 'Dragons', b: 'Slayers' },            price: 299, era: 'Fantasy',        accent: '#1e8449' },
    { slug: 'angels-demons',       name: 'Angels vs Demons',                 factions: { w: 'Angels', b: 'Demons' },              price: 299, era: 'Celestial',      accent: '#b9770e' },
    { slug: 'orcs-elves',          name: 'Orcs vs Elves',                    factions: { w: 'Elves', b: 'Orcs' },                 price: 299, era: 'Fantasy',        accent: '#1e8449' },
    { slug: 'wizards-necromancers',name: 'Wizards vs Necromancers',          factions: { w: 'Wizards', b: 'Necromancers' },       price: 299, era: 'Arcane',         accent: '#2471a3' },
    { slug: 'steampunk-clockwork', name: 'Steampunk Empire vs Clockwork Rebels', factions: { w: 'Empire', b: 'Rebels' },         price: 299, era: 'Steampunk',      accent: '#b9770e' },
    { slug: 'aliens-humans',       name: 'Aliens vs Humans',                 factions: { w: 'Humans', b: 'Aliens' },              price: 299, era: 'Sci-Fi',         accent: '#16a085' },
    { slug: 'robots-cyborgs',      name: 'Robots vs Cyborgs',                factions: { w: 'Robots', b: 'Cyborgs' },             price: 299, era: 'Sci-Fi',         accent: '#17a2b8' },
    { slug: 'zombies-survivors',   name: 'Zombies vs Survivors',             factions: { w: 'Survivors', b: 'Zombies' },          price: 299, era: 'Apocalypse',     accent: '#7f8c8d' }
  ];

  // TROPHY UNLOCKS — a curated subset of sets is earnable FREE by hitting a
  // milestone trophy (no Premium needed); the rest stay Premium-only so the
  // subscription keeps real exclusive value. slug -> { ach: <achievement id>,
  // label: <how to earn it> }. The achievement ids live in trophy-data.js.
  var UNLOCKS = {
    'vikings-saxons':       { ach: 'streak_t4',  label: 'Win 10 ranked games in a row' },
    'gods-titans':          { ach: 'wins_t6',    label: 'Win 100 ranked games' },
    'dragons-slayers':      { ach: 'gauntlet_t4', label: 'Beat every Gauntlet challenger' },
    'spartans-persians':    { ach: 'arena_t2',   label: 'Win 5 arena tournaments' },
    'wizards-necromancers': { ach: 'open_t3',    label: 'Master all 7 trainer openings' },
    'robots-cyborgs':       { ach: 'puz_t3',     label: 'Solve 100 tactics puzzles' }
  };

  var EQUIP_KEY = 'ct_equipped_set';
  var cache = {};      // slug -> full set json
  var pending = {};    // slug -> Promise (de-dupe concurrent loads)
  var activeSlug = null;
  var unlockedSlugs = []; // sets the user has earned via trophies (computed from achievements)

  function apiBase() {
    try { return (window.CT_SERVER_URL || '').replace(/\/+$/, ''); } catch (e) { return ''; }
  }

  function manifest() { return MANIFEST.slice(); }
  function get(slug) { for (var i = 0; i < MANIFEST.length; i++) if (MANIFEST[i].slug === slug) return MANIFEST[i]; return null; }
  function isCached(slug) { return !!cache[slug]; }

  // Lazy-fetch a set's full JSON (board + 12 SVGs). Cached + de-duped.
  function load(slug) {
    if (cache[slug]) return Promise.resolve(cache[slug]);
    if (pending[slug]) return pending[slug];
    var url = apiBase() ? (apiBase() + '/sets/' + slug + '.json') : ('sets/' + slug + '.json');
    // Same-origin first (Vercel serves /sets/), else fall back to the API origin.
    pending[slug] = fetch('sets/' + slug + '.json', { cache: 'force-cache' })
      .then(function (r) { if (r.ok) return r.json(); throw new Error('local miss'); })
      .catch(function () { return fetch(url).then(function (r) { return r.json(); }); })
      .then(function (json) { cache[slug] = json; delete pending[slug]; return json; })
      .catch(function (e) { delete pending[slug]; throw e; });
    return pending[slug];
  }

  // Apply a set's board palette via CSS custom properties on <html>. Both the game
  // board and the puzzle board read these vars.
  function applyBoard(set) {
    if (!set || !set.board) return;
    var root = document.documentElement;
    var b = set.board;
    try {
      if (b.light) root.style.setProperty('--light-sq', b.light);
      if (b.dark) root.style.setProperty('--dark-sq', b.dark);
      if (b.light) root.style.setProperty('--board-light', b.light);
      if (b.dark) root.style.setProperty('--board-dark', b.dark);
    } catch (e) {}
  }
  function clearBoard() {
    var root = document.documentElement;
    ['--light-sq', '--dark-sq', '--board-light', '--board-dark'].forEach(function (v) {
      try { root.style.removeProperty(v); } catch (e) {}
    });
  }

  function rerender() {
    try { if (window.CT && typeof window.CT.renderBoard === 'function') window.CT.renderBoard(); } catch (e) {}
    try { if (window.CT_Checkers_UI && window.CT_Checkers_UI.state) { /* checkers unaffected by chess sets */ } } catch (e) {}
  }

  // Equip a set (after it's loaded). Pass null/'classic' to revert to the built-in Staunton + default board.
  function equip(slug) {
    if (!slug || slug === 'classic') {
      activeSlug = null; clearBoard(); persist(null); rerender(); return Promise.resolve(null);
    }
    return load(slug).then(function (set) {
      activeSlug = slug; applyBoard(set); persist(slug); rerender(); return set;
    }).catch(function (e) { return null; });
  }

  // Apply a set TEMPORARILY without persisting — used by the Store so anyone
  // (incl. non-subscribers) can preview a set before subscribing. A reload or
  // enforcePremium() will drop it.
  function preview(slug) {
    if (!slug || slug === 'classic') { activeSlug = null; clearBoard(); rerender(); return Promise.resolve(null); }
    return load(slug).then(function (set) { activeSlug = slug; applyBoard(set); rerender(); return set; })
      .catch(function () { return null; });
  }

  // Themed sets are a PREMIUM perk OR a trophy reward. enforcePremium reverts a
  // lapsed/cancelled member to Classic — but it must NOT strip a set the user
  // earned with a trophy (those are theirs to keep regardless of subscription).
  // Call setTrophyUnlocks() with the user's earned achievements BEFORE this.
  function enforcePremium(isPremium) {
    if (isPremium) return;
    var persisted = null; try { persisted = localStorage.getItem(EQUIP_KEY); } catch (e) {}
    var cur = activeSlug || persisted;
    if (cur && !isTrophyUnlocked(cur)) { activeSlug = null; clearBoard(); persist(null); rerender(); }
  }

  // Recompute which sets are unlocked from the user's earned achievement ids.
  // Returns the slugs that became unlocked since the last call (for a toast).
  function setTrophyUnlocks(earnedIds) {
    var idset = {}; (earnedIds || []).forEach(function (id) { idset[id] = true; });
    var next = [], newly = [];
    for (var slug in UNLOCKS) {
      if (idset[UNLOCKS[slug].ach]) {
        next.push(slug);
        if (unlockedSlugs.indexOf(slug) === -1) newly.push(slug);
      }
    }
    unlockedSlugs = next;
    return newly;
  }
  function isTrophyUnlocked(slug) { return unlockedSlugs.indexOf(slug) !== -1; }
  function trophyUnlockedSlugs() { return unlockedSlugs.slice(); }
  function unlockInfo(slug) { return UNLOCKS[slug] || null; }
  // Reverse: which set (if any) a given achievement id unlocks. For the trophy UI.
  function unlockForAchievement(achId) {
    for (var slug in UNLOCKS) {
      if (UNLOCKS[slug].ach === achId) { var m = get(slug); return { slug: slug, name: m ? m.name : slug, label: UNLOCKS[slug].label }; }
    }
    return null;
  }

  function persist(slug) {
    try { if (slug) localStorage.setItem(EQUIP_KEY, slug); else localStorage.removeItem(EQUIP_KEY); } catch (e) {}
  }

  function activeSet() { return activeSlug ? cache[activeSlug] : null; }
  function activeSlugGet() { return activeSlug; }

  // The hook app.js calls: returns a themed SVG string for (type,color) or null.
  function pieceSVG(type, color) {
    var s = activeSet();
    if (s && s.pieces && s.pieces[color] && s.pieces[color][type]) return s.pieces[color][type];
    return null;
  }

  // On boot, restore the last equipped set (preview/owned). Ownership is enforced
  // server-side at purchase; equipping a previously-equipped slug just re-applies it.
  function init() {
    var slug = null;
    try { slug = localStorage.getItem(EQUIP_KEY); } catch (e) {}
    if (slug && get(slug)) { equip(slug); }
  }

  window.CT_PIECE_SETS_MANIFEST = MANIFEST;
  window.CT_Sets = {
    manifest: manifest, get: get, load: load, equip: equip, preview: preview,
    enforcePremium: enforcePremium,
    setTrophyUnlocks: setTrophyUnlocks, isTrophyUnlocked: isTrophyUnlocked,
    trophyUnlockedSlugs: trophyUnlockedSlugs, unlockInfo: unlockInfo,
    unlockForAchievement: unlockForAchievement,
    activeSet: activeSet, activeSlug: activeSlugGet, isCached: isCached,
    pieceSVG: pieceSVG, init: init
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
