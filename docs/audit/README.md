# ChessTrophies — Security & Quality White-Paper Audit

**Date:** 2026-07-22
**Method:** 3-tier adversarial audit — 15 persona auditors (3 each across Security, Back-end/Data, Front-end/UX, Functionality/Correctness, Performance/SEO) + 1 live-site recon → 5 squad managers (adversarial verify/dedup/cull) → 1 chief synthesis. Plus an **authenticated live probe** of the production Railway API (throwaway accounts, cleaned up).
**Scope:** white-box source review of the local repo + live observable surface (`www.playchesstrophies.com`, Railway API `/health`) + authenticated endpoint probing.
**Effort:** 22 agents, ~2.08M tokens.

---

## Verdict: **77 / 100 — CONDITIONAL SHIP**

> Sound auth core and live surface, but hold *broad* launch until the Stripe-cancel billing bug, the privacy-policy subprocessor disclosures, and the admin-key-in-URL leak are fixed.

**No S0 found** — no auth bypass, no RCE, no cross-account data exposure, no data-corruption defect. This is a well-built product with a specific, addressable set of pre-launch defects.

### Severity counts
| S0 | S1 | S2 | S3 |
|----|----|----|----|
| 0  | 3  | 17 | 28 |

### Domain scorecard
| Domain | Score |
|--------|:-----:|
| Back-end & Data | 80 |
| Performance & SEO | 80 |
| Functionality & Correctness | 76 |
| Front-end & UX | 74 |
| Security & Auth | 70 |
| *(Live recon surface)* | *85* |
| **Overall** | **77** |

For comparison, the VallaPOS audit (same methodology) landed at 78/100 as-found.

---

## Executive summary

ChessTrophies is a fundamentally sound solo-dev, early-launch web platform. The verification passes across all five squads found **no S0**: no auth bypass, no RCE, no cross-account data exposure, and no data-corruption defect. The auth core is genuinely strong — JWT with `token_version` revocation, bcrypt cost 12, enumeration-hardened login/forgot with dummy-hash compares, trust-proxy-keyed rate limiting, and parameterized SQL with escaped LIKE wildcards. The live public surface reinforces this: a hardened CSP, HSTS, correct CORS reflection on the Railway API, complete SEO plumbing (87-URL sitemap, canonical/OG/JSON-LD), and a healthy durable + Litestream node. Core game logic (endgame mate conversion, FIDE-6.9 flag-fall, the progress-sync HTTP round-trip) carries real backend tests. This is not a broken product; it is a well-built one.

The score of 77 reflects **three fix-before-broad-launch items**. First, account deletion wipes the Stripe customer mapping but never cancels the subscription — a premium user who deletes their account keeps getting charged with no in-app record to cancel against, directly contradicting the 30-day-deletion promise in the privacy policy. Second, that same privacy policy names the wrong subprocessors (Vercel-DB, cPanel, Vercel Analytics) while PII actually lives on Railway, transits Resend, and replicates to Cloudflare R2 — both over- and under-inclusive, breaking the DPA/SCC chain. Third, the live admin dashboard transmits `ADMIN_KEY` as a URL query parameter, landing a PII-access credential in access logs and browser history.

Below these sits a coherent, cheap-to-fix cluster: an accessibility-completeness gap the green a11y gate masks (checkers unplayable by keyboard/SR, non-focusable tab controls that block keyboard signup, no aria-live regions, mirrored RTL board), a **client-authoritative trophy leaderboard** (live-confirmed — see below), backend hardening nits (no email fetch timeout, a double-respawn worker bug, a liveness-only `/health`), a genuine cross-device data-loss bug (Opening Trainer + Gauntlet progress never syncs), and first-load/SEO wins (no route splitting, no `Cache-Control`, a FAQPage schema with no visible FAQ). Nothing here is a launch blocker in the exploitable sense; the three S1s are billing/legal/credential-hygiene.

---

## Top findings (S1, chief-ranked)

