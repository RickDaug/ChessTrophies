// server/trophy-catalog.js — SERVER-AUTHORITATIVE trophy scoring.
//
// The trophy leaderboard used to be client-authoritative: POST /api/progress
// took `achievements` / `streakTrophies` / `trophyPoints` straight off the wire
// and persisted them, so a fresh account could POST `trophyPoints: 99999999` and
// top the public ladder (audit 2026-07, live-confirmed).
//
// This module is the fix. It mirrors the trophy catalog in the repo-root
// `trophy-data.js` (window.CT_ACHIEVEMENT_TIERS) and the client's
// userTrophyPoints() weighting:
//
//     points(def) = (def.tier || 1) * 10 + (def.hidden ? 20 : 0) + (def.embarrassing ? 5 : 0)
//
// summed ONCE per DISTINCT earned catalog id (repeatable trophies still score
// once, exactly like the client). Ids that aren't in the catalog are DROPPED —
// a fabricated id can neither be stored nor scored.
//
// KEEP IN SYNC: adding a trophy to `trophy-data.js` means adding its id + points
// here, or the new trophy is silently worth 0 and gets filtered out of the
// stored array. `npm run test:trophy-catalog` (test/trophy-catalog.mjs) is the
// intended guard.
//
// NOTE on streak trophies: the bespoke 7-win streak trophies are client-minted
// with random ids (`t_<base36>`), so they have no catalog to validate against.
// They are worth ZERO points (matching the client's userTrophyPoints, which only
// walks the tiered catalog); we only sanitize their shape and cap how many can
// be stored, because the public ladder shows a trophy COUNT that includes them.

// achievementId -> tier-weighted points. Generated from `trophy-data.js`.
export const TROPHY_POINTS = {
  // Wins
  'wins_t1':                10,
  'wins_t2':                20,
  'wins_t3':                30,
  'wins_t4':                40,
  'wins_t5':                50,
  'wins_t6':                60,
  'wins_t7':                70,
  'wins_t8':                80,
  // Streak
  'streak_t1':              10,
  'streak_t2':              20,
  'streak_t3':              30,
  'streak_t4':              40,
  'streak_t5':              50,
  'streak_t6':              60,
  'streak_t7':              70,
  // Rating
  'elo_t1':                 10,
  'elo_t2':                 20,
  'elo_t3':                 30,
  'elo_t4':                 40,
  'elo_t5':                 50,
  'elo_t6':                 60,
  'elo_t7':                 70,
  'elo_t8':                 80,
  // Fast Win
  'fast_t1':                10,
  'fast_t2':                20,
  'fast_t3':                30,
  'fast_t4':                40,
  'fast_t5':                50,
  // Veteran
  'games_t1':               10,
  'games_t2':               20,
  'games_t3':               30,
  'games_t4':               40,
  'games_t5':               50,
  // Mates
  'mate_t1':                10,
  'mate_t2':                20,
  'mate_t3':                30,
  'mate_t4':                40,
  'mate_t5':                50,
  // Comeback
  'come_t1':                10,
  'come_t2':                20,
  'come_t3':                30,
  'come_t4':                40,
  // Community
  'recruit_t1':             10,
  'recruit_t2':             20,
  'recruit_t3':             30,
  'recruit_t4':             40,
  // Hidden Feats
  'hidden_underpromo':      30,
  'hidden_en_passant':      30,
  'hidden_queenside':       30,
  'hidden_bare_bones':      30,
  'hidden_smothered':       30,
  'hidden_marathon':        30,
  'hidden_lightning':       30,
  'hidden_phoenix':         30,
  'hidden_pawn_promo':      30,
  'hidden_bongcloud':       30,
  'hidden_play_streak_7':   30,
  'hidden_play_streak_30':  30,
  'hidden_play_streak_90':  30,
  'hidden_play_streak_365': 30,
  // Oops
  'oops_whoops':            15,
  'oops_punching_bag':      15,
  'oops_dry_spell':         15,
  'oops_resign_addict':     15,
  'oops_mate_magnet':       15,
  'oops_flatline':          15,
  'oops_quick_loss':        15,
  'oops_pawn_pusher':       15,
  'oops_doormat':           15,
  'oops_cold_streak':       15,
  // Duo
  'duo_first':              10,
  'duo_win1':               10,
  'duo_win10':              20,
  'duo_win25':              30,
  'duo_streak3':            20,
  'duo_streak5':            30,
  'duo_synergy':            20,
  'duo_maverick':           20,
  'duo_2400':               30,
  'duo_comeback':           30,
  // Arena
  'arena_t1':               20,
  'arena_t2':               40,
  'arena_t3':               60,
  'arena_t4':               80,
  // Gauntlet
  'gauntlet_t1':            10,
  'gauntlet_t2':            30,
  'gauntlet_t3':            50,
  'gauntlet_t4':            70,
  // Openings
  'open_t1':                10,
  'open_t2':                30,
  'open_t3':                60,
  // Puzzles
  'puz_t1':                 10,
  'puz_t2':                 30,
  'puz_t3':                 50,
  'puz_t4':                 70,
  // Checkers
  'ck_elo_t1':              10,
  'ck_elo_t2':              30,
  'ck_elo_t3':              50,
  'ck_elo_t4':              70,
  'ck_games_t1':            10,
  'ck_games_t2':            20,
  'ck_games_t3':            40,
  'ck_hidden_triple_jump':  30,
  'ck_hidden_flying_king':  30,
  'ck_hidden_shutout':      30,
};

