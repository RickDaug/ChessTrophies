# ChessTrophies — Project state (snapshot)

**Last updated:** 2026-06-08 — **RANKED IS LIVE (bot-backfill) + board drag-and-drop + ELO-targeted engine.** **RANKED ON by default** now (env `RANKED_ENABLED=0` disables) with **server-authoritative engine BOT-BACKFILL** (`server/bot.js` loads chess.min.js + ct-ai.js head-less; `server/game.js`: ~16s in the ranked queue with no human → a bot game in the SAME validated move loop, bot replies computed server-side). **Fair + non-farmable:** the bot plays at YOUR current rating (expected 0.5 → ELO-neutral); `finishBotGame` updates only the human's elo/W-L/streak (no `games` row); client can't pick strength. **Honest:** opponent shows "Computer 🤖 (ELO N)" + `isBot` (existing UI, no app.js edit). 2v2 stays human-only. This turns the whole trophy/ELO/victim-streak loop ON (solves the no-players cold-start). Engine: new `CT_AI.bestMoveForElo(fen,targetElo)` (smooth 600-2400 strength) powers the bot. **Board DRAG-AND-DROP** added (Pointer Events, coexists w/ click-to-move, reuses tryMove/afterMove, reduced-motion safe, themed pieces drag too). Tests: ranked-bot, ranked-flag (on-by-default), smoke-2v2, drag-check, elo-strength all green. **Owner note:** ranked now exposes users to bot games immediately on deploy — that was the approved cold-start fix. — Earlier (2026-06-08): **RETENTION + GAME-FEEL BATCH: puzzle rating + Puzzle Rush, win drama, engine endgame fix.** (3) **Puzzle rating + Rush** (the audit's #1 chess-retention feature): per-user **puzzle rating** (Glicko-lite, `puzzle_ratings`) updated server-side off the verified solve; `/api/puzzles/failed` lowers it; idempotent per puzzle/day (`puzzle_attempts`) so it can't be farmed/griefed; `/next` is now **adaptive** (serves near your rating); **Puzzle Rush** survival mode (3-min/3-strike, `rush_scores` best) where the client submits each solved line and the **server re-verifies every line** so scores can't be forged. Client (`puzzles.js`): Daily|Trainer|Rush segmented control + a prominent rating value with a +/- delta chip + a Rush HUD. (2) **Win drama** (`app.js`/`index.html`): confetti on EVERY local-human win (scaled below trophy/streak bursts, no double-fire), a **checkmate board moment** (mated-king square flash + topple ~420ms before the modal, reduced-motion-safe), and result-modal win/lose/draw polish. (1) **Engine endgame fix** (`ct-ai.js`): material-based phase taper + endgame king-centralization PST + a mate-driving corner-distance/king-proximity term + a no-slack-past-forced-mate guard — it now actually converts **K+Q-vs-K (17-27 plies) and K+R-vs-K** (was 22 moves w/ no mate); `test/endgame.mjs` added; review-eval unregressed. All suites green (incl. new endgame + B8-B15 rating/rush tests). — Earlier (2026-06-08): **THEMED SETS = PREMIUM PERK (model changed from microtransactions) + art polished + puzzle anti-forgery.** **Monetization model CHANGED per owner:** the 19 themed piece/board sets are NO LONGER one-time $2.99 purchases — they are a **Premium-subscriber perk**, equippable only while the subscription is active and **auto-revoked on lapse/cancel** (`CT_Sets.enforcePremium()` reverts to Classic, driven by the existing Stripe self-heal). Backend: `/api/store/catalog` lists 19 sets as `{sku,name,factions,premium:true}`; the one-time `/api/store/checkout` + per-set webhook grant were REMOVED (subscription billing untouched); `/api/me` dropped `ownedSets`. Client (`shop.js`): the Store (Profile → 🛍️ Store) is a **gallery** — anyone can **Preview**, subscribers **Equip**, others get **"Unlock with Premium"** → the sub upgrade. Premium modal now leads with "🎨 all premium board & piece sets". **Art POLISHED** via render-and-self-review agents: fixed the `dragons-slayers` green-on-green contrast (now warm-brown board + pale jade Dragons), redrew weak **knights into real horse-head profiles** across ~9 sets, fixed **queen≠king** (orcs/wizards/angels-demons) + clipped crowns. All 19 validated + render-confirmed legible (w light / b dark on both squares); they're solid cohesive flat-icon sets (owner can request further polish on any). **`STRIPE_PRICE_SET_*` envs are now irrelevant** — access is purely `is_premium`. **Security:** `/api/puzzles/solved` now requires + server-verifies a proof-of-solution move line (was forgeable). All 22 suites green. **Also (earlier this session, still true):** daily-streak at-risk loss-aversion + tap-to-daily; share-card domain fixed. — Earlier (2026-06-08): **COSMETIC STORE + 19 THEMED PIECE/BOARD SETS (initial build, one-time-purchase model since superseded) + Tier-0 retention fixes.** Building a non-predatory cosmetic Store (themed chess piece+board sets, $2.99 each, owned forever) — see **STORE_DESIGN.md** (the living spec + art bible + per-set motifs + progress tracker; read it first). **Architecture:** `piece-sets.js` (manifest + lazy `CT_Sets` loader) + `sets/<slug>.json` (board palette + 12 themed SVG pieces each); `app.js` `pieceSVG()` now calls `window.CT_Sets.pieceSVG()` first and falls back to the built-in Staunton. Ownership is server-authoritative (entitlements). **Status:** scaffold + design doc committed; **art for 16/19 sets drafted** by parallel agents (vikings-saxons, pirates-navy, aztecs-conquistadors, medieval-crusaders, templars-saracens, arthur-morgan, egypt-nubia, gods-titans, dragons-slayers, angels-demons, orcs-elves, wizards-necromancers, steampunk-clockwork, aliens-humans, robots-cyborgs, zombies-survivors — validated structurally, NOT visually rendered yet); samurai-ninja/spartans-persians/romans-barbarians + the Store entitlements backend still in flight. **DONE + committed + deployed:** backend entitlements (server/entitlements.js, /api/store/catalog + /checkout, webhook one-time grants, /api/me ownedSets), all 19 `sets/*.json`, the client engine (piece-sets.js), the build copies `sets/` to dist (excluded from SW precache), AND the **Store UI under Profile** (`shop.js` + a "🛍️ Store" Profile card + `#screen-store` — renders a card grid with live themed-board previews, Preview/Equip/Buy, Classic revert; headless-verified rendering all 19 sets). All 22 test suites green. **REMAINING:** (1) **art polish/render-review before enabling sales** — quality is uneven (dragons-slayers has green-on-green contrast; knights weak across some sets); (2) owner creates Stripe one-time Prices + sets `STRIPE_PRICE_SET_<SLUG>` envs to flip sets from `comingSoon`→buyable; (3) optional: server-side gate equip to owned once sales are live (today equip is client-side/preview-open since nothing is sellable yet). Superheroes/villains set DROPPED (copyright). **Also shipped (Tier-0 from the 5-lens audit):** daily-streak card now has an escalating **at-risk ("ends tonight!") loss-aversion** treatment + is tap-to-daily; **share-card footer domain fixed** chesstrophies.com→playchesstrophies.com (was a dead-link growth leak). — Earlier (2026-06-08): **PREMIUM SELF-HEAL + ACCURATE REVENUE + REDESIGNED ADMIN DASHBOARD + MANAGE-SUBSCRIPTION LINK.** **(1) Bug: "paid but prompted to pay again on next login."** Root cause class: premium relied solely on webhook-driven `is_premium`, so a missed/dropped webhook (or flag drift) left a paying user looking non-premium. Fix = **self-healing reconcile against Stripe's LIVE subscription status**: new `reconcilePremiumForUser()` + `POST /api/billing/sync` (`server/billing.js`) looks the user up by `stripe_customer_id` AND by email, and if any active/trialing/past_due subscription exists, (re)grants premium (backfilling the customer mapping); only clears premium when Stripe DEFINITIVELY shows no active sub (never demotes on a transient Stripe error). The client calls it from `enterApp()` (`app.js` `syncPremiumFromStripe()`) on every login/restore, then refreshes ads/UI. The client premium path was verified correct (`ct-auth.js:187` already maps `isPremium` from `/api/me`), so this server-side reconcile is the durable fix. **(2) Revenue was wrong ($14.97 for one $4.99 charge)** — that's the H1 ledger double-count (the OLD webhook recorded one charge under `checkout.session.completed` AND both invoice events = 3 rows). Our earlier code fix stops FUTURE double-counts; now the dashboard shows **accurate revenue straight from Stripe** (the source of truth, immune to the ledger): new `stripeRevenueStats()` (`server/billing.js`, cached ~5min) sums succeeded charges net of refunds + MRR/active-subs from live subscriptions + a 30-day daily series; `/api/admin/stats` prefers it and falls back to the ledger if Stripe is unavailable. (The 3 historical ledger rows are now irrelevant to the displayed number; they can be left as-is.) **(3) Admin dashboard fully redesigned** (`admin.html`) — dark modern SaaS analytics: KPI cards (all-time revenue, MRR+ARPU, active subs, premium/total users, online now, games), inline-SVG charts (revenue-over-time area chart, signups/day + games/day bar charts, all dependency-free + CSP-safe), recent-payments panel, shares breakdown, restyled user directory. Stats endpoint enriched with `stats.revenue{...}` + `stats.series{signupsDaily,gamesDaily}` (`server/server.js` `dailyCountSeries()`). **admin.html was never actually deployed (live 404 — not in the build's COPY_ASSETS); now added** so the dashboard is reachable at `/admin.html` (key-gated by ADMIN_KEY server-side). **(4) Settings → Manage Subscription** (`index.html` + `app.js`): a new Settings "Subscription" section (shown when billing is live) with an in-app "Manage Subscription" button (opens the per-customer Stripe portal via `/api/billing/portal`) plus a static fallback link to the Stripe customer portal login page. All node + Playwright suites green (billing, admin, csp, build-smoke, etc.). **Manual TODO still:** none blocking — Stripe Customer Portal is now activated (the user provided the portal login link). — Earlier (2026-06-07): **MULTI-AGENT QA-AUDIT FIXES + REAL PUZZLES (Lichess-backed).** Ran a 5-lens QA audit (principal eng / QA / chess domain expert / product-UX / casual user), then fanned out 5 agents to fix the prioritized list. All 22 test suites green. **(1) Billing money-path correctness** (`server/billing.js`): the webhook now `await`s `handleEvent` and returns **500 on failure** so Stripe retries (previously it ACKed 200 then processed detached — a restart could permanently drop a paid premium flip); revenue is now recorded from **exactly one event type** (`invoice.payment_succeeded`) instead of also `checkout.session.completed` (which double/triple-counted every new subscriber's first charge ~2-3x in the admin revenue dashboard); pinned Stripe `apiVersion: '2024-06-20'`; added a prod `event.livemode` guard. **(2) REAL interactive puzzles** replacing the fake scripted single-move "daily lesson" (which forced the only correct move so you could never get it wrong): self-hosted **Lichess CC0** model — `server/puzzles.js` (`GET /api/puzzles/daily` deterministic by UTC date, `/next?rating=`, `POST /solved` auth-gated streak), `server/import-puzzles.mjs` (Lichess puzzle-CSV importer = the scale-up path to millions), `server/puzzle-seed.mjs` (**28 chess.js-verified** seed puzzles derived from the 60 python-verified academy lessons, so it works today with zero download), puzzle-progress persistence in `db.js`/`db-pg.js`/`store.js` (`puzzle_solves` idempotent + `puzzle_streaks`). Client `puzzles.js` (`window.CT_Puzzles`) implements **PUNISH-THEN-RETRY**: a wrong move makes the engine play the refutation (you feel the consequence), then Undo/Retry. The **daily streak is now earned by SOLVING the daily puzzle** (replaced the passive "opened a game" streak). `test/puzzles.mjs`. **Scale-up TODO:** run `node server/import-puzzles.mjs <lichess_db_puzzle.csv>` to grow past the 28-seed corpus. **(3) Checkers ACF rule fix** (`checkers.js`): **BLACK moves first in 8×8 ACF** (was wrongly using the International/FMJD white-first convention — the headline ranked mode literally had the wrong starting player); FMJD 10×10 stays white-first via a per-variant `firstMove` flag; the ACF 40-move no-progress draw now counts **per-side** (~80 plies) instead of declaring draws at half length. Tests updated (engine/online/friend). **(4) Client UX overhaul** (`app.js`/`index.html`/`ct-auth.js`): fixed the **BLOCKER funnel dead-end** — "Play now" and guest "Casual" now **start a game** instead of a jarring native `confirm()` about ranked; **premium copy is now driven by `billingCfg.enabled`** (killed the "$4.99/mo button over 'free preview / coming soon' copy" contradiction that showed at the moment of payment); lobby leads with the working mode when ranked is off; ad slots + "Remove ads" upsell hidden until ≥1 game finished; bottom nav 7→5 (Settings folded into Profile); **centralized 401 handling** → re-login prompt on all data paths + socket (previously friends/progress/socket silently swallowed expiry and stranded users); dropped `user-scalable=no` + `defer`red scripts; optional skill/region at signup; guest "create an account to keep your progress" CTA after first win; wired a "🧩 Today's Challenge" lobby card + Puzzles nav to `CT_Puzzles`. **(5) Build/SW correctness** (`scripts/build.mjs`/`sw.js`): the SW precache list is now derived from the **real dist tree** (was precaching `app.js`/`academy.js` which the bundler folds into `app.bundle.js` and never emits → 404 → atomic `addAll` nuked the whole precache → offline was dead); `CACHE` is stamped per deploy so `activate` evicts stale caches; precache is now resilient (`Promise.allSettled`); and the synthesized `app.bundle.js` `<script>` now inherits `defer` (it was executing synchronously *before* its now-deferred deps and throwing). **STILL TODO:** activate the Stripe **Customer Portal** in the Dashboard (for in-app cancel/manage). — Earlier (2026-06-07): **STRIPE BILLING IS LIVE — real payments working end-to-end.** Verified with a real live-mode purchase: Upgrade → Stripe Checkout → payment → webhook (`checkout.session.completed`) → `is_premium` flipped → ads removed. Setup that got it live: created the **live** webhook endpoint (`<APP_URL>/api/billing/webhook`) in the Stripe Dashboard and set Railway env `STRIPE_SECRET_KEY` (sk_live), `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` (pk_live), `APP_URL=https://www.playchesstrophies.com`. **Two gotchas hit + fixed:** (1) `STRIPE_PRICE_ID` was initially set to a literal dollar amount instead of a `price_...` object id → checkout 502'd (`The price parameter should be the ID of a price object`); fixed by using the recurring price's `price_...` id. (2) `app.set('trust proxy', 1)` added to `server/server.js` (commit `c0832d4`) — behind Railway's proxy, express-rate-limit was throwing `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`. **Still TODO before relying on cancel/manage:** activate the Stripe **Customer Portal** (Dashboard → Settings → Billing → Customer portal) — the "Manage subscription" button calls `/api/billing/portal`, which 502s until the portal is activated once. Architecture note: game is served by **Vercel** at `www.playchesstrophies.com` (cross-origin to the Railway API); CORS already allow-lists the domain (`DEFAULT_WEB_ORIGINS` in server.js). — Earlier (2026-06-07): **STRIPE BILLING + CHECKERS MOVE ANIMATION + FRIEND-CHECKERS BUTTON** (branch `stripe-checkers-anim-friend`): **(1) Checkers move animation** — checkers moves used to teleport (a triple-jump applied instantly); now the moving piece slides across the board and multi-jumps hop through each landing, fading each captured piece as it's passed. Implemented entirely in `ct-checkers.js` (`animateMove(move, done)` re-parents the real piece into an absolute float, transitions `transform` per hop using the engine move's `path`/`captures`; engine STATE stays synchronous so tests/logic are unaffected — animation is purely visual). Degrades to instant render when the board isn't visible / reduced-motion / data missing. Tapping during a slide flushes the animation (never swallowed). Gated by new `test/checkers-anim.mjs` (brute-forces a real double-jump, asserts the float steps through ≥2 hops + both pieces removed). **(2) Stripe subscription billing** (Stripe-hosted Checkout redirect, fully env-gated, inert until configured): new `server/billing.js` (`/api/billing/config|checkout|portal|webhook`; webhook mounted with `express.raw` BEFORE `express.json()` for signature verification), `payments` ledger + `stripe_customer_id`/`subscription_status` columns + `revenueStats()` in db.js/db-pg.js/store.js, `is_premium` flipped by webhook (`checkout.session.completed`/`invoice.paid`/`subscription.deleted|updated`, idempotent on event id). Client (`app.js`): `fetchBillingConfig()` + `startCheckout()`/`openBillingPortal()`; the Premium modal's buy/cancel buttons hit Stripe when `billingCfg.enabled`, else fall back to the demo toggle; `handleBillingReturn()` polls `/api/me` after `?billing=success` to activate Premium. **Railway env to set:** `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` (recurring), `STRIPE_WEBHOOK_SECRET`, optional `STRIPE_PUBLISHABLE_KEY`; webhook URL `<APP_URL>/api/billing/webhook`; **`server` needs `npm i`/Docker rebuild** (new `stripe` dep). Gated by `test/billing.mjs`. **(3) Admin revenue analytics** — `/api/admin/stats` now returns `revenueMonthCents`/`revenueYearCents`/`revenueAllTimeCents`/`activeSubscribers`/`currency`; `admin.html` shows Revenue · month/year/to-date cards (formatted from cents). **(4) Clearer friend challenge** — each friend row now has explicit **♟ Chess** and **⛀ Checkers** buttons (`startFriendChess`/`startFriendCheckers` via `selectFriendById`) instead of only a modal. All suites green (incl. checkers-anim, billing, build-smoke, csp). — Earlier (2026-06-07): **CASUAL ONLINE PLAY + REPEATABLE TROPHIES + RANKINGS INTEGRITY** (branch `casual-play-trophies-rankings`): Added unrated **"Play online — Casual"** matchmaking for **chess 1v1** (`#btn-find-casual` → `startOnlineOrFakeMatchmaking('casual')`) and **checkers** (`#ck-btn-find-casual` → `CT_Checkers_UI.startFindCasual`). The server already accepted `mode:'casual'` (ungated, `rated:false`) but no UI ever sent it, so with ranked off there was *no* online "for fun" option. Casual is never gated by the seasonal ranked switch and never touches ELO/wins/streaks/trophies (matches the server's `mode==='ranked'`/`cg.rated` guards). 2v2 stays ranked-only. **Trophies are now repeatable with an earned-counter**: streak trophies + single-game feats (fast wins, underpromotion, shutout, triple-jump, …) re-earn and show an `×N` badge (`achievementCount`/`awardAchievement`, `repeatable:true` in trophy-data.js); cumulative milestones (total wins/games/rating/checkmates/invites) stay one-time. Repeatable awards only count on the FINAL post-game pass (`ctx.finalize`) so the two-phase chess result flow can't double-count; legacy saves (no `count`) read as 1 and keep counting. The **Checkers** trophy collection already rendered (auto-grouped by family) and is earnable in ranked checkers; its feats also fire in casual. **Rankings now list participants only** — `topByMetric` (db.js + db-pg.js) filters by a fixed per-metric participation map (elo→`wins+losses+draws>0`, wins→`wins>0`, streak→`best_streak>0`, trophies→count>0, checkers8/10→new `checkers8_games`/`checkers10_games` counters incremented in `finishCheckersGame` when rated); client mirrors the filter in its offline fallback + friendly empty-state. Checkers ELO confirmed a real separate system (elo_checkers_8/10, K=32, official ACF 8×8 rules); friend invites for chess AND checkers confirmed wired (Friends → tap friend → modal). New tests `test/rankings-participation.mjs` + `test/trophies-repeat.mjs` (both in CI); all 18 suites green. — Earlier (2026-06-07): **WENT WEB-ONLY**: removed the native/Capacitor (Android) layer entirely — deleted `android/`, `capacitor.config.json`, `www/`, `scripts/refresh-www.sh`/`.ps1`, `docs/ANDROID_BUILD.md`, and the 4 `@capacitor/*` deps. ChessTrophies is now strictly a website (desktop + mobile web): Vercel serves the client (`npm run build:dist` → `dist/`), Railway serves the API; the **PWA stays** (`sw.js` + `manifest.json`) so mobile users can still "Add to Home Screen" with offline support. `config.js` simplified to web-only origin routing (off-origin Vercel client → Railway API; same-origin/local-dev unset). `ct-ads.js` reduced to a web no-op shim (native AdMob removed; in-page ad slots remain for AdSense). To re-add an app store later: `npx cap init` + `npx cap add android` and reintroduce the www refresh. NOTE: tables/inventory below still mention the Android app/`www`/refresh scripts — those are historical now. — Earlier (2026-06-06): **multi-perspective QA audit + fixes** (branch `audit-fixes`, pushed; not yet merged to `main`). Ran a 5-lens audit (principal engineer, QA, chess domain expert, product/UX, casual user), then implemented the findings: **(security/backend)** server now allowlists the client `mode` so it decides ranked-vs-casual (closed an ELO-integrity hole), safe CORS default + prod warning, verification-code resend rate-limited, avatar data-URLs validated, graceful shutdown + global error handlers. **(engine/review)** quiescence now handles being in check, mate-distance scoring, removed the random-capture sabotage (replaced with principled depth/noise/slack weakening), root alpha-beta in `bestMove`, unified review eval + softened "likely blunder/mistake" labels + honest exponential accuracy. **(content)** fixed lesson SK04 (Nf6+ only) and EG02 (real Qc5 boxing), precise opposition wording, corrected lesson count 115→60. **(frontend)** stripped stale demo/Phase-2 copy, honest guest ranked CTA (no fake search), lead-with-Play onboarding, deduped buttons, socket.io CDN fallback, SW update prompt (guarded vs first-visit reload), localStorage write guards, PNG/maskable icons, safe-area-top. **(new features)** **Daily Challenge + streak** retention loop (`daily-challenge.js`, reuses the 60 verified lessons, rides `/api/progress` sync); **PostgreSQL persistence tier** (`server/store.js` + `server/db-pg.js`, async facade, SQLite default / Postgres when `DB_BACKEND=postgres` (+ `DATABASE_URL`) — opt-in flag, NOT on bare DATABASE_URL since Railway auto-injects it; live-game write path fully converted — PE-M1 closed); **real Chess960 castling** (`CT_960Castle` in `chess960.js`, human + engine, mode re-enabled) gated by `test/chess960-castle.mjs` (46 assertions) + `test/chess960-ai-castle.mjs` (32). All suites green: smoke-2v2, verify, rankings, review-eval, both chess960 tests, lessons 60/60. **(CSP)** hardened **script-src** to `'self' https://cdnjs.cloudflare.com` (dropped `'unsafe-inline'`): externalized the 4 inline `<script>` blocks (`ct-onerror.js`, `ct-chess-check.js`, `ct-socket-fallback.js`, `ct-sw-register.js`) and converted all 21 inline `on*` handlers to `addEventListener`/delegation, gated by `test/csp.mjs` (Playwright, 0 script-src violations + handlers verified). style-src intentionally keeps `'unsafe-inline'` (many dynamic inline `style=` attributes). **(build)** added `npm run build:dist` (esbuild, `scripts/build.mjs`) → minified `dist/` web bundle (39% smaller JS; tail app/academy/daily/review/trophy-extras/learn-library concatenated into `app.bundle.js`, ct-ai.js/chess960.js kept standalone for the Worker), gated by `test/build-smoke.mjs` (boots + flows + worker path + 0 CSP violations). Deploy: Vercel build command `npm run build:dist`, output dir `dist`. Not wired into `refresh-www.sh` (native uses readable source + string-matching patches). **Still open:** regenerate `www/` (`bash scripts/refresh-www.sh`) once Android Studio releases the folder lock. — Earlier (2026-06-04): switched email verification to a **6-digit code** (authenticated + per-user, throttled to 5 tries, 1h expiry) instead of a link; added a startup log of the email-provider state. NOTE: emails still only send once `RESEND_API_KEY`/`RESEND_FROM`/`APP_URL` are configured on Railway. Earlier: fixed the **rankings leaderboard only showing yourself + local guests**: it read the per-device DB instead of the server. Now `/api/rankings` is the source (all metrics incl. computed Trophies), with a local fallback only for guests/offline (`npm run test:rankings`). Earlier: added Open Graph share banner; removed the **entire Puzzles tab** (puzzles were inaccurate; files + CI step deleted, nav/UI cleaned up); expanded the **Learn library to 43 articles** (25 new, all fact-checked — fixed 2 errors in existing ones: opposition odd→even, luft = rook's pawn); fixed the **friend-add "no user on this device" bug** (longer auth timeout so Railway cold starts don't strand users in a tokenless offline session; honest offline/guest messaging instead of a useless local lookup). Earlier: removed the Daily puzzle mode; added engine-backed game analysis/review (eval bar + eval graph + blunder detection with best-move hints; `npm run test:review` guards it in CI) and, earlier, soft email verification on signup (non-blocking nudge + verify link/code + resend; `npm run test:verify`). Earlier the same day: big push since 06-01: game clocks (now simplified to one timed + untimed), rematch/disconnect-reconnect UX, Redis-backed multi-instance scaling for online play, password reset + change password, progress sync to the server, server-backed friends with friend-request consent + block + in-game opponent avatars, AdMob banner scaffold, Android release signing, computer AI moved to a Web Worker, and a rebuilt academy curriculum. Client split into focused modules (`ct-ai.js`, `ct-auth.js`, `ct-duo.js`, `trophy-data.js`, `ct-ads.js`, `ct-ai-worker.js`).

This file is the canonical "where are we, what's next" document. Read it first when you come back.

---

## What exists right now

### Built and verified working

| Feature | Status |
|---|---|
| Email/password auth | ✓ Done — local + server endpoints |
| Password reset + change password | ✓ Done — `/api/auth` reset flow with email delivery (`server/email.js`) + in-app change password |
| Email verification on signup | ✓ Done — **soft (non-blocking)**: signup emails a **6-digit code**; the user types it into the in-app banner/modal. Verify is authenticated + per-user, throttled (5 wrong tries burn the code), 1h expiry, resend supported. `/api/me` exposes `emailVerified`; unverified users can still play. **Email only sends when `RESEND_API_KEY`+`RESEND_FROM`+`APP_URL` are set on the backend** (startup logs say which). Tested by `npm run test:verify` (in CI) |
| Cross-device progress sync | ✓ Done — `/api/progress` deep-merges puzzle/lesson state + max counters so progress follows the account, not the browser |
| Player profiles with stats | ✓ Done |
| Pass-and-play PvP (same device) | ✓ Done |
| Skill-based matchmaking (±100 ELO) | ✓ Done |
| Online ranked 1v1 (real opponents) | ✓ Done — wired to Railway server via Socket.IO (Phase 2). Required the 2026-06-01 JWT-drop fix to actually connect (see Verification note) |
| Online ranked 2v2 team chess | ✓ Done — solo queue or friend duo, server pairs four players into two teams, 3-min queue, separate 2v2 ELO, server-authoritative moves. **Multi-device (4-client) end-to-end verified 2026-06-01** (see Verification note below) |
| Game clocks (time controls) | ✓ Done — server-authoritative clocks for online 1v1 + 2v2. **Simplified 2026-06-04** from 6 options to two: one standard timed control (10+0) + untimed, so a small queue isn't fragmented across buckets |
| Rematch + disconnect/reconnect (1v1) | ✓ Done — rematch offers after a finished game, disconnect-grace window + reconnect into a live game |
| Multi-instance scaling (Redis) | ✓ Done — Socket.IO Redis adapter + shared game/queue state, gated on `REDIS_URL`. 1v1, 2v2, duo invites, reconnect & rematch all work across server instances |
| Practice vs Computer (Easy/Med/Hard) | ✓ Done — built-in minimax with PSTs, quiescence, iterative deepening (≈1500-1700 ELO); search runs in a Web Worker so the UI never freezes |
| Game analysis / review | ✓ Done — post-game **Review** opens an engine-backed analysis: per-move accuracy %, Best→Blunder classification with "best: …" suggestions, an **eval bar** + per-move **eval graph**, navigable board. Reuses the built-in engine via new `CT_AI.evaluate`/`bestMove`; runs async with a progress %. Tested by `npm run test:review` (in CI) |
| 60 verified chess lessons | ✓ Done — every solution verified by python-chess |
| Lesson teaching + Watch Example demo | ✓ Done |
| Avatar rank progression (Pawn → King) | ✓ Done |
| 8 board themes + 5 piece themes | ✓ Done |
| Modern Staunton-style chess piece SVGs | ✓ Done |
| ELO ratings | ✓ Done |
| 7-win streak trophies with victim usernames | ✓ Done |
| 60 tiered achievements | ✓ Done — Wins, Streak, Rating, Fast Win, Veteran, Mates, Comeback, Hidden Feats, Embarrassing, Recruiter |
| 10 hidden trophies (??? until earned) | ✓ Done |
| 10 embarrassing fail trophies | ✓ Done |
| Recruiter trophy (invite friends) | ✓ Done |
| Tiered rankings (Top 100/500/5000/All-time, 4 metrics) | ✓ Done — **server-backed global leaderboard** via `/api/rankings` (ELO/Wins/Trophies/Streak). Guests/offline fall back to the per-device list. Guarded by `npm run test:rankings` |
| Friends list + add by username | ✓ Done — server-backed with username autocomplete/search, friend-request consent (no silent adds), and block-player |
| In-game opponent avatars | ✓ Done — opponent avatar/rank shown during online games |
| Friendly (non-ranked) challenge mode | ✓ Done |
| Private room codes | ✓ Done |
| Invite & Share modal with link + native share | ✓ Done |
| Ads framework (Banner + Medium Rectangle) | ✓ Placeholders ready for AdSense/AdMob |
| AdMob banner (native Android) | ✓ Scaffolded — `ct-ads.js` wires the Capacitor AdMob banner using Google test ad unit IDs (swap for real IDs before launch) |
| Android release signing | ✓ Done — release builds sign from a gitignored `keystore.properties` (see `docs/ANDROID_BUILD.md`) |
| Premium tier (₪ flips `isPremium`) | ✓ **LIVE** — real Stripe subscription billing ($4.99/mo). Checkout→webhook→premium→ads-removed verified with a real payment. Falls back to demo toggle only if `/api/billing/config` reports disabled |
| Sound effects via Web Audio | ✓ Done — move, capture, check, castle, promotion, game over, trophy |
| PWA (installable) | ✓ Done — manifest.json + service worker |
| Backend server (deployed) | ✓ Done — `server/` Express + Socket.IO + SQLite, live on Railway |
| Native Android app | ✓ Done — Capacitor wrapper (`com.chesstrophies.app`), installs & runs against the Railway backend; full signup loop confirmed on a Samsung A16. See `docs/ANDROID_BUILD.md` |
| MIT LICENSE | ✓ Done |
| Privacy Policy template | ✓ Done — `privacy.html` |
| Terms of Service template | ✓ Done — `terms.html` |
| End-to-end runtime test | ✓ Done — all flows verified clean |

### Verification — 2v2 changes (2026-06-01)

Removal of the "Practice 2v2 (vs AI)" mode and the corny RANKED 2v2 copy was **verified PASS** by driving the real web client in headless Chromium (Playwright, guest login → lobby):

- Front page shows only the **RANKED 2v2** card — no "Practice 2v2 (vs AI)" card, no corny description paragraph.
- `window.Duo` API no longer exposes `startPractice`/`startRanked`; `duoPickMove` is gone; no `pageerror`/ReferenceError from the removed AI code.
- "Find ranked 2v2" button still wired: clicking it fires `startOnlineTeamMatchmaking`, which correctly guards on the server connection.

### Verification — online play multi-device + JWT-drop bug fix (2026-06-01)

The earlier "successful online 2v2 match" gap was closed by running the **real backend locally** (throwaway SQLite DB) and driving **4 isolated browser sessions** (Playwright) through signup → queue → match → moves.

**Bug found (was breaking ALL online play):** the login and signup form handlers (`app.js`) called `setSession({ userId: u.id })` *after* `login()`/`signup()` had already stored `{ userId, token }`, overwriting the session and dropping the JWT. With no token, `connectGameSocketIfPossible()` bailed and the game socket never connected — so freshly authenticated users could never reach online 1v1 **or** 2v2. It went unnoticed because the REST signup loop (and the earlier single-player verify) don't exercise the socket. Marking online play "verified" before this was premature.

**Fix (commit `e590af9`):** merge into the existing session instead of replacing it — `setSession(Object.assign({}, getSession(), { userId: u.id }))` — so the server-auth token survives. Local/offline fallback paths stay intentionally tokenless. Propagated to `www/` via `scripts/refresh-www.sh`.

**Re-test against the fixed code (no patches) — PASS:** all 4 clients signup → socket-auth → server pairs them into one game with correct seats (w0/w1/b0/b1, identical start FEN) → 4 moves played by w/seat0 → b/seat0 → w/seat1 → b/seat1, each synced server-authoritatively across all four clients, zero page errors. Seat rotation and move sync confirmed working.

### Not yet built / next steps

| Item | Where it goes | Effort |
|---|---|---|
| ~~Stripe checkout for Premium~~ | ✅ DONE — live, real payments working (2026-06-07) | — |
| Activate Stripe Customer Portal | Dashboard → Settings → Billing → Customer portal (enables the "Manage subscription"/cancel button, else `/api/billing/portal` 502s) | 5 min |
| Real AdSense / AdMob ad units | Swap Google test IDs in `ct-ads.js` + `renderAdSlot()` for real units | 1 hour after approval |
| Tournaments | Schema in server already supports games — needs UI + matchmaking | 2-3 days |
| Native iOS wrapper | Capacitor — mirror the Android setup; see docs/ANDROID_BUILD.md | 1-2 days |
| Push notifications | Web Push API + service worker | 1 day |
| Avatar uploads | S3 + file picker in profile | 1 day |

---

## File inventory

Active working copy: `C:\Users\RickD\AndroidStudioProjects\ChessTrophies\` (GitHub: `github.com/RickDaug/ChessTrophies`, default branch `main`). The old `Downloads\ChessTrophies` clone was stale and has been deleted.

### Client (repo root)

| File | Purpose |
|---|---|
| `index.html` | Main app UI, all screens & modals |
| `app.js` | Game orchestration, trophies, rankings, premium, time-control picker (now 2 options) |
| `ct-auth.js` | Extracted storage/auth/network primitives (session, JWT, progress sync) |
| `ct-ai.js` | Computer-opponent engine (minimax/PST/quiescence); also exposes `evaluate`/`bestMove` for Game Review |
| `ct-ai-worker.js` | Web Worker that runs the AI search off the main thread (no UI freeze) |
| `ct-duo.js` | 2v2 "Duo" client (online-only) extracted from app.js |
| `ct-ads.js` | AdMob banner wiring for the native Android shell (Google test IDs) |
| `trophy-data.js` | Trophy/achievement catalog data (extracted; dead ACHIEVEMENTS dropped) |
| `academy.js` | Lessons, roadmap, themes, settings |
| `ct-net.js` | Socket.IO client — online matchmaking, move sync, clocks, rematch/reconnect, 2v2 invites |
| `config.js` | Sets `CT_SERVER_URL` to the Railway backend in the native/Capacitor shell; web stays same-origin |
| `chess960.js` | Fischer Random Chess mode |
| `review.js` | Game review / analysis UI — engine-backed eval bar, eval graph, accuracy %, blunder + best-move hints |
| `learn-library.js` | Strategy Library for the Learn section — 43 fact-checked articles across 7 categories (Opening, Fundamentals, Tactics, Strategy, Endgame, Mindset, Improvement) |
| `trophy-extras.js` | Additional trophy/achievement definitions |
| `sounds.js` | Synthesized sound effects (Web Audio) |
| `stockfish-ai.js` | Stub (Stockfish disabled — keeps app MIT-clean) |
| `chess.min.js` | Bundled chess.js engine |
| `sw.js` / `manifest.json` | Service worker + PWA manifest |
| `privacy.html` / `terms.html` | Legal templates (fill placeholders before launch) |
| `LICENSES.md`, `LAUNCH_GUIDE.md`, `CROSSPLAY_PLAN.md`, `CHANGELOG.md`, `HANDOFF.md`, `SECURITY.md`, `README.md`, `STATE.md` | Docs |

### Backend — `server/` (Express + Socket.IO + SQLite, deployed to Railway)

| File | Purpose |
|---|---|
| `server/server.js` | Express app + WebSocket bootstrap |
| `server/db.js` | SQLite schema + helpers |
| `server/auth.js` | JWT + signup/login + password reset/change + email-verification tokens |
| `server/email.js` | Transactional email delivery (password reset + email verification) |
| `server/game.js` | Matchmaking + real-time games (1v1 + 2v2 teams) + clocks; single-instance path |
| `server/scale-store.js` | Redis-backed shared state for 1v1 matchmaking/games across instances (gated on `REDIS_URL`) |
| `server/scale-team.js` | Redis-backed shared state for 2v2 + duo invites across instances |
| `server/guest-names.js` | Random guest-name generator |
| `server/package.json` / `server/.env.example` / `server/README.md` | Deps, env template, API docs |

### Other top-level folders

| Path | Purpose |
|---|---|
| `android/` | Capacitor + Gradle native Android project (`com.chesstrophies.app`) |
| `www/` | Gitignored Capacitor web bundle — regenerate with `bash scripts/refresh-www.sh` |
| `scripts/` | Build helpers (`refresh-www.sh`) |
| `docs/` | `ANDROID_BUILD.md` runbook and other docs |
| `.github/workflows/` | CI — `smoke-2v2.yml` (4-client online 2v2 smoke test) + `verify-content.yml` (lesson content checks) |
| `capacitor.config.json` / `railway.json` | Capacitor + Railway deploy config |

---

## Legal documents — placeholders to fill before publishing

In **`privacy.html`** replace:
- `[Your legal name / company name]` — your name or LLC
- `[Your address]` — required for GDPR; use a registered agent or PO Box if you don't want home address public
- `[support@chesstrophies.com]` — your real support email (set up on the domain)
- `[chesstrophies.com]` — your final domain name
- `[Insert launch date]` — when you go live
- `[Insert today's date]` — today
- `[Vercel / Railway / Render — fill in]` — your hosting provider
- `[Plausible / Cloudflare Web Analytics / none]` — your analytics choice

In **`terms.html`** replace:
- `[Your legal name / company name]`
- `[Your address]`
- `[support@chesstrophies.com]`
- `[$4.99]` — your actual Premium price
- `[Your state or country]` — governing law (e.g., "the State of Texas, USA")
- `[Your city]` — for arbitration venue (e.g., "Austin, Texas")
- `[Your jurisdiction]` — fallback court venue

**Important:** Have these reviewed by a lawyer before going live with real money. They are solid templates but specific clauses (arbitration, refunds, liability caps) need to be adjusted to your business + jurisdiction.

---

## How to resume work

### Quick wins next session

1. **Buy the domain** (15 min, $10)
2. **Push to GitHub + deploy to Vercel** (15 min, free)
3. **Fill the placeholders in `privacy.html` and `terms.html`** (30 min)
4. **Set up `support@yourdomain.com` email** (10 min)
5. **Announce to friends + r/chess** (30 min)

That's the "go live" sequence. Total: ~2 hours, ~$10.

### Bigger next milestones

- **Wire the client to the backend server** (see `LAUNCH_GUIDE.md` Phase 2). This unlocks real online play across devices.
- **Apply to Google AdSense** once you have ~100 daily visitors.
- **Set up Stripe** for real Premium subscriptions.

### When you reconvene with me

Just say: "Read STATE.md and let's continue with X" — where X is whatever phase from `LAUNCH_GUIDE.md` you want to tackle. I'll pick up immediately without losing context.

---

## Known issues / things to watch

- **localStorage is per-origin** — accounts created at `file://` won't appear at `https://yoursite.com`. Users start fresh when you migrate to the real domain. (Acceptable for soft launch since you have no real users yet.)
- **chess.js is bundled (self-hosted)** — `chess.min.js` at the repo root IS the engine (classic chess.js 0.10.3), loaded locally with a fallback notice if it fails. **socket.io** is the one remaining CDN script (cdnjs); as of the audit it has a local fallback (`vendor/socket.io.min.js`, injected if cdnjs is blocked).
- **Persistence backends** — defaults to better-sqlite3 (zero-config). Set **`DB_BACKEND=postgres`** (+ `DATABASE_URL`) to use PostgreSQL (`server/db-pg.js`); the live-game write path is converted, so with Postgres on, multi-instance replicas no longer all funnel writes through one SQLite file. Postgres is opt-in via the explicit flag — **bare `DATABASE_URL` does NOT switch backends** (Railway/Render/Heroku auto-inject it, which would otherwise crash boot). SQLite path is unchanged and remains the test/default path.
- **CSP script-src is hardened** — `script-src 'self' https://cdnjs.cloudflare.com` (no `'unsafe-inline'`); inline scripts externalized, inline handlers delegated, guarded by `npm`-less `node test/csp.mjs`. **style-src** still carries `'unsafe-inline'` on purpose (lots of dynamic inline `style=` attributes; hardening it is a separate CSS refactor). **Production build available** — `npm run build:dist` (esbuild) emits a minified `dist/` (39% smaller JS, order-safe tail concatenated into `app.bundle.js`, worker files kept standalone), verified by `node test/build-smoke.mjs`. Deploy on Vercel with build command `npm run build:dist` + output dir `dist`. The unminified repo root is still what's served until that Vercel setting is flipped; `refresh-www.sh` (native) intentionally stays on the readable source.
- **~~No email verification on signup~~** — DONE: soft verification. Signups still succeed and can play without confirming (so a missing email provider never blocks anyone); the client nudges them to verify. To actually deliver the emails set `RESEND_API_KEY` + `APP_URL` in prod. If you later want to *require* verification before ranked play, gate it behind a new env flag — intentionally not enforced yet.
- **~~No password reset~~** — DONE (06-02): reset + change-password flow with email delivery (`server/email.js`). Make sure the email provider/env is configured in production.
- **Trophy/puzzle progress now syncs server-side** for logged-in accounts via `/api/progress`. Guests/offline still keep progress per-browser, so clearing browser data wipes a guest's progress — mention in the launch FAQ.
- **Redis is optional but recommended at scale** — online play falls back to single-instance in-memory state when `REDIS_URL` is unset. Set it in production before running more than one server instance, or cross-instance matches/reconnects won't share state.
- **`www/` needs regenerating** — the audit-fixes branch changed many client files; run `bash scripts/refresh-www.sh` (now also copies `daily-challenge.js` + `vendor/`) to rebuild the Capacitor bundle + `npx cap sync` before the next Android build.
- **`audit-fixes` branch not yet merged** — all the 2026-06-06 work lives on `audit-fixes` (pushed to origin). Open/merge the PR when ready.

---

## Money / accounts you'll need

To make this real, sign up for (in order of priority):

1. **Domain registrar** (Cloudflare/Namecheap) — $10/yr
2. **GitHub** — free
3. **Vercel** — free
4. **Resend** — for transactional email — free up to 3K emails/mo
5. **Plausible Analytics** — $9/mo (or use Cloudflare's free Web Analytics)
6. **Railway** — for backend — $5/mo
7. **Stripe** — 2.9% + $0.30 per transaction
8. **Google AdSense** — free, takes ~30% of ad revenue (eligible after some traffic)
9. **Sentry** — error tracking — free tier
10. **(Later) Apple Developer Program** — $99/yr
11. **(Later) Google Play Console** — $25 one-time
12. **(Later) RevenueCat** — for IAP — free up to $10K/mo

---

You're ready to ship. Welcome back whenever.