### 1. Account deletion clears the Stripe mapping but never cancels the subscription — S1 (Security / Billing)
- **Evidence:** `auth.js:256-262` `deleteAccount()` calls only `store.deleteAccountData()`; `db.js:489-495` blanks `stripe_customer_id`/`subscription_status` via UPDATE with **no Stripe API call**; cancellation exists only via the user-driven Billing Portal (`billing.js:170-187`), never invoked on delete. Email is also tombstoned to `deleted+<id>@deleted.invalid` (`db.js:479,495`), so `reconcilePremiumForUser`'s email fallback (`billing.js:103-108`) can no longer match. **CONFIRMED.**
- **Impact:** A premium user who deletes their account keeps being charged with no in-app record to cancel against, and Stripe retains their customer object indefinitely. Direct financial harm + a factual contradiction of `privacy.html:192` ("we delete Personal Information within 30 days").
- **Fix:** In `deleteAccount`, before blanking `stripe_customer_id`, best-effort list active subscriptions and `stripe.subscriptions.cancel` (optionally `stripe.customers.del`). Guard so a Stripe outage does not block local deletion; log failures for retry.

### 2. Admin dashboard transmits ADMIN_KEY as a URL query parameter on the live site — S1 (Security, live-confirmed)
- **Evidence:** `GET https://www.playchesstrophies.com/admin.html` serves JS that builds `fetch('/api/admin/...?key='+encodeURIComponent(getKey()))`. Gating works (unauth `GET /api/admin/stats` → 403, **live-verified**) but the key travels in the URL. `admin.html` already builds a `headers()` object it could route the key through.
- **Impact:** The high-value `ADMIN_KEY` lands in Railway/edge access logs, proxy/CDN logs, and browser history. A single leaked log line grants full admin-dashboard read access — user enumeration, emails, geo, stats. Credentials-in-URL is an OWASP-flagged anti-pattern.
- **Fix:** Send the key in an `Authorization`/`X-Admin-Key` request header (route through the existing `headers()` builder) and drop all `?key=` usage. Confirm server access logging does not record full query strings in the interim.

### 3. Privacy policy names the wrong subprocessors and omits the real ones — S1 (Legal / Compliance)
- **Evidence:** `privacy.html:159` discloses hosting/DB as "Vercel" but the API + SQLite run on **Railway** (Vercel only serves the static client); `privacy.html:161` says email is "cPanel" but `email.js:8,18-27` sends via **Resend**; `privacy.html:162` lists "Vercel Web Analytics" but there is no Vercel analytics script (only first-party `ct-analytics.js`). `litestream.yml` replicates the full SQLite DB (emails, pw_hash, geo) to **Cloudflare R2** — an undisclosed backup/international-transfer subprocessor. **CONFIRMED.**
- **Impact:** GDPR Art.13(1)(e)/Art.28 and CCPA/CPRA require accurate recipient/subprocessor disclosure. The stated list is both over- and under-inclusive, undermining any DPA/SCC chain.
- **Fix:** Rewrite privacy §5.1 to: Railway (hosting + SQLite), Resend (transactional email), Cloudflare R2 (encrypted Litestream backups), Stripe (payments), and LibreTranslate if/when enabled. Remove the Vercel-DB, cPanel, and Vercel-Analytics claims. Ensure signed DPAs.

---

## Authenticated live-probe results (production Railway API)

Two throwaway accounts were created against the live API, probed, then reset + deleted (verified gone). All owner-authorized.

| Probe | Result |
|-------|--------|
| **IDOR** — A reads B's `/api/users/:id/profile` | ✅ **Safe** — no `email`/`pw_hash`/`stripe_customer_id`/`token`; only leaderboard-equivalent public fields |
| **Admin gating** — `/api/admin/stats` no-key / wrong-key | ✅ **403 / 403** (correctly gated) |
| **Trophy leaderboard integrity** — fresh account POSTs `trophyPoints:99999999` | 🔴 **CONFIRMED LIVE** — instantly topped the *public* global trophy ladder; profile showed fabricated `trophyPoints`. Any signed-in user can rig the ranking. (S2, but trivially exploitable in prod.) |
| **Cross-account write** — A POSTs `/api/progress` with `userId=B.id` in body | ✅ **Safe** — B unchanged; server scopes writes to `req.userId` |
| **Enumeration oracle** — re-signup existing email | 🟠 **CONFIRMED LIVE** — distinct `"An account with that email or username already exists."` (S3) |
| **Account deletion** | ✅ Works (requires password); soft-anonymize tombstones the row + revokes JWTs |

