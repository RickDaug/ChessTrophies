# ChessTrophies — Project Handoff Document

**Project:** ChessTrophies — a mobile-first chess platform with player profiles, tiered trophies, an academy with hands-on lessons, ranked online play, and a freemium monetization model.

**Owner:** Rick Daugherty
**Repo:** `https://github.com/RickDaug/ChessTrophies` *(not yet pushed at time of handoff)*
**Local working copy:** `C:\Users\RickD\Downloads\ChessTrophies\`
**Status:** Built and end-to-end tested; not yet deployed to a public URL.
**Language / stack:** Vanilla JavaScript (client) + Node.js/Express/Socket.IO/SQLite (server)
**License:** MIT (see `LICENSE`)

This document is the canonical handoff. If you're picking up the project, read it cover to cover before touching code. If you're returning to the project after time away, this is your refresher.

---

## ⚠️  UPDATE 2026-05-27 — read this before relying on anything below

Two things have materially changed since this handoff was first written. The body of the document is still accurate as the original vision and architecture, but newer developers should treat the items below as **authoritative overrides**:

### 1. `index.html` was silently broken on disk

The committed `index.html` (commit `5c51c59`) was truncated mid-string with no closing `</body></html>` and no `<script>` tags loading `app.js`, `academy.js`, `sounds.js`, or `stockfish-ai.js`. The line that claims "End-to-end runtime test ✅ Passed — zero errors" in §2 below could not have been true against this file. Repair landed 2026-05-27 — see `CHANGELOG.md` for the post-mortem.

**Lesson:** every entry-point HTML file should have an automated smoke-test before being declared "verified."

### 2. Security hardening — both client and server

Substantial security work landed 2026-05-27. Read `SECURITY.md` for the complete inventory. Highlights:
- Client: `toast()` was a stored-XSS sink for usernames/room codes — fixed to use `textContent`. Added CSP `<meta>` tag. Added client-side input validation matching the server rules.
- Server: `JWT_SECRET` was defaulting to the literal string `'change-me-in-production'` — fixed to hard-require in prod. Added `helmet`, added `express-rate-limit`, added type-guards on every `req.body` field, made login constant-time, made auth errors generic to prevent account enumeration, added per-user token-bucket rate limits on WebSocket events.
- Server dependency additions: `helmet@^7.1.0`, `express-rate-limit@^7.4.0` — run `npm install` in `server/` after pulling.

### 3. Canonical docs

For onboarding, read in this order:

1. `SECURITY.md` — threat model + control inventory.
2. `CHANGELOG.md` — what changed and why, newest at top.
3. This document (`HANDOFF.md`) — original vision, architecture, file map.
4. `CLAUDE.md` if present — the project owner's local-only resume prompt. May contain outdated facts; cross-check against `CHANGELOG.md`.
5. `LICENSES.md` — Stockfish/MIT boundary (don't enable Stockfish without resolving GPL question).

---
## 2. Current state at a glance

| Pillar | Status |
|---|---|
| Auth (signup / login / sessions) | ✅ Built, works locally + server endpoints exist |
| Player profiles | ✅ Built |
| Pass-and-play PvP (same device) | ✅ Built |
| Practice vs Computer (3 levels) | ✅ Built — custom MIT-licensed minimax with PST, MVV-LVA, quiescence, iterative deepening |
| Skill-based matchmaking | ✅ Built (local mock; server has real version) |
| Friends list | ✅ Built |
| Private match codes + Invite/Share | ✅ Built |
| Academy (115 verified lessons) | ✅ Built — all solutions verified by python-chess |
| Lesson teaching + Watch Example demo | ✅ Built |
| Avatar rank progression | ✅ Built |
| Trophies (60 tiered + hidden + embarrassing) | ✅ Built |
| Rankings (Top N × 4 metrics) | ✅ Built |
| 8 board themes + 5 piece themes | ✅ Built |
| Modern Staunton-style SVG pieces | ✅ Built — all original artwork |
| Sound effects | ✅ Built — synthesized via Web Audio (no audio files) |
| PWA (manifest + service worker) | ✅ Built |
| Ad slot placeholders | ✅ Built — ready for AdSense/AdMob |
| Premium tier (demo toggle) | ✅ Built — ready for Stripe |
| Server scaffold | ✅ Built — not deployed |
| Privacy Policy + Terms (templates) | ✅ Built — placeholders need filling, counsel review required |
| MIT LICENSE | ✅ Done |
| End-to-end runtime test | ✅ Passed — zero errors |
| **Real online play (deployed)** | ❌ Not done — needs server deployment + client refactor |
| **Real ads** | ❌ Needs AdSense approval and ID swap |
| **Real Premium billing** | ❌ Needs Stripe integration |
| **GitHub push** | ❌ Files exist locally; nothing on remote |
| **Domain + public URL** | ❌ Not purchased / configured |
| **Native iOS/Android apps** | ❌ Not started — Capacitor would wrap it |
| **Legal review** | ❌ Templates exist; attorney review pending |

---

## 3. Architecture

### 3.1 Client (current default — fully functional)
- **Single-page web app** loaded from a static host
- All data persists in browser `localStorage` (per-origin)
- No server contact except for CDN-loaded `chess.js` library
- Works offline (after first load) via service worker
- PWA installable

```
Browser
 ├── index.html        — UI structure (auth, lobby, game, academy, etc.)
 ├── app.js            — Auth, game engine, trophies, rankings, ads, premium
 ├── academy.js        — Lessons, themes, settings, rank progression
 ├── sounds.js         — Web Audio synthesizer
 ├── stockfish-ai.js   — Stub (disabled to keep MIT-clean)
 ├── sw.js             — Service worker (offline cache)
 ├── manifest.json     — PWA manifest
 └── icon.svg          — App icon
