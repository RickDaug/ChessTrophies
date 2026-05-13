# ChessTrophies

A modern, mobile-friendly chess platform with player profiles, skill-based matchmaking, a chess AI for practice, ELO rankings, and a trophy system that records the names of every opponent you defeat during a winning streak.

## Features (Phase 1 — built)

- **Email + password accounts** with per-user profiles (username, region, ELO, stats).
- **Player vs Player** pass-and-play on the same device. Both players sign in so wins, losses, ELO and trophies count for both accounts.
- **Skill-based matchmaking** — *Find ranked opponent* picks a local user within ±100 ELO (widens automatically if no one is in range).
- **Private rooms with join codes** — generate a 6-character code, share it with your opponent. They enter it under *Join room* to drop straight into the match. Rooms can be friendly or ranked.
- **Friends list** — add other players by username, see their ELO and W/L on your home screen, challenge them with one tap.
- **Friendly challenges** — when you challenge a friend (or use a friendly room), the game is just for fun: no ELO change, no W/L recorded, no streak impact.
- **Practice vs Computer** with three difficulty levels (Easy / Medium / Hard). Practice games do not change ELO.
- **Modern flat SVG chess pieces** — designed for clarity at mobile sizes, no old-school glyphs.
- **ELO rating** updates after every ranked game.
- **7-Win Streak Trophies** — every time you win 7 ranked games in a row, a trophy is minted that records the usernames of the 7 opponents you defeated. Streaks continue past 7; the next 7 wins earn another trophy.
- **Achievements** — first win, on fire (3-streak), seven saints (7-streak), double crown (14-streak), mate maker, lightning (sub-30-move win), comeback kid, ELO milestones at 1400 / 1600 / 1800, veteran (10 games), grand hall (50 games).
- **Rankings** with Local (your city) / Regional (your country) / Global tabs based on the region you set on signup.
- **Chess Academy** with 35 hand-crafted lessons across Foundations / Mate in 1 / Tactics / Openings / Endgames. Each lesson is a hands-on puzzle you must solve by making the correct move on the board to advance. Hint and Solution buttons are available.
- **Avatar rank progression** based on lessons completed: Novice (Pawn) → Apprentice (Knight) → Adept (Bishop) → Expert (Rook) → Master (Queen) → Grandmaster (King). Your current piece icon appears on the academy roadmap, marking your position.
- **Board and piece themes** — 8 board palettes (Forest, Ocean, Wood, Rose, Midnight, Coral, Mint, Slate) and 5 piece sets (Classic, Bold, Royal, Sunset, Ice). Pick yours from Settings; it's saved to your profile.

## Files

```
index.html   — UI structure, styling, screens
app.js       — auth, chess game, AI, trophies, rankings logic
academy.js   — chess academy lessons, roadmap, theme switcher
README.md    — this file
```

## Phase 2 (needs a backend — not in this build)

- Real online play across devices and IPs (WebSockets + server)
- Accounts that persist across browsers and devices
- Cross-device global leaderboards
- Email verification, password reset
- Anti-cheat / move-time tracking

## Running it

It's a static site — no build step.

**Locally:** just open `index.html` in any modern browser.

**GitHub Pages:** push these files to the repo, then in the repo's *Settings → Pages*, set *Source* to your default branch and `/` (root). Within a minute or two it'll be live at `https://<username>.github.io/ChessTrophies/`.

## Files

```
index.html   — UI structure and styling
app.js       — auth, chess, AI, trophies, rankings logic
README.md    — this file
```

The app loads `chess.js` from a CDN for move validation, check / checkmate detection, and history tracking.

## Pushing to your repo

From the folder that holds these three files:

```bash
git init
git add index.html app.js README.md
git commit -m "Initial ChessTrophies MVP"
git branch -M main
git remote add origin https://github.com/RickDaug/ChessTrophies.git
git push -u origin main
```

If the remote already has commits (e.g. an auto-generated README), you'll need to either pull and merge first or force-push:

```bash
# Option A: keep what's there and add these on top
git pull origin main --allow-unrelated-histories
git push -u origin main

# Option B: overwrite the remote (only if you're OK losing what's there)
git push -u origin main --force
```

## How a game works

1. Sign in / create your account.
2. From the lobby pick:
   - **Find ranked opponent** → matchmaking from local accounts within ±100 ELO.
   - **Start a challenge** → invite a specific friend to sign in on this device.
   - **Easy / Medium / Hard** → practice vs the built-in AI.
3. The app picks who plays White randomly.
4. Tap a piece to select, then tap a highlighted square to move. Pawn promotion shows a chooser.
5. After checkmate / resignation / draw, ELO updates, achievements unlock, and a streak-trophy is awarded if you just hit 7 wins in a row.

## Tweaking the look

- Color theme: edit the `:root` CSS variables at the top of `index.html`.
- Chess piece designs: replace the `PIECE_PATHS` object in `app.js` — each piece is one SVG path in a `viewBox="0 0 45 45"`.
- Light / dark board squares: `--light-sq` and `--dark-sq`.

## Known limits of the MVP

- All data lives in your browser's `localStorage`. Clearing site data deletes accounts. Different browsers / devices won't share data until Phase 2 backend.
- "Find Match" can only match users who have signed up on this same browser.
- The AI uses depth-2 / depth-3 minimax — fine for a friendly opponent, not a grandmaster.
