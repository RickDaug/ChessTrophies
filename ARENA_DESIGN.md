# Arena Tournaments — design + build tracker

Live, time-boxed competitive events (Lichess-arena-lite). During an arena's
window players join a pool, get paired continuously, and the moment a game ends
they're re-paired — racking up points on a live leaderboard. **Bot-backfill**
(the same engine the ranked queue uses) guarantees there's always a game, so an
arena is fun even with a handful of humans online. At the bell, the points
leader is crowned champion and gets a trophy.

This is the highest-retention feature on the roadmap: scheduled events create
urgency and a reason to come back at a specific time; the live leaderboard +
win-streak fire create in-event tension.

## Principles
- **Never breaks core play.** Every arena touch-point (pairing, scoring,
  finish hook) is *failure-isolated* exactly like the Victim Wall / Seasons
  hooks: an arena error can never affect a ranked/casual/2v2 ELO or result
  write. Same discipline, same test pattern.
- **Always-on.** A rolling scheduler keeps one arena live-or-upcoming at all
  times (no admin babysitting), so the lobby card always has something to show.
- **Kill-switchable.** `ARENA_ENABLED` env (default ON). Off → routes inert,
  no arena games created, zero footprint — mirrors `RANKED_ENABLED`.
- **Reuse, don't reinvent.** Game creation, the move loop, clocks, the bot
  engine, sockets, and the online game UI are all reused. Arena adds a pool, a
  pairing pass, a scoring hook, and a lifecycle tick — nothing more in the core.

## Scoring
Per finished arena game, for each player:
- **Win** = 2 pts · **Draw** = 1 pt · **Loss** = 0 pts.
- **Streak fire 🔥:** a player on a run of consecutive *wins* scores **3 pts**
  for the 3rd win onward (i.e. once `streakBefore >= 2`). A draw or loss resets
  the streak to 0. The streak count is shown next to the player on the board.
- Tiebreak on the leaderboard: points DESC, then games-played ASC (efficiency),
  then peak in-arena ELO DESC.

Pure function (unit-tested, no I/O):
`arenaScore(result, streakBefore) -> { points, streakAfter, onFire }`

## Lifecycle (rolling scheduler)
An arena row: `{ id, name, tc, starts_at, ends_at, status, champion_id, created_at }`.
- `status`: `upcoming` → `live` → `finished` (derived from now vs starts/ends,
  persisted on transition).
- **Rolling:** `ensureArena(now)` guarantees exactly one arena that is live or
  upcoming. When the current one finishes, the next is scheduled to start after
  a short break. Defaults (config constants, easy to tune):
  - duration `ARENA_DURATION_MS` = 30 min
  - break between arenas `ARENA_BREAK_MS` = 10 min
  - arena time control `ARENA_TC` = `5+0` (blitz, so games are quick and players
    re-pair often). Requires adding `5+0` (and `3+2`) to game.js `TC_ALLOWLIST`.
  - names cycle a themed list (e.g. "Blitz Arena", "Knight Owl Arena", …).
- A single `arenaTick()` (setInterval ~5s, guarded/failure-isolated) drives:
  flip `upcoming→live` at start, `live→finished` + finalize at end, ensure a
  next arena exists, and run the pairing pass (Layer 2).

## Finalize
At `live→finished`: read the top of `arena_scores`, set `champion_id`, award the
champion a repeatable trophy (`trophy-data.js` arena family) + notify (socket +
best-effort push). Failure-isolated.

## Data model
- `arenas` — one row per event (see above).
- `arena_scores` — `(arena_id, user_id)` PK: `points, games, wins, draws, losses,
  streak, best_streak, peak_elo, joined_at, updated_at`. Mirrors `season_stats`.
- Both added to `db.js` (SQLite) + `db-pg.js` (Postgres) + `store.js` facade,
  following the `season_stats` precedent exactly.

## REST (mountArena(app), auth where noted)
- `GET  /api/arena/current` — the live arena (if any) + the next upcoming one,
  each with `{id,name,tc,startsAt,endsAt,status,players,top[8]}`; if the caller
  is authed, include `you:{points,games,streak,rank}` and `joined:bool`.
- `GET  /api/arena/:id/leaderboard` — full standings (paged/capped).
- `POST /api/arena/:id/join`   (auth) — enroll the caller (idempotent). Returns
  current standing. The actual pairing happens over the socket pool (Layer 2).