```

### 3.2 Server (built, not deployed)
- **Node.js + Express + Socket.IO + SQLite (better-sqlite3)**
- JWT-based auth (30-day tokens)
- REST API for signup, login, profile, rankings, friends, recent games
- WebSocket events for matchmaking, real-time moves, chat, game over
- Authoritative server-side move validation (chess.js)
- ELO recalculated server-side (K=32)

```
server/
 ├── server.js         — Express + Socket.IO bootstrap, routes
 ├── db.js             — SQLite schema, query helpers
 ├── auth.js           — JWT, bcrypt, signup/login, requireAuth middleware
 ├── game.js           — Matchmaking queue + game state + Socket.IO handlers
 ├── package.json      — Dependencies
 ├── .env.example      — Required env vars (PORT, JWT_SECRET, DATABASE_PATH)
 └── README.md         — Deployment instructions, API reference
```

### 3.3 Phase 2 architecture (when server is deployed)
Client REST/WS calls would replace localStorage auth. Detailed in `LAUNCH_GUIDE.md` Phase 2.

---

## 4. Complete file inventory

All files live under `C:\Users\RickD\Downloads\ChessTrophies\`.

| File | Purpose | Size | Last touched |
|---|---|---|---|
| `index.html` | Main app — all screens, modals, CSS | 42 KB | Current |
| `app.js` | Auth, game, AI, trophies, rankings, ads, premium | 96 KB | Current |
| `academy.js` | Lessons (115), themes, settings, rank progression | 59 KB | Current |
| `sounds.js` | Web Audio sound synthesis | 4 KB | Current |
| `stockfish-ai.js` | Disabled Stockfish bridge (stub to keep MIT) | 1 KB | Current |
| `sw.js` | Service worker for PWA offline support | 2 KB | Current |
| `manifest.json` | PWA install manifest | 1 KB | Current |
| `icon.svg` | App icon | 1 KB | Current |
| `privacy.html` | Privacy Policy (attorney-style template, 20 sections) | 35 KB | Current |
| `terms.html` | Terms of Service (attorney-style template, 22 sections) | 38 KB | Current |
| `LICENSE` | MIT License | 1.5 KB | Current |
| `LICENSES.md` | Third-party license audit | 7 KB | Current |
| `README.md` | Project intro + git push commands | 6 KB | Current |
| `STATE.md` | Quick state snapshot | 8 KB | Current |
| `LAUNCH_GUIDE.md` | 16-page deployment + monetization playbook | 16 KB | Current |
| `HANDOFF.md` | This document | — | Current |
| `server/server.js` | Express + Socket.IO bootstrap | 4 KB | Current |
| `server/db.js` | SQLite schema + helpers | 3 KB | Current |
| `server/auth.js` | JWT auth | 2 KB | Current |
| `server/game.js` | Matchmaking + games | 7 KB | Current |
| `server/package.json` | Server deps | 1 KB | Current |
| `server/.env.example` | Env template | 0.1 KB | Current |
| `server/README.md` | Deploy + API docs | 4 KB | Current |

**No binary assets** other than `icon.svg`. No audio files (everything synthesized at runtime). No bundled fonts (Inter loads from Google Fonts CDN). No bundled chess libraries (chess.js loads from cdnjs CDN — both client and server use it).

---

## 5. Key technical decisions and rationale

### 5.1 Why vanilla JavaScript (no React/Vue/Svelte)?
- File size: client total is ~200 KB uncompressed, ~60 KB gzipped. A React app with comparable features is 500 KB–2 MB.
- Loading: works instantly from any static host, no build step.
- Maintainability: any developer can edit any file with no framework knowledge.
- Trade-off accepted: state management is manual; will be worth migrating to a framework if the codebase grows >10× current size.

### 5.2 Why localStorage instead of a server by default?
- Lets the app go live as a single static deployment ($0/mo hosting).
- Lets a single developer build and ship without devops complexity.
- Trade-off: accounts don't roam across devices. Mitigation: `server/` scaffold ready for when this matters.

### 5.3 Why a custom minimax AI instead of Stockfish?
- **Stockfish is GPL v3** (copyleft). Bundling it likely requires the whole app to be GPL.
- The custom minimax uses public-domain piece-square tables (Michniewski) with MVV-LVA ordering, quiescence search, and iterative deepening — plays ~1500–1700 ELO depending on difficulty.
- Strong enough for casual play; keeps the entire project MIT-licensable.
- `stockfish-ai.js` is a stub with `ENABLE_STOCKFISH = false`. To re-enable, flip the flag and restore the worker bridge from git history (and accept the GPL implications).

### 5.4 Why synthesize sounds instead of bundling audio files?
- Zero IP risk (no recordings to license)
- Zero file weight
- Trade-off: less rich sound. Could swap to bundled samples later if needed.

### 5.5 Why SVG chess pieces drawn from scratch instead of the Cburnett set?
- The Cburnett set (used by lichess) is CC-BY-SA — attribution and share-alike required.
- Our pieces are original geometric designs in the spirit of Staunton (public-domain 1849 design).
- Zero attribution requirement, free for commercial use, no IP entanglement.

### 5.6 Why SQLite + better-sqlite3 on the server?
- One file, zero ops overhead, blazing fast (synchronous API is actually faster for most workloads than async Postgres for a single-server deployment).
- Trade-off: doesn't scale horizontally. Migration path: swap to Postgres when traffic exceeds ~5K concurrent users.

### 5.7 Why three difficulty levels for the AI but only one engine?
- Easy = mostly random with occasional captures (matches a true beginner).
- Medium = depth-3 iterative deepening, ~600 ms (matches ~1300 ELO opponent).
- Hard = depth-5 iterative deepening, ~2500 ms (matches ~1700 ELO opponent).
- Same engine code, different time budgets. Simpler than maintaining three engines.

---

## 6. Trophy and achievement system

### 6.1 Tiered families (each tier is harder)
- **Wins** (7 tiers): 1, 5, 10, 25, 50, 100, 250 wins
- **Streak** (7 tiers): 3, 5, 7, 10, 14, 21, 30 in a row
- **Rating** (8 tiers): 1300, 1400, 1500, 1600, 1700, 1800, 2000, 2200 ELO
- **Fast Win** (4 tiers): ≤30, ≤20, ≤15, ≤10 moves
- **Veteran** (4 tiers): 10, 50, 100, 250 games played
- **Mates** (4 tiers): 1, 5, 25, 100 checkmates delivered
- **Comeback** (3 tiers): 1, 5, 10 wins after being in check 3+ times
- **Community** (3 tiers): 1, 3, 10 friends invited who joined

### 6.2 Hidden trophies (10) — shown as `???` until earned
- Underpromotion win
- En passant captures × 3
- Queenside castle in 3 games
- Win with king + 1 piece (Bare Bones)
- Smothered mate against real opponent
- Win in a 50+ move game (Marathon)
- Win in ≤10 moves (Lightning)
- Win after 3 losses in a row (Phoenix)
- Promote 10 pawns total
- The Bongcloud (1.e4 2.Ke2 then win)

### 6.3 Embarrassing trophies (10) — red badge, designed to be funny
- Checkmated in ≤10 moves (Whoops)
- Lose 5 in a row to same opponent (Punching Bag)
- 7 days no win with 4+ game days (Dry Spell)
- Resign 5 in a row (Quitter)
- Checkmated 3 in a row (Mate Magnet)
- Lose 10 in a row (Flatline)
- Lose in ≤15 moves (Quick Out)
- Lose with only pawns left (Just Pawns)
- Below 25% win rate after 20 games (Doormat)
- 30 days no win (Cold Streak)

### 6.4 The hero feature: 7-Win Streak Trophy
Every seven consecutive ranked wins mints a permanent trophy that records the **usernames of the seven opponents you defeated**. Streaks continue past 7 — the next 7 wins earn the next trophy. Tapping a trophy in the trophy case shows the seven names, when each was beaten, and the trophy number.

---

## 7. Academy structure

- **Foundations** (8 lessons): piece moves, captures, castling, promotion, blocking
- **Mate in 1** (10 hand-crafted + 80 generated): pattern recognition
- **Tactics** (8 lessons): pins, forks, skewers, discovered attacks, deflection, double attack
- **Openings** (4 lessons): center control, knight development, Italian Game, castling early
- **Endgames** (5 lessons): pawn promotion, K+Q vs K, rook cut-off, stopping pawns, active king

**All 115 lessons verified by python-chess.** Every solution is a legal move that achieves the stated goal (mate-in-1 entries are real mate-in-1). Audit script: `audit_lessons.py` in the outputs working directory; re-run any time lessons are modified.

### Adding more lessons
- Format: `{ id: 'XX01', chapter: '...', title: '...', desc: '...', fen: '...', side: 'w'|'b', solution: [{from, to, promotion?}], hint: '...', difficulty: 1-5 }`
- Append to `LESSONS` array at the top of `academy.js`
- The roadmap auto-renders new entries grouped by chapter
- The framework supports thousands; cap is purely about authoring effort

---

## 8. Monetization model

### 8.1 Free tier
- Sees ad slots in lobby (banner) and game-over modal (medium rectangle)
- Ad slots are currently styled placeholders ready for AdSense/AdMob — see `renderAdSlot()` in `app.js`
- Premium upgrade card visible

### 8.2 Premium tier ($4.99/mo placeholder)
- Removes all ads (early return in `renderAdSlot()` when `user.isPremium === true`)
- Adds gold "⭐ PREMIUM" badge to username on lobby
- Future: deeper engine analysis depth, exclusive themes, priority matchmaking

### 8.3 Wiring real payments
- `setPremium(true)` is the current toggle (demo only)
- Replace with Stripe Checkout in production. Server route stubbed out in `LAUNCH_GUIDE.md` Phase 3.2
- On mobile (iOS/Android) Apple/Google require their billing — use **RevenueCat** to unify both stores. Detailed in `LAUNCH_GUIDE.md` Phase 4.4

### 8.4 Recruiter referral system
- Invite links include `?invitedBy=<userId>`
- On signup the new user records the inviter
- Inviter's `invitesAccepted` count increments → drives Community trophy tier
- Works locally now (same browser); cross-device requires server deployment

---

## 9. Legal status

### 9.1 Done
- ✅ `LICENSE` (MIT) at repo root
- ✅ `LICENSES.md` audit of all third-party code with license each
- ✅ `privacy.html` — 20-section attorney-style Privacy Policy template covering GDPR, CCPA/CPRA, all major US state laws (CO, CT, VA, UT, TX, OR, MT, TN, IA, DE, NH, NJ, FL, IN), LGPD, PIPEDA, UK GDPR, ePrivacy, COPPA, Global Privacy Control
- ✅ `terms.html` — 22-section attorney-style Terms with auto-renewal disclosure (California ARL, NY ARL), binding arbitration + class-action waiver + 30-day opt-out, DMCA designated-agent provisions, Apple App Store required clauses, EU 14-day withdrawal right

### 9.2 Required before public launch
- 🔴 **Attorney review** of both legal documents (templates ≠ legal advice)
- 🔴 **Fill all `[bracketed placeholders]`** in privacy.html and terms.html: legal entity name, registered address, support emails, governing law, arbitration venue, pricing, vendors, EU representative
- 🔴 **Register DMCA designated agent** with U.S. Copyright Office at dmca.copyright.gov ($6 every 3 years)
- 🔴 **Set up Consent Management Platform** for the "Do Not Sell or Share" link (Termly, CookieYes, OneTrust)
- 🔴 **Engage EU/UK representative** under GDPR Art. 27 if targeting EU/UK consumers (services like EDPO, Prighter cost ~$300-1000/yr)
- 🔴 **USPTO + EUIPO trademark search** for "ChessTrophies" before launch

### 9.3 Open IP risks
- Currently none. Stockfish (GPL) removed. All code, art, sounds, and lesson content are either original or under permissive licenses (MIT, OFL, public domain).

---

## 10. Deployment status and next steps

Currently: **nothing is deployed**. Files exist only locally.

### 10.1 Recommended deployment sequence (from `LAUNCH_GUIDE.md`)
1. **Buy domain** at Cloudflare Registrar (~$10/yr)
2. **Push to GitHub** (`RickDaug/ChessTrophies` repo already exists, may have an old README that needs resolving)
3. **Deploy static client to Vercel** (free; one-click GitHub integration)
4. **Generate finalized privacy/terms** (fill placeholders, get legal review)
5. **Soft-launch** to friends and r/chess for feedback
6. **Deploy server to Railway** (~$5/mo) when online play is needed
7. **Wire client to server** (~2-4 hours of editing `app.js` signup/login functions)
8. **Apply for Google AdSense** once traffic is consistent
9. **Set up Stripe** for real Premium billing
10. **(Optional, much later)** Wrap with Capacitor → iOS App Store ($99/yr) + Google Play ($25 one-time)

### 10.2 Estimated revenue trajectory (from `LAUNCH_GUIDE.md`, based on comparable indie chess apps)
- Month 1: ~$15 (mostly friends/early users)
- Month 3: ~$175
- Month 6: ~$700
- Month 12: ~$3,500
- Month 24: ~$17,500 if growth continues

---

## 11. How to run it locally

### Client only (no server)
1. Open `C:\Users\RickD\Downloads\ChessTrophies\index.html` in any modern browser
2. That's it. Sign up, play, learn.

Or serve over HTTP (recommended for testing PWA/service-worker features):
```bash
cd C:\Users\RickD\Downloads\ChessTrophies
npx http-server -p 8080
# then open http://localhost:8080
```

### Server (when ready)
```bash
cd C:\Users\RickD\Downloads\ChessTrophies\server
cp .env.example .env
# Edit .env to set a real JWT_SECRET
npm install
npm start
# listens on http://localhost:3000
```

### Run the lesson audit
```bash
pip install python-chess
python audit_lessons.py  # in the outputs/ working directory, or adapt path
# should report: 115/115 valid
```

---

## 12. Known issues and risks

1. **localStorage is per-origin.** Accounts created at `file://` won't appear at `https://yourdomain.com`. Soft-launch users may lose progress when you migrate to a real domain. Acceptable since there are no real users yet.
2. **chess.js CDN dependency.** If cdnjs is down, the app shows a graceful fallback error. Self-host chess.js from your own domain to eliminate this.
3. **No email verification on signup.** Anyone can sign up with `fake@email.com`. Worth adding before commercial launch.
4. **No password reset flow.** If a user forgets their password before the server is deployed, they're stuck. Top priority once real users exist.
5. **Trophy state is per-browser** until backend is wired. Clearing browser data wipes a player's progress. Document in launch FAQ.
6. **Mass arbitration risk.** The current arbitration clause is "aggressive" by 2024 standards — large numbers of consumer arbitration filings have become a tactical weapon in some sectors. Discuss with counsel before launch.
7. **Mobile-store revenue cuts.** Apple/Google take 15-30% of in-app purchases. Stripe takes 2.9% + $0.30. Web-Premium is therefore more profitable per dollar than mobile-Premium.