The live probe **elevates the priority** of the client-authoritative trophy leaderboard (S2 #4 in the action plan): it is not theoretical — a brand-new account rigged the public ladder in one request. Recommend fixing it alongside the S1s if the leaderboard is a launch-visible feature.

---

## Action plan (ordered)

**S1 — before broad launch**
1. In `deleteAccount()`, cancel the active Stripe subscription (and optionally delete the customer) before blanking `stripe_customer_id`; best-effort try/catch with retry logging so a Stripe outage never blocks local deletion.
2. Move `ADMIN_KEY` out of the URL: send via an `Authorization`/`X-Admin-Key` header through `admin.html`'s existing `headers()` builder; remove every `?key=` call site; verify Railway access logs aren't retaining query strings.
3. Rewrite `privacy.html` §5.1 to the real subprocessors (Railway, Resend, Cloudflare R2, Stripe); remove the Vercel-DB/cPanel/Vercel-Analytics claims; confirm signed DPAs.

**S2 — ships-well cluster**
4. Make trophies **server-authoritative** — derive `trophy_points`/`achievements` in the game-finish/puzzle paths (or validate ids against a catalog) and stop accepting them verbatim from `POST /api/progress` (`db.js:1057-1069,1105`). **(Live-confirmed exploitable.)**
5. Add `flags.openings` and `flags.gauntlet` to the sync round-trip in all three places (`gatherLocalProgress`, POST forward, `setProgress`/`getProgress` in db.js **and** db-pg.js) so learning progress stops silently resetting cross-device; add a `progress-sync-http` guard covering these + `language`.
6. Serve socket.io from the vendored `vendor/socket.io.min.js` as the **primary** source (or pin SRI), drop cdnjs from CSP `script-src`, and emit the full CSP as an HTTP header via `vercel.json` rather than meta-only.
7. Add `AbortSignal.timeout(8000)` to the Resend fetch in `email.js` so a hung endpoint cannot stall signup/reset/reengage.
8. Fix the bot-worker double-respawn: guard `failSlot` against re-entry + add respawn backoff/ceiling.
9. Add a timeout-bounded DB ping (`SELECT 1`) to `/health` so Railway recycles on a DB outage; gate the commit SHA / infra flags behind the admin key.
10. Accessibility: port the chess board's `role=grid`/roving-tabindex/keydown pattern to checkers; convert the auth/gametype/rankings `.tab` divs to real focusable controls (unblocks keyboard signup); add `aria-live` regions; force `direction:ltr` on all boards under RTL; extend `a11y.mjs`.
11. Perf/SEO: `Cache-Control: immutable` for versioned assets in `vercel.json`; split `learn-library.js` out of `app.bundle.js` and lazy-load off-path screen modules; render a visible FAQ matching the FAQPage JSON-LD or remove that schema.
12. Fail CORS **closed**: when `CORS_ORIGIN` is unset in production, default to `DEFAULT_WEB_ORIGINS` (or refuse to boot) instead of `*`; remove stale localhost/capacitor allowlist entries.

**S3 — hygiene & polish**
13. Wrap the timeout-sweep interval body in try/catch; add a unique index on `LOWER(username)` in both backends; re-key XFF-based abuse buckets on trust-proxy `req.ip`.
14. Bump `ws` to ≥8.21.0 and **commit** `server/package-lock.json`; generalize the signup response to close the enumeration oracle.
15. Compliance polish: tokenized unsubscribe link + postal address on comeback emails (CAN-SPAM); null `analytics_events.user_id` in `deleteAccountData`; add a CSP to `admin.html`.
16. SEO polish: re-encode `og-image.png` under ~200KB; drop the unreferenced `icon-1024.png` from `COPY_ASSETS`; per-URL sitemap `lastmod` from real content dates; `datePublished`/`dateModified` on learn/openings/endgames Article LD; `rel=canonical` on the `/c/:id` share card.
17. Return the elo-strength legality + edge-FEN assertions to blocking CI (quarantine only the flaky K+Q-vs-K gradient); add end-to-end coverage for the clock-timeout sweep, rematch handshake, and friends/block lifecycle.

---

## Squad reports
- [Security & Auth](./security.md) — 70
- [Back-end & Data](./backend.md) — 80
- [Front-end & UX](./frontend.md) — 74
- [Functionality & Correctness](./functionality.md) — 76
- [Performance & SEO](./performance.md) — 80
- [Live recon & authenticated probe](./live-recon-and-probe.md) — 85
