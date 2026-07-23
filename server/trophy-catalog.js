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
export function scoreAchievements(achievements, streakTrophies) {
  const seen = new Set();
  const outAch = [];
  if (Array.isArray(achievements)) {
    for (const a of achievements) {
      if (!a || typeof a !== 'object') continue;
      const id = a.id;
      if (!isKnownTrophy(id) || seen.has(id)) continue;
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
