# ChessTrophies — third-party licenses & IP audit

**TL;DR — as shipped, ChessTrophies is MIT-licensable. No GPL or proprietary code is bundled. See `LICENSE`.**

This file is the canonical record of every asset, dependency, and external service the app uses, with its license and any compliance notes.

## Original work

All of the following are written by the project author for ChessTrophies and are not derived from any copyrighted source:

- All HTML / CSS / client JavaScript (`index.html`, `app.js`, `academy.js`, `sounds.js`, `stockfish-ai.js`, `sw.js`)
- All server code under `server/`
- The chess piece SVGs in `pieceSVG()` — original geometric designs in the general spirit of the Staunton style (Staunton himself standardised the chess piece form in 1849, in the public domain). They are not traced or copied from any specific copyrighted set such as Cburnett, Merida, Alpha, or chess.com's piece sets
- The `icon.svg` logo — original
- All 35 hand-written lessons (positions and prose) plus the 80 programmatically generated mate-in-1 / fork / pin puzzles
- All 60 trophy definitions
- All concept teaching text

No assets are copied from chess.com, lichess.org, ChessBase, or any other chess platform.

## Bundled third-party code (loaded from CDN, not redistributed in this repo)

| Library | Version | License | Compliance status |
|---|---|---|---|
| **chess.js** | 0.10.3 | **MIT** | OK — permissive, commercial use fine |
| **chess.js** (server) | 1.0.0-beta.6 | **MIT** | OK |
| ~~Stockfish.js~~ | — | (was GPL v3) | **Removed from default build.** `stockfish-ai.js` is now a stub. The built-in minimax in `app.js` replaces it. See "Removed dependencies" below. |
| **Inter font** | latest | **SIL Open Font License 1.1** | OK — commercial use, redistribution, embedding all allowed |
| **Google Fonts** (delivery) | — | Free service | OK — no attribution required |
| **socket.io-client** | (Phase 2 CDN) | **MIT** | OK |

## Server npm packages

All MIT or similarly permissive:

| Package | License |
|---|---|
| express | MIT |
| cors | MIT |
| socket.io | MIT |
| better-sqlite3 | MIT |
| bcryptjs | MIT |
| jsonwebtoken | MIT |
| chess.js | MIT |
| dotenv | BSD-2-Clause |

## Removed dependencies

**Stockfish.js (GPL v3)** has been removed from the default build to keep the app under the permissive MIT license.

In its place, `app.js` includes a built-in minimax engine with:
- Full piece-square tables for all 6 piece types (Tomasz Michniewski's *Simplified Evaluation Function*, public domain)
- MVV-LVA (Most-Valuable-Victim, Least-Valuable-Attacker) move ordering
- Quiescence search to avoid horizon-effect blunders
- Iterative deepening with per-difficulty time budgets (600 ms for medium, 2500 ms for hard)

That engine plays around 1500-1700 ELO depending on difficulty — strong enough for casual play and not subject to any copyleft restriction.

If you want to re-enable Stockfish later, set `ENABLE_STOCKFISH = true` in `stockfish-ai.js` and restore the worker bridge from git history — but first decide on your license strategy:

## ⚠ The Stockfish license question (informational)

**Stockfish is licensed under GNU GPL v3.** This is a copyleft license. The Free Software Foundation's standard interpretation is that **distributing software that links to GPL code requires the linking software to also be released under the GPL**.

In ChessTrophies, Stockfish is loaded as a separate Web Worker via CDN — it never runs in the same JavaScript context as your app code. There are two schools of thought on whether this triggers the GPL:

1. **Strict interpretation (FSF)**: Even dynamic-linking-style usage where you call into a GPL library means your code must be GPL.
2. **Pragmatic interpretation (some lawyers)**: A web worker loaded from a third-party CDN is closer to "calling an external program" than "linking" — the same way a browser running a GPL extension doesn't make every visited site GPL.

**lichess.org** ships under GPL v3 and uses Stockfish.
**chess.com** uses a proprietary engine they wrote themselves.

### Your three safe options

**Option A — Release ChessTrophies under GPL v3.**
The cleanest path. Add a `LICENSE` file with the GPL v3 text and a `LICENSE-NOTICE` line in each source file. You can still monetise (Premium, ads, in-app purchases) — GPL doesn't forbid commercial use, only restricts how others can use your source.

**Option B — Drop Stockfish, use a permissively-licensed engine.**
Replace with one of:
- `chess-ai` (npm) — MIT
- A simple minimax in pure JS (the current fallback at depth 2/3 is yours and is permissive)
- Roll your own NNUE-style engine
This keeps your app proprietary. You lose engine strength but gain freedom.

**Option C — Host Stockfish as a separate service.**
Run Stockfish on your own server as an API endpoint. Your client never links to GPL code — it just talks to a service. The service itself can be GPL or whatever it needs to be. This is arguably the cleanest separation. Trade-off: requires server resources and latency.

I recommend **Option A** unless you have a specific business reason to keep the app proprietary. Most chess software in the open-source world chooses GPL exactly because of Stockfish.

## Chess terminology and named patterns

All chess terms used in lessons and trophies — Italian Game, Sicilian Defense, Anastasia's Mate, Boden's Mate, Bongcloud, Smothered Mate, etc. — are common chess terminology in the public domain. They have been in use for over a century in some cases. None are trademarked.

The "Bongcloud" name (1.e4 ... 2.Ke2) originated as a community meme around 2010. It is not trademarked. Major chess platforms use the name freely.

## Emojis

All emojis used (🏆, ⭐, 🐴, 😬, etc.) are part of the Unicode standard. The Unicode code points themselves are free to use. Each user's device renders them with whatever emoji font that platform ships (Apple Color Emoji on iOS/macOS, Google Noto Color Emoji on Android, Microsoft's Segoe UI Emoji on Windows, etc.). You aren't redistributing any of those font files — they're already on the user's device.

## Sound effects

**All sounds are synthesized at runtime via the Web Audio API** (oscillators + white-noise generators). No sample files are bundled or distributed. There is no audio file in this repo and nothing to be infringed.

## Images / icons

`icon.svg` is the only bundled image, and it was hand-written for this project. The trophy/star/CT design is original.

## Fonts

Inter is loaded from Google Fonts at runtime. The font is released under the SIL Open Font License 1.1, which permits commercial use, embedding, and modification. Loading it via Google Fonts requires no attribution.

## Trademark / brand check

The name "ChessTrophies" — before l