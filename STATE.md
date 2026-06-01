# ChessTrophies — Project state (snapshot)

**Last updated:** 2026-06-01 — online ranked play (1v1 + 2v2) live; 2v2 Practice-vs-AI mode removed.

This file is the canonical "where are we, what's next" document. Read it first when you come back.

---

## What exists right now

### Built and verified working

| Feature | Status |
|---|---|
| Email/password auth | ✓ Done — local + server endpoints |
| Player profiles with stats | ✓ Done |
| Pass-and-play PvP (same device) | ✓ Done |
| Skill-based matchmaking (±100 ELO) | ✓ Done |
| Online ranked 1v1 (real opponents) | ✓ Done — wired to Railway server via Socket.IO (Phase 2) |
| Online ranked 2v2 team chess | ✓ Done — solo queue or friend duo, server pairs four players into two teams, 3-min queue, separate 2v2 ELO, server-authoritative moves. Front-page state browser-verified 2026-06-01 (see Verification note below) |
| Practice vs Computer (Easy/Med/Hard) | ✓ Done — built-in minimax with PSTs, quiescence, iterative deepening (≈1500-1700 ELO) |
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
| Friends list + add by username | ✓ Done |
| Friendly (non-ranked) challenge mode | ✓ Done |
| Private room codes | ✓ Done |
| Invite & Share modal with link + native share | ✓ Done |
| Ads framework (Banner + Medium Rectangle) | ✓ Placeholders ready for AdSense/AdMob |
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
- **Gap:** a *successful* online 2v2 match (4 queued players → board → server move sync) was **not** driven end-to-end locally — it needs the live Railway backend with multiple sessions. Worth a manual multi-device pass before relying on it.

### Not yet built / next steps

| Item | Where it goes | Effort |
|---|---|---|
| Stripe checkout for Premium | `server/billing.js` + replace `setPremium(true)` | 2-4 hours |
| Real AdSense / AdMob | Replace `renderAdSlot()` HTML inside | 1 hour after approval |
| Email password reset | New `/api/auth/forgot` route + Resend integration | 4-8 hours |
| Game analysis (eval bar + blunder detection) | Built-in engine already supports it; needs UI | 1 day |
| Daily puzzle | Pull from any free puzzle DB (lichess CSV) | 4-8 hours |
| Tournaments | Schema in server already supports games — needs UI + matchmaking | 2-3 days |
| Native iOS wrapper | Capacitor — mirror the Android setup; see docs/ANDROID_BUILD.md | 1-2 days |
| Email verification on signup | Add to server `/api/auth/signup` | 4 hours |
| Push notifications | Web Push API + service worker | 1 day |
| Avatar uploads | S3 + file picker in profile | 1 day |

---

## File inventory

Active working copy: `C:\Users\RickD\AndroidStudioProjects\ChessTrophies\` (GitHub: `github.com/RickDaug/ChessTrophies`, default branch `main`). The old `Downloads\ChessTrophies` clone was stale and has been deleted.

### Client (repo root)

| File | Purpose |
|---|---|
| `index.html` | Main app UI, all screens & modals |
| `app.js` | Auth, game, computer AI, 2v2 (online-only), trophies, rankings, ads, premium |
| `academy.js` | Lessons, roadmap, themes, settings |
| `ct-net.js` | Socket.IO client — online matchmaking, move sync, 2v2 invites |
| `config.js` | Sets `CT_SERVER_URL` to the Railway backend in the native/Capacitor shell; web stays same-origin |
| `chess960.js` | Fischer Random Chess mode |
| `puzzles.js` / `puzzles-data.js` | Daily/practice puzzles + data |
| `review.js` | Game review / analysis UI |
| `learn-library.js` | Strategy Library content for the Learn section |
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
| `server/auth.js` | JWT + signup/login |
| `server/game.js` | Matchmaking + real-time games (1v1 + 2v2 teams) |
| `server/package.json` / `server/.env.example` / `server/README.md` | Deps, env template, API docs |

### Other top-level folders

| Path | Purpose |
|---|---|
| `android/` | Capacitor + Gradle native Android project (`com.chesstrophies.app`) |
| `www/` | Gitignored Capacitor web bundle — regenerate with `bash scripts/refresh-www.sh` |
| `scripts/` | Build helpers (`refresh-www.sh`) |
| `docs/` | `ANDROID_BUILD.md` runbook and other docs |
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
- **No email verification on signup** — anyone can sign up with `fake@email.com`. Worth adding when revenue is involved.
- **No password reset** — if a user forgets their password before backend deployment, they're stuck. Top priority once you have users.
- **Trophy state is per-browser** until backend is wired — clearing browser data wipes a player's progress. Mention this in your launch FAQ.

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
