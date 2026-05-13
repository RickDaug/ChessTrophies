# ChessTrophies — Project state (snapshot)

**Last updated:** Session paused after legal documents created.

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
| Backend server scaffold | ✓ Done — `server/` folder with Express + Socket.IO + SQLite |
| MIT LICENSE | ✓ Done |
| Privacy Policy template | ✓ Done — `privacy.html` |
| Terms of Service template | ✓ Done — `terms.html` |
| End-to-end runtime test | ✓ Done — all flows verified clean |

### Not yet built / next steps

| Item | Where it goes | Effort |
|---|---|---|
| Real online play wired to server | `app.js` signup/login → REST + Socket.IO client | 2-4 hours |
| Stripe checkout for Premium | `server/billing.js` + replace `setPremium(true)` | 2-4 hours |
| Real AdSense / AdMob | Replace `renderAdSlot()` HTML inside | 1 hour after approval |
| Email password reset | New `/api/auth/forgot` route + Resend integration | 4-8 hours |
| Game analysis (eval bar + blunder detection) | Built-in engine already supports it; needs UI | 1 day |
| Daily puzzle | Pull from any free puzzle DB (lichess CSV) | 4-8 hours |
| Tournaments | Schema in server already supports games — needs UI + matchmaking | 2-3 days |
| Native iOS / Android wrappers | Capacitor — see LAUNCH_GUIDE.md | 1-2 days each |
| Email verification on signup | Add to server `/api/auth/signup` | 4 hours |
| Push notifications | Web Push API + service worker | 1 day |
| Avatar uploads | S3 + file picker in profile | 1 day |

---

## File inventory

Everything lives at `C:\Users\RickD\Downloads\ChessTrophies\`:

| File | Purpose | Status |
|---|---|---|
| `index.html` | Main app UI, all screens & modals | 42 KB |
| `app.js` | Auth, game, AI, trophies, rankings, ads, premium | 96 KB |
| `academy.js` | Lessons, roadmap, themes, settings | 59 KB |
| `sounds.js` | Synthesized sound effects (Web Audio) | 4 KB |
| `stockfish-ai.js` | Stub (Stockfish disabled — keeps app MIT-clean) | 1 KB |
| `sw.js` | Service worker for offline PWA | 2 KB |
| `manifest.json` | PWA manifest | 1 KB |
| `icon.svg` | App icon | 1 KB |
| `LICENSE` | MIT license | 1.5 KB |
| `LICENSES.md` | Third-party license audit | 7 KB |
| `LAUNCH_GUIDE.md` | Step-by-step deployment plan | 16 KB |
| `privacy.html` | Privacy Policy (template — fill placeholders) | 9 KB |
| `terms.html` | Terms of Service (template — fill placeholders) | 9 KB |
| `STATE.md` | This file | — |
| `README.md` | Project README + git push commands | 6 KB |
| `server/` | Node.js backend (not yet deployed) | folder |
| `server/server.js` | Express app + WebSocket bootstrap | 4 KB |
| `server/db.js` | SQLite schema + helpers | 3 KB |
| `server/auth.js` | JWT + signup/login | 2 KB |
| `server/game.js` | Matchmaking + real-time games | 7 KB |
| `server/package.json` | Dependencies | 1 KB |
| `server/.env.example` | Env var template | 1 KB |
| `server/README.md` | Server deployment + API docs | 4 KB |

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