// Fast membership test for the id filter.
const KNOWN_IDS = new Set(Object.keys(TROPHY_POINTS));

// Hard caps. A legitimate account can hold at most one entry per catalog id, and
// a streak trophy costs 7 consecutive ranked wins, so these are generous.
// Streak trophies are client-minted with random ids (`t_<base36>`), so unlike
// achievements they cannot be validated against a catalog. They are worth ZERO
// points (so they cannot move the ladder, which orders by trophy_points), but
// they DO feed the public trophyCount, so an unbounded array was still a
// count-inflation vector. Two cheap bounds close the absurd cases:
//   - the id must look like a client-minted streak id (`t_` + base36),
//   - and the array is capped at a plausible ceiling.
// NOTE: the tighter bound would be `floor(users.wins / 7)` (a 7-win streak is
// what mints one). It is deliberately NOT applied: `streakVictims` can
// accumulate from game types that do not increment the server `wins` counter,
// so that bound risks deleting legitimately-earned trophies from real accounts.
// Revisit if/when win accounting and streak accounting are unified.
const STREAK_ID_RE = /^t_[a-z0-9]{1,40}$/i;
const MAX_STREAK_TROPHIES = 100;
const MAX_ACHIEVEMENT_COUNT = 1000000;

// True for a real trophy id we know about. Exported for tests/diagnostics.
export function isKnownTrophy(id) {
  return typeof id === 'string' && KNOWN_IDS.has(id);
}

// Points a single catalog trophy is worth (0 for anything unknown).
export function pointsFor(id) {
  return isKnownTrophy(id) ? TROPHY_POINTS[id] : 0;
}

