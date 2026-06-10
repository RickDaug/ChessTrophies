# Show HN post

**URL to submit:** https://www.playchesstrophies.com

---

## Title

Use one of these (HN title norm: `Show HN: <name> – <plain description>`, no hype, en-dash):

- `Show HN: ChessTrophies – Free browser chess/checkers with a server-authoritative engine`
- `Show HN: ChessTrophies – Free online chess and checkers, no signup, vanilla JS + SQLite`
- `Show HN: ChessTrophies – Browser chess where win streaks mint trophies naming who you beat`

**Recommended:** the second one — it's the most concrete and signals the stack, which HN responds to.

---

## Body (the text field — paste as-is)

I'm a solo developer and this is a free chess + checkers platform I've been building. It runs entirely in the browser (no download, installable as a PWA) and you can start playing as a guest with no signup.

The stack is deliberately boring: a vanilla-JS client (no framework, no build-time SPA — just modules concatenated and minified with esbuild, served static from Vercel) talking to a Node/Express + Socket.IO backend on Railway, with SQLite for persistence (a Postgres path is written but not yet cut over). The move loop is server-authoritative — the server validates every move with chess.js and is the source of truth for clocks, results, and ELO — so the client can't forge a game outcome. CSP is hardened to drop `unsafe-inline` from script-src (all inline handlers are delegated via addEventListener), which was more work than I expected for an app that generates a lot of HTML.

A couple of things that were interesting to build:

- **Cold-start matchmaking.** A new site has nobody in the ranked queue, which kills the whole competitive loop. So if no human shows up within ~16s, the server backfills a bot that runs the same engine head-less and plays at your exact current rating (expected score 0.5, so it's ELO-neutral and not farmable — the client can't pick the bot's strength). You always get a fair game; the ladder never stalls. The annoying gotcha here was that the bot engine is a UMD file `require()`d into an ESM package scope, and Node 24's ESM loader silently dropped the named export — worked in dev, failed only in the Docker image. Diagnosed via a `/health?diag=1` endpoint that reports per-file load state.

- **A growth mechanic that's also a game feature.** Beat the computer and you can generate a link that drops a friend straight into the *same* difficulty as a guest — no signup — and shows live "N tried, M beat it" social proof, then loops them into challenging someone back. It's the one piece of product work aimed squarely at the real constraint (no traffic) rather than more features.

- **The retention loop.** A 7-win ranked streak mints a trophy that records the usernames of the opponents you beat; those players see you on their "Most Feared" wall with a one-tap revenge rematch (delivered in-app + via Web Push). Plus live Arena tournaments, a monthly Seasons ladder, and adaptive puzzles with a per-user puzzle rating.

It's entirely solo, pre-traction, and I'm sure there are rough edges. I'd really value feedback on: the matchmaking feel (especially whether the bot-backfill is obvious/honest enough — opponents are labeled "Computer 🤖 (ELO N)"), the checkers rules implementation (8×8 ACF with black-moving-first, which I got wrong at first, plus 10×10 international), and anything that feels off in the engine's play strength. Happy to answer questions about any of the architecture.
