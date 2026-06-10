# ChessTrophies — Launch copy

Ready-to-post launch and marketing copy for ChessTrophies (https://www.playchesstrophies.com). Everything here is copy-paste ready and grounded in features that actually exist as of 2026-06-09. Nothing is paywalled in the product except cosmetic themes + ad removal.

## Files

| File | What it's for |
|---|---|
| [`product-hunt.md`](product-hunt.md) | Product Hunt launch — tagline, maker "first comment," description, feature bullets, topics, and a screenshot shot-list. |
| [`show-hn.md`](show-hn.md) | Show HN post — title options + a technical, candid body (stack, the interesting problems, an honest ask). |
| [`reddit-r-chess.md`](reddit-r-chess.md) | r/chess post — title + body framed as "a free thing I made, please critique it," with a rules-check note. |
| [`reddit-r-webgames.md`](reddit-r-webgames.md) | r/WebGames-style post — shorter "play it free in your browser" framing. |
| [`twitter-thread.md`](twitter-thread.md) | A 7-tweet launch thread + 3 standalone single-tweet alternatives. |
| [`press-kit.md`](press-kit.md) | One-page press kit — one-liner, 50/100-word blurbs, feature list, founder-note placeholder, links, asset checklist, contact. |

---

## How to actually launch (an honest checklist)

The hard constraint isn't the copy — it's traffic. The goal of launch day is to get a *few real humans* playing so you can watch the funnel and iterate. Don't spread thin; do one channel well, then the next.

### Before you post anything
- [ ] Confirm the site is healthy: load https://www.playchesstrophies.com fresh (incognito), play a guest game start-to-finish, and confirm ranked actually starts a game (the bot-backfill should kick in).
- [ ] Confirm the **challenge-a-friend link** works end-to-end: beat the computer → create the link → open it in a separate incognito window → you land straight in the game as a guest. This link is your best growth asset; it must work.
- [ ] Capture the screenshots from the press-kit / Product Hunt shot-list.
- [ ] Have the **admin analytics dashboard** open (`/admin.html`, key-gated) so you can watch the funnel live during the launch.

### Suggested order + timing
1. **Show HN first (a weekday morning, US Eastern).** HN sends technical, high-signal feedback and tolerates rough edges. Post `show-hn.md`, then sit in the thread and reply to everything for the next few hours. Don't ask for upvotes.
2. **Product Hunt (launch at 12:01am Pacific on the day you choose).** Post the listing, then immediately add the maker "first comment" from `product-hunt.md`. Reply to every comment all day.
3. **X/Twitter thread (same morning as PH).** Post the thread from `twitter-thread.md` and pin it. Reply to your own thread with the live link again later in the day.
4. **r/chess (only after reading its rules + messaging mods).** This is the highest-risk, highest-reward channel — r/chess punishes self-promo. Lead with genuine feedback-seeking, follow the 9:1 rule, and never get defensive. See the warning at the top of `reddit-r-chess.md`.
5. **r/WebGames and similar** — lower stakes, "play it free" framing from `reddit-r-webgames.md`. Good for a steady trickle.

Space these out if you can (e.g. Show HN + PH + X on day 1; Reddit a day or two later once you've fixed anything obvious). Reddit especially does not reward same-day cross-posting blasts.

### The #1 rule: don't spam
- One honest post per community. If it doesn't land, engage in the comments — don't repost or sock-puppet.
- Be a participant in each community *before* you promote (especially Reddit). Drive-by promo gets removed and remembered.
- Reply to every single comment and DM. Early feedback from real players is worth more than reach.
- Never buy/beg upvotes; both PH and HN penalize it and it poisons the data.

### How to measure it (use what's already built)
- **Analytics dashboard (`/admin.html`):** watch the distinct-visitor **conversion funnel** [land → play → finish → saw-signup → signup] and the per-stage drop-off. The biggest drop-off is your next thing to fix.
- **Today KPI row:** visitors / games / signups / returning %. Compare each channel's day.
- **Challenge links as attribution:** every challenge link carries a referral credit and tallies plays/beats ("N tried, M beat it"). The challenge funnel fires `challenge_create / view / accept / complete` events — use those to see whether shared links are actually turning one player into two.
- After ~a few days of real traffic, the funnel tells you whether the problem is acquisition (nobody lands), activation (they land but don't play), or retention (they play once and leave) — and you iterate on that specific stage rather than guessing.

### Tone reminders (baked into the copy, keep them when you edit)
- Honest about being solo + pre-traction. No fake user-base claims, no "revolutionary."
- The bot-backfill is disclosed, not hidden (opponents show "Computer 🤖 (ELO N)"). Keep it that way in copy — it builds trust.
- Lead with what's genuinely different (streak trophies / Most Feared wall / always-a-game), not a generic feature dump.

---

## Platform rules cheat-sheet (pulled live 2026-06-09)

### 🥇 The golden rule (HN + Product Hunt + Reddit all enforce it)
**Never ask for upvotes.** Buying votes / vote rings / "please upvote" get you penalized or flagged as spam on every platform. Ask people to **visit, play, and give feedback** — never to vote. Your X/email/Discord copy should say *"I'm live, would love your feedback,"* not *"upvote me."*

### Show HN (Hacker News) — `news.ycombinator.com/showhn.html`
- ✅ You qualify: it's a runnable thing you built personally, and **"easy to try out without barriers such as signups or emails"** — your no-signup guest play is exactly what HN wants.
- Title **must** begin `Show HN:`.
- ❌ Not allowed: blog posts, sign-up/landing pages, "reading material," or version updates unless a *major* overhaul.
- **"Don't ask friends to upvote or comment. That's not ok on HN."**
- Be around to discuss — post when you can sit in the thread for a few hours; reply constructively, not defensively.
- Best: weekday morning, US Eastern.

### Product Hunt — `producthunt.com/launch`
- **"You cannot ask people directly to upvote your product. Instead, ask them to visit and comment."**
- **Personal accounts only** (company accounts prohibited). **Hunt your own product** — no third-party-hunter advantage anymore.
- Launch clock resets at **12:01 am Pacific**; post then for max leaderboard time. But "the best day is the day you're most prepared."
- ⚠️ **Make your PH account NOW** even if launching later — new zero-activity accounts get flagged + reduced visibility; an aged, slightly-active account does better.
- You can re-launch on significant new iterations, so it's not a one-shot.

### r/chess (Reddit) — ⚠️ rules NOT auto-retrievable (Reddit blocks crawlers)
- **Read the live rules yourself** at `reddit.com/r/chess` (sidebar → Rules) — they change.
- r/chess restricts self-promo hard. The safe path: **message the mods first** and follow whatever they say (promo is sometimes limited to a specific day/megathread).
- Honor the 9:1 / 10% rule — don't let this be your first/only activity; comment genuinely elsewhere first.
- Lead with *feedback-seeking*; drop the link in a comment (or only if mods approve). Reply to everything; never get defensive.
- **Mod-message template** (paste into "Message the mods" before posting):
  > **Subject:** Permission to share a free chess project for feedback?
  > Hi mods — I'm a solo dev (and mediocre club player) who built a free, no-signup browser chess + checkers site as a side project. I'd love honest feedback from r/chess, but I want to respect your self-promotion rules. Is a "free thing I made, please critique it" post allowed, and if so, is there a preferred day/flair or megathread I should use? Happy to follow whatever you prefer. Thanks!

### Sources
- Show HN: https://news.ycombinator.com/showhn.html (pulled verbatim)
- Product Hunt: https://www.producthunt.com/launch + https://www.producthunt.com/launch/preparing-for-launch (the 30-day-account tip is consistent across 2026 guides, not an official rule)
- r/chess: not retrievable (Reddit blocks automated access) — verify live.