---

## 13. Glossary

- **ELO** — chess rating system. Standard K=32 calculation; both sides updated symmetrically.
- **FEN** — Forsyth-Edwards Notation. Compact text representation of a chess position.
- **PGN** — Portable Game Notation. Standard format for full game records.
- **MVV-LVA** — "Most Valuable Victim, Least Valuable Attacker." Move-ordering heuristic that searches captures first, biggest gain first.
- **PST** — Piece-Square Table. Per-piece bonus/penalty values for each square on the board, used in evaluation.
- **Quiescence search** — extended search through captures only, past the depth cutoff, to avoid the horizon effect.
- **PWA** — Progressive Web App. A web app installable to home screen, supports offline via service worker.
- **GPL v3 / MIT / OFL** — software license families. GPL is "copyleft" (derivatives must also be open source); MIT is "permissive" (use freely including commercially); OFL applies to fonts (free embedding).

---

## 14. Account / service inventory

Services that need to exist to take ChessTrophies live, in order of need:

| Service | Purpose | Cost | Status |
|---|---|---|---|
| Domain registrar (Cloudflare/Namecheap) | Domain | ~$10/yr | ⬜ Not bought |
| GitHub | Source control | Free | ⬜ Repo exists, not pushed |
| Vercel | Static hosting | Free | ⬜ Not deployed |
| Resend or Postmark | Transactional email | Free up to 3K/mo | ⬜ Not set up |
| Plausible or Cloudflare Web Analytics | Analytics | Free or $9/mo | ⬜ Not set up |
| Railway / Render | Server hosting | $5–20/mo | ⬜ Not deployed |
| Stripe | Payment processing | 2.9% + $0.30/tx | ⬜ Not set up |
| Google AdSense | Web ads | Free (~30% rev share) | ⬜ Requires traffic for approval |
| Sentry | Error tracking | Free tier | ⬜ Not set up |
| Termly or iubenda | CMP for cookie banner + auto-updated legal | $9–30/mo | ⬜ Optional but recommended |
| Apple Developer Program | iOS submissions | $99/yr | ⬜ Phase 2 |
| Google Play Console | Android submissions | $25 once | ⬜ Phase 2 |
| RevenueCat | Cross-platform IAP | Free under $10K MRR | ⬜ Phase 2 |
| EDPO or Prighter | EU/UK Article 27 representative | ~$300–1000/yr | ⬜ Only if targeting EU/UK consumers |

