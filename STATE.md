# ChessTrophies — Project state (snapshot)

**Last updated:** 2026-06-04 — removed the **entire Puzzles tab** (puzzles were inaccurate; files + CI step deleted, nav/UI cleaned up); expanded the **Learn library to 43 articles** (25 new, all fact-checked — fixed 2 errors in existing ones: opposition odd→even, luft = rook's pawn); fixed the **friend-add "no user on this device" bug** (longer auth timeout so Railway cold starts don't strand users in a tokenless offline session; honest offline/guest messaging instead of a useless local lookup). Earlier: removed the Daily puzzle mode; added engine-backed game analysis/review (eval bar + eval graph + blunder detection with best-move hints; `npm run test:review` guards it in CI) and, earlier, soft email verification on signup (non-blocking nudge + verify link/code + resend; `npm run test:verify`). Earlier the same day: big push since 06-01: game clocks (now simplified to one timed + untimed), rematch/disconnect-reconnect UX, Redis-backed multi-instance scaling for online play, password reset + change password, progress sync to the server, server-backed friends with friend-request consent + block + in-game opponent avatars, AdMob banner scaffold, Android release signing, computer AI moved to a Web Worker, and a rebuilt academy curriculum. Client split into focused modules (`ct-ai.js`, `ct-auth.js`, `ct-duo.js`, `trophy-data.js`, `ct-ads.js`, `ct-ai-worker.js`).

This file is the canonical "where are we, what's next" document. Read it first when you come back.

---

## What exists right now

### Built and verified working

| Feature | Status |
|---|---|
| Email/password auth | ✓ Done — local + server endpoints |
| Password reset + change password | ✓ Done — `/api/auth` reset flow with email delivery (`server/email.js`) + in-app change password |
| Email verification on signup | ✓ Done — **soft (non-blocking)**: signup emails a verify link (`/?verify=<token>`), `/api/me` exposes `emailVerified`, client shows a dismiss-on-verify nudge banner + "Enter code" modal + resend. Unverified users can still play. Tested by `npm run test:verify` (in CI) |
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
| 115 verified chess lessons | ✓ Done — every solution verified by python-chess |
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
| Tiered rankings (Top 100/500/5000/All-time, 4 metrics) | ✓ Done |
| Friends list + add by username | ✓ Done — server-backed with username autocomplete/search, friend-request consent (no silent adds), and block-player |
| In-game opponent avatars | ✓ Done — opponent avatar/rank shown during online games |
| Friendly (non-ranked) challenge mode | ✓ Done |
| Private room codes | ✓ Done |
| Invite & Share modal with link + native share | ✓ Done |
| Ads framework (Banner + Medium Rectangle) | ✓ Placeholders ready for AdSense/AdMob |
| AdMob banner (native Android) | ✓ Scaffolded — `ct-ads.js` wires the Capacitor AdMob banner using Google test ad unit IDs (swap for real IDs before launch) |
| Android release signing | ✓ Done — release builds sign from a gitignored `keystore.properties` (see `docs/ANDROID_BUILD.md`) |
| Premium tier (₪ flips `isPremium`) | ✓ Done (demo toggle, ready for Stripe) |
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
| Stripe checkout for Premium | `server/billing.js` + replace `setPremium(true)` | 2-4 hours |
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
- **Chess.js CDN dependency** — if cdnjs is ever down or you go fully offline, the app shows a fallback error. Self-host `chess.js` from your own domain if you want zero CDN reliance.
- **~~No email verification on signup~~** — DONE: soft verification. Signups still succeed and can play without confirming (so a missing email provider never blocks anyone); the client nudges them to verify. To actually deliver the emails set `RESEND_API_KEY` + `APP_URL` in prod. If you later want to *require* verification before ranked play, gate it behind a new env flag — intentionally not enforced yet.
- **~~No password reset~~** — DONE (06-02): reset + change-password flow with email delivery (`server/email.js`). Make sure the email provider/env is configured in production.
- **Trophy/puzzle progress now syncs server-side** for logged-in accounts via `/api/progress`. Guests/offline still keep progress per-browser, so clearing browser data wipes a guest's progress — mention in the launch FAQ.
- **Redis is optional but recommended at scale** — online play falls back to single-instance in-memory state when `REDIS_URL` is unset. Set it in production before running more than one server instance, or cross-instance matches/reconnects won't share state.

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
