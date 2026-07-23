# Functionality & Correctness — Squad Report

**Score:** 76 / 100  ·  **Findings:** 2×S2 · 6×S3

Core game logic is well-covered (endgame mate conversion, FIDE-6.9 flag-fall rules, and the PR-#24-class progress-sync HTTP round-trip all have real backend tests). The confirmed defects cluster into (a) one genuine user-facing correctness gap — Opening Trainer mastery and the Bot Gauntlet ladder never sync to the server, so a headline learning feature silently resets on a second device while everything else follows the account; (b) a set of test-coverage holes on stakes-bearing paths (the clock-timeout sweep, cross-device language, social/safety endpoints, rematch handshake) where the logic currently works but no test would catch a regression; and (c) two latent/CI-hygiene issues (arenas + ranked/2v2 bot-backfill go inert only under Redis multi-instance mode, and the elo selector's deterministic legality/edge-FEN guards were dropped from blocking CI along with the one genuinely flaky assertion). No S0/S1 exploitable or data-corrupting defects found. Six auditor findings survive; one was a null/placeholder record and was culled. Score reflects a solid, well-tested core with one moderate sync data-loss bug and several regression-guard gaps rather than any launch-blocking correctness failure.

---

### 1. Opening Trainer mastery and Bot Gauntlet ladder never sync to the server (silent cross-device reset of a headline feature)  `S2` — _CONFIRMED_

**Evidence:** openings.js:171-181 persistProgress() writes flags.openings to localStorage then calls window.CT_syncProgress(), with the header (lines 168-170) advertising cross-device follow. But app.js:3353-3368 gatherLocalProgress() returns only {lessonsCompleted, puzzles, achievements, streakTrophies, trophyPoints, showcase, themeBoard, themePieces, language} — flags.openings and flags.gauntlet are absent. server.js:775-852 POST /api/progress forwards only those same keys to store.setProgress. ct-gauntlet.js:81-97 persist() is localStorage-only and never calls CT_syncProgress at all. Verified openings mastery lives under u.flags.openings (openings.js:160) which nothing gathers, sends, or persists server-side.

**Impact:** A signed-in player who drills openings to mastery or climbs the gauntlet on one browser/device loses ALL of that mastery/spaced-repetition state and gauntlet-ladder progress on a second device, a new browser, or after clearing site data — while theme, language, puzzles, streak, and trophies correctly follow the account. Openings-family trophies survive (they ride the achievements array) but the mastery bars that produced them cannot be re-derived, an inconsistent data-losing surprise on a headline learning feature for a product whose selling point is account-synced progress. Matches the memory-documented '/api/progress drops unforwarded fields' bug class exactly.

**Recommendation:** Add flags.openings and flags.gauntlet to the sync round-trip in all three places (gatherLocalProgress, the POST /api/progress validate+forward, and store.setProgress/getProgress + applyServerProgress merge in both db.js and db-pg.js), mirroring how playStreak is tucked under puzzles. If cross-device sync for these is out of scope, remove the misleading CT_syncProgress() call and the 'follow the user across devices' comments so the behavior isn't advertised.

### 2. Clock timeout / flag-fall sweep has zero end-to-end coverage (only its pure sub-rule is tested)  `S2` — _CONFIRMED_

**Evidence:** server/game.js:362-388 startTimeoutSweep runs a 1s setInterval computing clock[clock.running] - (now - clock.turnStartedAt) and calls timeoutFinishGame/timeoutFinishTeamGame. No test boots the server and plays a clocked game to expiry: flag-fall.mjs (header lines 3-13) imports ONLY server/timeout-rules.js (winnerCanMateOnTimeout) via a synthesized FEN board and never runs the sweep; challenge.mjs uses tc:'unlimited' (line 111); grep for tc:/turnStartedAt/timeoutFinish across test/*.mjs finds no clocked-to-expiry test. The clock-decrement math, increment application, turnStartedAt accounting, and the sweep interval firing are all untested end-to-end.

**Impact:** A regression in server clock accounting (wrong side flagged, increment not applied, sweep not firing) would mis-decide every timed game — including default 3+2 arena games and any timed ranked 1v1 — silently awarding wins/losses and adjusting ELO incorrectly with a fully green CI. The FIDE-6.9 winner-material rule itself IS tested (flag-fall.mjs), so this is a coverage gap on the timing/sweep plumbing rather than a proven live bug, but it is a stakes-bearing correctness path with no guard.

**Recommendation:** Add a server-backed test that matches two players in a short-clock game (e.g. 5s+0 or an env-lowered TC), has one player sit out, and asserts timeoutFinishGame fires with the correct winner + ELO delta (plus the FIDE-6.9 downgrade-to-draw case when the winner lacks mating material). Reuse reconnect.mjs's boot harness.

### 3. Arenas and ranked bot-backfill silently go inert under multi-instance (REDIS_URL) mode while still being advertised  `S3` — _CONFIRMED_

**Evidence:** server/game.js:409 arena pairing loop starts only when !scaleR; game.js:512 mm_join returns immediately after scale.joinQueue when scaleR is set, BEFORE the ranked bot-backfill at :519, so a lone ranked player under Redis gets no engine opponent; game.js:532 arena_join emits arena_err 'Arenas are unavailable right now.' and returns when scaleR is set. Meanwhile ct-arena.js renderLobbyCard and /api/arena/current are scheduler-driven and keep advertising a live arena regardless of Redis.

**Impact:** If the backend is ever scaled to >1 replica, a user sees a live arena card, taps Join, and gets 'Arenas are unavailable right now'; solo ranked queuers get no bot fallback and time out. Latent — only active when REDIS_URL is set, which the current single-instance Railway deploy does not use, and STATE.md documents it as a known scale-out limitation.

**Recommendation:** Gate the arena lobby card and ranked-queue affordance on a server capability flag (multiInstance is already surfaced on /health) so the client never advertises a feature the running topology has disabled, or complete the Redis-backed arena/bot-backfill path.

### 4. elo-strength quarantine excludes the WHOLE file, dropping its deterministic legality + edge-FEN guards from blocking CI  `S3` — _CONFIRMED_

**Evidence:** .github/workflows/full-suite.yml:46 and :74 set CT_EXCLUDE:'elo-strength' on both blocking jobs, so the whole file runs only in the continue-on-error flaky-nonblocking job (:103-131). But test/elo-strength.mjs's header (lines 9-17) shows it asserts three things and only #2 is flaky: (1) LEGALITY of bestMoveForElo at 600/1000/1500/2000, (2) the flaky GRADIENT/mate-conversion property, (3) EDGE-FENS returning null-not-throw on stalemate/garbage. Excluding the whole file un-gates the deterministic (1) and (3).

**Impact:** A regression making the ELO-targeted move selector (used by ranked bot-backfill and the 9-rung Gauntlet) return an ILLEGAL move or THROW on a garbage FEN would not block any PR. Mate conversion itself stays guarded by the blocking endgame.mjs (K+Q/K+R vs K), so the loss is the selector's legality/robustness guarantees, not mate conversion. CI-hygiene rather than a runtime defect.

**Recommendation:** Split the flaky K+Q-vs-K gradient assertion into its own file (or gate just that assertion behind a seeded-RNG/retry loop) and return the legality + edge-FEN checks to the blocking suite instead of quarantining the entire file.

### 5. Social/safety REST endpoints and rematch socket handlers are untested  `S3` — _CONFIRMED_

**Evidence:** grep across test/*.mjs finds zero hits for rematch (game.js:1076-1143 rematch_offer/accept/decline), /api/friends/accept /decline /block /unblock /requests /blocked (server.js:689-748), /api/users/search (:614), /api/games/recent (:750), /api/profile/avatar (:436). Only POST /api/friends/add is exercised (challenge.mjs:88-90, checkers-friend.mjs:97-99). The checkers immediate disconnect-forfeit path (game.js:1197-1205) is also unguarded.

**Impact:** Blocking is a user-safety feature: a broken /api/friends/block or /unblock could let a blocked user still appear in search or send challenge invites with no failing test. A broken rematch handshake would strand players on the result screen. Moderate-risk untested paths in a shipped multiplayer product — coverage gap, no proven current defect.

**Recommendation:** Add a friends-lifecycle test (add -> request -> accept -> block -> assert blocked user is filtered from search/challenge -> unblock) and extend an existing socket test to cover rematch_offer -> rematch_accept producing a fresh game.

### 6. Cross-device language sync has no HTTP round-trip regression guard  `S3` — _CONFIRMED_

**Evidence:** language is a fully wired synced field: gatherLocalProgress sends it (app.js:3367), POST /api/progress validates+forwards it (server.js:847-851, language=body.language.slice(0,8) into store.setProgress at :852), both db backends persist it. But test/progress-sync-http.mjs — the guard built specifically for this bug class — omits language from its payload (lines 91-100) and its header enumeration (lines 12-18), and no other test asserts language round-trips over GET /api/progress.

**Impact:** Same failure mode as the memory-recorded trophy-leaderboard bug: if a future refactor drops language from the POST forward, the db backends still work in isolation and progress-sync-http stays green, so cross-device UI-language sync would silently break with no failing test. Currently working; this is a missing guard, not a live bug.

**Recommendation:** Add language to the progress-sync-http.mjs payload and assert it round-trips through POST -> GET /api/progress, matching how themeBoard/themePieces are covered at lines 95-96/123.

### 7. 2v2 online cannot complete at pre-launch scale (no bot-backfill) — merged into the coverage/scarcity picture, not a correctness bug  `S3` — _PLAUSIBLE_

**Evidence:** server/game.js:29 comment '2v2 stays human-only'; team matchmaking (team_mm_join/tryTeamMatchmake) schedules no engine backfill, unlike 1v1 (game.js:519) and arena (game.js:1662-1670). Client 'Find ranked 2v2' buttons are live whenever ranked is on (app.js:2244-2245); the only exit is the honest 3-minute give-up toast (app.js:3580,3612).

**Impact:** With near-zero concurrent players at solo-dev pre/early launch, a 2v2 search always spins 3 minutes then gives up, so the mode reads as broken to early users. It degrades gracefully (clear toast, no stuck state), so this is a scarcity/UX gap rather than a correctness defect. Downgraded/retained at S3; overlaps thematically with the arena/Redis finding (both are backfill-availability gaps).

**Recommendation:** Either add engine bot-backfill for 2v2 (fill empty seats with labeled Computers as arena does) or soft-gate the 2v2 entry points until online concurrency is high enough that matches form.

### 8. REJECTED: empty placeholder finding  `S3` — _REJECTED_

**Evidence:** First raw auditor record contained only stub tokens (title 't', evidence 'e', impact 'i', recommendation 'r') with no substantive content and no file:line citation to verify.

**Impact:** None — not a real finding; culled so the chief sees it was a null record, not a suppressed issue.

**Recommendation:** Ignore; likely a serialization artifact from the auditor's output.
