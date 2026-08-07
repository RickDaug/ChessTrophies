# Back-end & Data — Squad Report

**Score:** 80 / 100  ·  **Findings:** 4×S2 · 6×S3

Verified all 10 auditor findings against source; all are factually accurate at the cited lines and none were fully rejected. No S0/S1: there are no exploitable, data-loss, or launch-blocking defects. The substantive prod-path issues are hardening items: no outbound-email fetch timeout (blocks the signup handler if Resend black-holes), a bot worker-pool double-respawn amplification bug (one death spawns two workers -> geometric growth on a persistent crash), and a /health endpoint that never pings the DB (Railway won't recycle on a DB outage). The scarier-sounding items (Postgres matchmaking double-pairing, jsonb non-array leaderboard crash, email_verifications migration parity, cross-replica reengage double-send, checkers no scale-out) are all latent behind the opt-in Postgres backend and/or multi-instance mode that is NOT currently deployed. One overstatement corrected: #2's exact-case collision yields an ugly HTTP 400, not a 500, because the signup handler stamps status=400 on un-statused errors.

---

### 1. Bot worker-pool respawn double-fires on a crashing worker (geometric respawn storm)  `S2` — _CONFIRMED_

**Evidence:** server/bot.js:87-88 registers BOTH worker.on('error', ...=>failSlot(slot,true)) and worker.on('exit', ...=>failSlot(slot,true)). On an uncaught worker error Node emits 'error' THEN 'exit'. failSlot (bot.js:95-103) splices the slot on the first call (idx!==-1) but has no dead-guard, so the second call (idx===-1, splice skipped) still reaches `if (respawn && _wantWorkers) spawnWorker()`. Net: one death -> two replacements. Verified in source.

**Impact:** On a persistent-crash condition (thread OOM-kill, native segfault in the alpha-beta search under memory pressure), each death yields 2 respawns, each of which can die and yield 2 more -> geometric thread growth that amplifies the memory pressure. On a small Railway allocation this can spiral into a fork-bomb-style meltdown instead of a clean single-worker recycle. Affects the live prod path.

**Recommendation:** Guard failSlot against re-entry: early-return when pool.indexOf(slot)===-1 (or set slot._dead=true) so only the first invocation spawns a replacement. Add a respawn backoff/ceiling so a fast-crash loop can't outrun the process.

### 2. Outbound email has no request timeout — a hung Resend endpoint stalls the signup/reset handlers  `S2` — _CONFIRMED_

**Evidence:** server/email.js:23-27 calls fetch(RESEND_ENDPOINT, {...}) with NO AbortSignal/timeout, unlike server.js:882 (/api/translate) which uses AbortSignal.timeout(6000). Awaited inline in request-critical paths: server.js:279 `emailVerificationSent = await sendVerifyEmail(...)` inside POST /api/auth/signup, plus forgot-password, plus reengage.js:203 inside the serial dispatch loop. Verified.

**Impact:** If api.resend.com is slow or black-holes the TCP connection, the signup/verify/reset HTTP handler blocks until undici's default header/body timeout (~300s) — a new user watches a spinner up to ~5 min and a connection is held. Also freezes the reengage tick (serial awaits over up to 200 users). Affects the live prod path.

**Recommendation:** Add signal: AbortSignal.timeout(8000) to the fetch in email.js sendEmail, mirroring the translate proxy. Optionally bound the reengage loop with concurrency batching rather than fully serial awaits.

### 3. /health reports process liveness only — never checks DB connectivity  `S2` — _CONFIRMED_

**Evidence:** server/server.js:201 — the /health handler is fully synchronous; every field (durable, dbBackend, botReady, etc.) is derived from in-memory config/flags. No `await store.get('SELECT 1')`. Always returns 200 ok:true while the event loop runs. Verified.

**Impact:** A Postgres pool exhaustion, SQLite file-lock, or corrupt DB leaves /health green, so Railway's health check won't recycle the instance and external uptime monitors won't alert — the API 500s every real request while reporting healthy. Operational, not a direct data defect. Affects the live prod path.

**Recommendation:** Add a timeout-bounded DB ping (SELECT 1 with a 1-2s AbortSignal/Promise.race) that flips ok:false/503 on failure, or a separate /health/deep for the load balancer. Keep it cheap enough to avoid self-DoS.

### 4. Postgres matchmaking (tryMatchmakePg) can pair a player into two games — re-entrant await gap  `S2` — _CONFIRMED_

**Evidence:** server/game.js:1334-1355. Fire-and-forget from tryMatchmake (1305-1307) on every ranked_join. The matchmakingQueue.has() guards (1339,1343) run BEFORE `if (await store.areBlocked(a.uid,b.uid)) continue;` (1345); there is no re-check after the await before the unconditional deletes + startGame (1349-1353). Two overlapping calls both suspend at areBlocked then both consume overlapping entries. The synchronous SQLite path (1309-1329) has no await and is immune. Verified.

**Impact:** Only on the DB_BACKEND=postgres scale-out target (opt-in, NOT deployed today). There, one user can be paired into two concurrent games: userActiveGame overwritten (1403-1404), two match_found events, one orphaned game, possible double ELO movement. Latent until Postgres is enabled.

**Recommendation:** Re-verify both entries are still queued after the await, e.g. `if (!matchmakingQueue.has(a.uid) || !matchmakingQueue.has(match.uid)) continue;` before the deletes; or serialize matchmaking with an in-flight lock.

### 5. Username uniqueness not enforced case-insensitively by the DB — case-variant duplicate accounts possible  `S3` — _CONFIRMED_

**Evidence:** Schema declares `username TEXT UNIQUE NOT NULL` (case-sensitive) with no LOWER() functional index (db.js:21, db-pg.js:91). Lookups are case-insensitive: getUserByUsername uses WHERE LOWER(username)=LOWER(?) (db.js:1003, db-pg.js:947). signup() pre-checks case-insensitively then inserts across an await boundary (auth.js:42 then :45). Concurrent 'Bob'/'bob' both pass the pre-check and both pass the byte-distinct UNIQUE. Verified. CORRECTION: exact-case collision surfaces as HTTP 400 (not 500) — server.js:285 sets e.status=400 on un-statused errors — but with the raw 'UNIQUE constraint failed' message instead of the friendly one.

**Impact:** Low-probability (needs the concurrent check->insert window) duplicate/ambiguous usernames; getUserByUsername then returns an arbitrary row (.get()/rows[0]), affecting login and public-profile/leaderboard/friend-search lookups. The DB provides no backstop for username case — only app logic does.

**Recommendation:** Add a unique index on LOWER(username) in BOTH backends (SQLite: CREATE UNIQUE INDEX ON users(lower(username)); Postgres: same or citext) and normalize on store. Wrap createUser to translate SQLITE_CONSTRAINT_UNIQUE / PG 23505 into the friendly 'already exists' 400.

### 6. Timeout-sweep interval callback is not wrapped in try/catch (a throw exits the whole process)  `S3` — _CONFIRMED_

**Evidence:** server/game.js:363-388 — startTimeoutSweep's setInterval body iterates activeGames/activeTeamGames and calls timeoutFinishGame/timeoutFinishTeamGame with no surrounding try/catch, unlike arena.js:337-341 and reengage.js:238-260 which wrap/.catch(). A synchronous throw escapes as uncaughtException, and server.js:1506-1511 handles that by process.exit(1). Verified.

**Impact:** If a timeout-finish ever throws on unexpected clock/game state, one malformed game restarts the whole server, dropping every live connection. Low likelihood (finishGame is defensive) but whole-process blast radius.

**Recommendation:** Wrap the sweep body in try/catch (log + continue) like the other schedulers, and/or guard each timeoutFinishGame call individually.

### 7. Checkers has no scale-out path — matchmaking queue and game state are per-replica with no Redis backing  `S3` — _CONFIRMED_

**Evidence:** server/game.js:156-166 — checkersQueue/checkersMmBuckets/activeCheckersGames are in-process Maps and the checkers handlers intentionally 'don't consult scaleR' (comment at 157-161), unlike the chess paths that delegate to scale.*/scaleTeam.* when scaleR is set. Documented as a single-instance limitation in-code and in STATE.md. Verified.

**Impact:** Under horizontal scale (REDIS_URL + >1 replica — NOT the current deploy), two checkers players on different replicas never match, and a mid-game reconnect routed elsewhere loses the game. Unlike chess/arena which reject with a user-visible message, checkers degrades silently. A known/documented availability cliff, not a current defect.

**Recommendation:** Gate checkers behind the same scaleR reject the arena uses (honest 'unavailable under scale' message), or back checkers matchmaking/state in scale-store.js Redis before any scale-out.

### 8. Postgres trophy leaderboard throws on non-array achievements JSON where SQLite degrades gracefully  `S3` — _PLAUSIBLE_

**Evidence:** topByMetric uses json_array_length(achievements) on SQLite (db.js:1105) vs jsonb_array_length(achievements::jsonb) on Postgres (db-pg.js:1047,1068,1078). SQLite returns NULL for a non-array value; Postgres RAISES 'cannot get array length of a scalar', aborting the whole leaderboard query. Verified. But the write path always stores a JSON array (setProgress JSON.stringify of a filtered array, db.js:1057/db-pg.js:1000), so a malformed row is not reachable via normal writes.

**Impact:** Double-latent: only on the opt-in Postgres backend (not deployed) AND only with a legacy/hand-edited non-array row that the write path cannot produce. Then the Postgres trophies leaderboard 500s for all users while SQLite silently omits the row.

**Recommendation:** Guard the Postgres expression: CASE WHEN jsonb_typeof(achievements::jsonb)='array' THEN jsonb_array_length(...) ELSE 0 END (and for streak_trophies), so both backends coalesce non-array to 0.

### 9. email_verifications legacy-shape migration exists only in the SQLite backend, not in Postgres  `S3` — _PLAUSIBLE_

**Evidence:** db.js runs a runtime PRAGMA-probe that DROPs email_verifications when it finds the old token_hash shape (db.js:969-984). db-pg.js only does CREATE TABLE IF NOT EXISTS ... code_hash (db-pg.js:221-228) with no equivalent drop/upgrade of a pre-existing token_hash-shaped table. Verified.

**Impact:** Only bites a Postgres DB first created under the older schema — none exists (Postgres is opt-in and greenfield). Effectively latent; flagged for parity completeness since the two migration stories diverge.

**Recommendation:** Add the same defensive drop/ALTER path to db-pg.js init(), or explicitly document that Postgres is greenfield-only for this table.

### 10. Re-engagement scheduler: serial dispatch under a 5-min Redis lock can double-send across replicas  `S3` — _PLAUSIBLE_

**Evidence:** reengage.js:244 acquires the tick lock with SET NX PX 5*60*1000. The dispatch loop (reengage.js:191-220) awaits each push/email serially for up to batchLimit()=200 users (reengage.js:166). Combined with the no-timeout email fetch (linked to the email.js finding), a slow upstream can push a tick past 5 min, expiring the lock mid-run. Verified. NOTE: this is downstream of the email-timeout finding (shared root cause).

**Impact:** Only under multi-instance (REDIS_URL set) — NOT the current deploy. Then an over-running tick releases its lock early, a second replica starts a tick, and users not yet stamped via markReengaged (reengage.js:215) can be notified twice. Cooldown stamping mitigates but does not close the overlap window.

**Recommendation:** Fix the email timeout (bounds per-send time), then either renew/extend the lock while the tick runs, size the TTL above worst-case batch duration, or dispatch in bounded-concurrency batches.