// SERVER-SIDE scoring of a progress sync.
//
// `achievements`    — the client's earned list: [{ id, count? }, ...]
// `streakTrophies`  — the client's bespoke 7-win trophies: [{ id, awardedAt?, streakNumber? }, ...]
//
// Returns { achievements, streakTrophies, trophyPoints } where:
//   - achievements is filtered to KNOWN catalog ids, de-duplicated (first wins),
//     with a sane non-negative integer `count`;
//   - streakTrophies is shape-sanitized + capped;
//   - trophyPoints is COMPUTED here from the surviving achievement ids. Any
//     client-supplied trophyPoints is ignored entirely.
//
// Pure + total: never throws, whatever garbage it is handed. Passing a non-array
// (e.g. `undefined`, meaning "this sync didn't carry the field") yields an empty
// array for that field, so callers should only use the corresponding output when
// the input was actually present.
// id -> [type, threshold]. GENERATED from trophy-data.js — see scoreAchievements().
export const TROPHY_META = {
  'wins_t1': ['wins', 1],
  'wins_t2': ['wins', 5],
  'wins_t3': ['wins', 10],
  'wins_t4': ['wins', 25],
  'wins_t5': ['wins', 50],
  'wins_t6': ['wins', 100],
  'wins_t7': ['wins', 250],
  'wins_t8': ['wins', 500],
  'streak_t1': ['streak', 3],
  'streak_t2': ['streak', 5],
  'streak_t3': ['streak', 7],
  'streak_t4': ['streak', 10],
  'streak_t5': ['streak', 14],
  'streak_t6': ['streak', 21],
  'streak_t7': ['streak', 30],
  'elo_t1': ['elo', 1300],
  'elo_t2': ['elo', 1400],
  'elo_t3': ['elo', 1500],
  'elo_t4': ['elo', 1600],
  'elo_t5': ['elo', 1700],
  'elo_t6': ['elo', 1800],
  'elo_t7': ['elo', 2000],
  'elo_t8': ['elo', 2200],
  'fast_t1': ['fast', 30],
  'fast_t2': ['fast', 20],
  'fast_t3': ['fast', 15],
  'fast_t4': ['fast', 10],
  'fast_t5': ['fast', 8],
  'games_t1': ['games', 10],
  'games_t2': ['games', 50],
  'games_t3': ['games', 100],
  'games_t4': ['games', 250],
  'games_t5': ['games', 500],
  'mate_t1': ['mate', 1],
  'mate_t2': ['mate', 5],
  'mate_t3': ['mate', 25],
  'mate_t4': ['mate', 100],
  'mate_t5': ['mate', 250],
  'come_t1': ['comeback', 1],
  'come_t2': ['comeback', 5],
  'come_t3': ['comeback', 10],
  'come_t4': ['comeback', 25],
  'recruit_t1': ['invites', 1],
  'recruit_t2': ['invites', 3],
  'recruit_t3': ['invites', 10],
  'recruit_t4': ['invites', 25],
  'hidden_underpromo': ['flag', 1],
  'hidden_en_passant': ['flag', 3],
  'hidden_queenside': ['flag', 3],
  'hidden_bare_bones': ['flag', 1],
  'hidden_smothered': ['flag', 1],
  'hidden_marathon': ['flag', 1],
  'hidden_lightning': ['flag', 1],
  'hidden_phoenix': ['flag', 1],
  'hidden_pawn_promo': ['flag', 10],
  'hidden_bongcloud': ['flag', 1],
  'hidden_play_streak_7': ['flag', 7],
  'hidden_play_streak_30': ['flag', 30],
  'hidden_play_streak_90': ['flag', 90],
  'hidden_play_streak_365': ['flag', 365],
  'oops_whoops': ['flag', 1],
  'oops_punching_bag': ['flag', 5],
  'oops_dry_spell': ['flag', 1],
  'oops_resign_addict': ['flag', 5],
  'oops_mate_magnet': ['flag', 3],
  'oops_flatline': ['flag', 10],
  'oops_quick_loss': ['flag', 1],
  'oops_pawn_pusher': ['flag', 1],
  'oops_doormat': ['flag', 1],
  'oops_cold_streak': ['flag', 1],
  'duo_first': ['duo', 1],
  'duo_win1': ['duo', 1],
  'duo_win10': ['duo', 10],
  'duo_win25': ['duo', 25],
  'duo_streak3': ['duo', 3],
  'duo_streak5': ['duo', 5],
  'duo_synergy': ['duo', 10],
  'duo_maverick': ['duo', 20],
  'duo_2400': ['duo', 1],
  'duo_comeback': ['duo', 1],
  'arena_t1': ['arena', 1],
  'arena_t2': ['arena', 5],
  'arena_t3': ['arena', 15],
  'arena_t4': ['arena', 50],
  'gauntlet_t1': ['gauntlet', 1],
  'gauntlet_t2': ['gauntlet', 3],
  'gauntlet_t3': ['gauntlet', 6],
  'gauntlet_t4': ['gauntlet', 9],
  'open_t1': ['openings', 1],
  'open_t2': ['openings', 3],
  'open_t3': ['openings', 7],
  'puz_t1': ['flag', 1],
  'puz_t2': ['flag', 25],
  'puz_t3': ['flag', 100],
  'puz_t4': ['flag', 500],
  'ck_elo_t1': ['checkers_elo', 1300],
  'ck_elo_t2': ['checkers_elo', 1500],
  'ck_elo_t3': ['checkers_elo', 1700],
  'ck_elo_t4': ['checkers_elo', 2000],
  'ck_games_t1': ['checkers_games', 10],
  'ck_games_t2': ['checkers_games', 50],
  'ck_games_t3': ['checkers_games', 200],
  'ck_hidden_triple_jump': ['flag', 1],
  'ck_hidden_flying_king': ['flag', 1],
  'ck_hidden_shutout': ['flag', 1],
};