- `POST /api/arena/:id/leave`  (auth) — stop being paired (stays on the board).
- `GET  /api/arena/config` — `{ enabled }` (public; lets the client hide the UI).

## Realtime (Layer 2 — game.js)
- Arena pool: `arenaPool: Map<userId,{socketId,elo,arenaId,joinedAt}>`.
- Socket: `arena_join {arenaId}` / `arena_leave`. On join (and after each arena
  game ends) the user is (re)added to the pool.
- Pairing pass (inside `arenaTick`): pair pooled users with elo proximity (reuse
  ranked tolerance), `mode:'arena'`, stamp `arenaId` on the game. A user waiting
  > `ARENA_BOT_WAIT_MS` (~8s) gets a bot game (reuse `startBotGame` with an arena
  flag). Bots never appear on the leaderboard.
- Finish hook: `recordArenaResult({arenaId,userId,result,elo})` called from
  `finishGame` (human-v-human) and `finishBotGame` (human only), failure-isolated
  like `recordSeasonResult`. After scoring, the human is returned to the pool so
  they re-pair (if the arena is still live and they haven't left).

## Client (Layer 3 — arena.js + UI)
- Lobby arena card: live arena name + countdown + standing + "Join arena"; or
  "next arena in M:SS". Hidden when `!enabled`.
- Arena screen `#screen-arena`: live leaderboard (poll + socket nudge), your
  rank/points/🔥, status line ("Pairing you…", "Game starting…"), and it auto-
  enters the board when `match_found` for an arena game arrives. Leaving the
  board returns to the arena screen and re-pools you.
- Reuses the entire existing online-game UI + socket path (arena games ARE online
  games with `mode:'arena'`).

## Tests
- `test/arena.mjs` (Layer 1): pure `arenaScore` table (win/draw/loss + streak
  fire), lifecycle transitions (upcoming/live/finished, rolling ensure), and the
  REST routes against a temp DB (join/leave/leaderboard/current shape).
- Layer 2: extend with a paired-game scoring integration test + a
  failure-isolation test (a throwing arena hook must not break `finishGame`),
  mirroring the season test.
- Layer 3: fold arena card/screen smoke into build-smoke/a11y.

## Status
- [x] Design doc (this file)
- [x] **L1: tables (db.js + db-pg.js) + pure scoring + rolling lifecycle/scheduler +
      join-gated scoring + leaderboard + REST + ARENA_ENABLED gate + `test/arena.mjs`.**
      Mounted in server.js (`mountArena` + `startArenaScheduler(io)` + `logArenaStatus`).
      Server-boot-verified: the scheduler auto-creates a live arena; `/api/arena/current`
      serves it. All scoring done via portable SQL through the store facade (no
      transaction needed — a user is only ever in one game at a time). Touches NOTHING
      in the realtime game loop yet.
- [x] **L2: realtime pool + pairing + bot-backfill + finish hook (game.js).**
      `arena_join`/`arena_leave` socket events feed an `arenaPool` waiting room; a
      pairing pass (3s interval, single-instance only like ranked bot-backfill)
      pairs closest-elo waiters into `mode:'arena'` games and bot-backfills anyone
      past `ARENA_BOT_WAIT_MS`. Arena games are created via `startGameWithColors`/
      `startBotGame` `opts` bypass (`mode:'arena'` + `arenaId`; `normalizeMode`
      would otherwise fold unknown→ranked). `recordArenaResult` is hooked into
      BOTH `finishGame` (human-v-human) and `finishBotGame` (human only), surgical
      + failure-isolated like the Seasons/Victim-Wall hooks. **Arena games NEVER
      touch global ELO or W/L/D** (mode!=='ranked' skips the ELO path; finishBotGame
      gets an `isArena` guard on its stat writes) — the arena currency is points.
      On finish both players are re-pooled (`requeueArena`) for continuous play.
      Added `5+0`/`3+2` to the TC allowlist. Gated by `test/arena-realtime.mjs`
      (real socket: join → bot-backfill → server-authoritative play → ELO isolation
      → leaderboard scoring → re-pool), in CI. Realtime regression green
      (ranked-bot/2v2/checkers untouched).
- [ ] L3: client card + arena screen
- [ ] L4: champion trophy + admin stats + polish