---

## 15. Who to contact / continuity

This project was developed by Rick Daugherty in collaboration with Claude (Anthropic) in late 2025/early 2026 via the Cowork interface. There is no other developer on the project.

**If you are picking this up:**
- Start by reading this document end-to-end.
- Then read `STATE.md` for a more focused "what's next."
- Then read `LAUNCH_GUIDE.md` for the deployment playbook.
- The actual code is well-commented where non-obvious; start with `app.js` to understand the data model and state shape.
- The user object schema is the canonical data spec — find `newUser()` in `app.js` for the authoritative list of fields.

**If you are returning to the project after time away:**
- `STATE.md` will tell you where you left off.
- `LAUNCH_GUIDE.md` will tell you the next concrete step.
- `LICENSES.md` will tell you what you can and can't do with third-party code.
- This document tells you why every decision is what it is.

**Resuming with Claude:** open a new conversation and say "Read HANDOFF.md and STATE.md in my ChessTrophies folder, then let's continue with X" where X is the next phase you want to tackle.

---

## 16. Quick command reference

```bash
# Open the app locally (any browser)
start C:\Users\RickD\Downloads\ChessTrophies\index.html

# Serve over local HTTP (better for PWA testing)
cd C:\Users\RickD\Downloads\ChessTrophies
npx http-server -p 8080

# First push to GitHub
cd C:\Users\RickD\Downloads\ChessTrophies
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/RickDaug/ChessTrophies.git
git push -u origin main --force   # only if remote has old commits you want to overwrite

# Run the server locally
cd C:\Users\RickD\Downloads\ChessTrophies\server
cp .env.example .env
# edit .env
npm install
npm start

# Re-audit all 115 lessons (requires python-chess)
pip install python-chess
python audit_lessons.py
```

---

**End of handoff document.**

If you have questions that this document doesn't answer, the source of truth is the code itself. Every architectural choice has a reason, and every reason is documented either inline or in one of the markdown files. Good luck.