// ---------------------------------------------------------------------------
// ENTITLEMENT. Validating the id NAMESPACE (above) killed the audit's headline
// exploit — POSTing `trophyPoints: 99999999` no longer works. But re-verification
// showed a weaker version survived: a brand-new account with ZERO games could
// POST all 105 REAL catalog ids and land at the maximum 3380 points / rank #1.
// Filtering ids is not enough; we must check the account actually EARNED them.
//
// Many families map to counters the SERVER owns in the users row, so their
// thresholds are checkable outright. The rest (mate/fast/comeback/flag/duo/
// gauntlet/openings) are client-tracked and cannot be fully verified here — the
// real fix for those is awarding them server-side in the game-finish/puzzle
// paths (see docs/audit). What we CAN do is require plausible activity: none of
// them is reachable without having played a game, so an account with no
// recorded games cannot hold any of them.
const SERVER_VERIFIED_TYPES = new Set(['wins', 'streak', 'elo', 'games', 'invites', 'arena', 'checkers_elo']);
// Families that are impossible without having played at least one game.
const REQUIRES_PLAY = new Set(['fast', 'mate', 'comeback', 'flag', 'duo', 'gauntlet', 'openings', 'checkers_games']);

// Pull the verifiable counters off the users row. Unknown/missing -> 0, which
// fails closed (an unverifiable claim is dropped rather than trusted).
export function statsFromUser(u) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const wins = n(u && u.wins), losses = n(u && u.losses), draws = n(u && u.draws);
  return {
    wins, games: wins + losses + draws,
    streak: Math.max(n(u && u.best_streak), n(u && u.current_streak)),
    elo: n(u && u.elo),
    invites: n(u && u.invites_accepted),
    arena: n(u && u.arena_wins),
    checkers_elo: Math.max(n(u && u.elo_checkers_8), n(u && u.elo_checkers_10)),
    checkers_games: 0,
  };
}

// True if `stats` supports holding trophy `id`.
function entitled(id, stats) {
  const meta = TROPHY_META[id];
  if (!meta) return false;
  const [type, threshold] = meta;
  if (!stats) return true;                       // no stats supplied -> namespace-only (legacy callers)
  if (SERVER_VERIFIED_TYPES.has(type)) return (stats[type] || 0) >= threshold;
  if (REQUIRES_PLAY.has(type)) return (stats.games || 0) > 0;
  return true;
}

export function scoreAchievements(achievements, streakTrophies, stats) {
  const seen = new Set();
  const outAch = [];
  if (Array.isArray(achievements)) {
    for (const a of achievements) {
      if (!a || typeof a !== 'object') continue;
      const id = a.id;
      if (!isKnownTrophy(id) || seen.has(id)) continue;
      if (!entitled(id, stats)) continue;   // claimed but not earned -> drop
      seen.add(id);
      let count = Number(a.count);
      if (!Number.isFinite(count) || count < 1) count = 1;
      count = Math.min(MAX_ACHIEVEMENT_COUNT, Math.floor(count));
      outAch.push({ id, count });
    }
  }

  const outStreak = [];
  if (Array.isArray(streakTrophies)) {
    for (const t of streakTrophies) {
      if (outStreak.length >= MAX_STREAK_TROPHIES) break;
      if (!t || typeof t !== 'object') continue;
      const id = typeof t.id === 'string' ? t.id.slice(0, 64) : '';
      if (!id || !STREAK_ID_RE.test(id)) continue;
      const awardedAt = Number.isFinite(t.awardedAt) ? Math.floor(t.awardedAt) : 0;
      const streakNumber = Number.isFinite(t.streakNumber) ? Math.max(0, Math.floor(t.streakNumber)) : outStreak.length + 1;
      outStreak.push({ id, awardedAt, streakNumber });
    }
  }

  let trophyPoints = 0;
  for (const a of outAch) trophyPoints += TROPHY_POINTS[a.id];

  return { achievements: outAch, streakTrophies: outStreak, trophyPoints };
}
