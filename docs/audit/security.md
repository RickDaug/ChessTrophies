# Security & Auth — Squad Report

**Score:** 70 / 100  ·  **Findings:** 2×S1 · 3×S2 · 8×S3

Verified all 15 raw findings against source; deduped the two identical CORS-wildcard findings into one and merged the XFF-evadable-limiter finding into the challenge-counter finding (same root cause). Core auth is solid: JWT with token_version revocation, bcrypt cost 12, login/forgot are enumeration-hardened with a dummy-hash compare, express-rate-limit is correctly keyed on trust-proxy req.ip, and SQL is parameterized with escaped LIKE wildcards. No S0/exploitable-RCE or auth-bypass was found. The two S1s are non-exploit compliance/billing defects: (1) account deletion wipes the Stripe customer mapping but never cancels the subscription — the user keeps getting charged with no in-app record to cancel against, and it contradicts the deletion promise in privacy.html:192; (2) the privacy policy names the wrong subprocessors (Vercel-DB/cPanel-email/Vercel-Analytics) while PII actually lives on Railway, transits Resend, and replicates to Cloudflare R2 via Litestream. The rest are S2/S3 defense-in-depth and integrity issues: client-authoritative trophy leaderboard, an un-pinned socket.io CDN script (SRI gap), an outdated ws dep, fail-open CORS wildcard, and header-spoofable best-effort abuse buckets. Score reflects a fundamentally sound auth core dragged down by two must-fix-before-broad-launch legal/billing items and a cluster of hardening gaps.

---

### 1. Account deletion clears the Stripe mapping but never cancels the subscription (continued billing + broken erasure promise)  `S1` — _CONFIRMED_

**Evidence:** auth.js:256-262 deleteAccount() calls only store.deleteAccountData(u.id). db.js:489-495 blanks stripe_customer_id='' and subscription_status='' via UPDATE but issues NO Stripe API call. billing.js has cancellation only through the user-driven Billing Portal (billing.js:170-187), never invoked on the delete path. Because stripe_customer_id is wiped AND email is tombstoned to deleted+<id>@deleted.invalid (db.js:479,495), reconcilePremiumForUser's email fallback (billing.js:103-108) can no longer match the Stripe customer either.

**Impact:** A premium user who deletes their account keeps being charged on the recurring interval with no in-app record to cancel against, and Stripe retains their customer object + email indefinitely. Direct financial harm to a real user and a factual contradiction of privacy.html:192 ('we delete Personal Information within 30 days... and instruct our Service Providers to do the same').

**Recommendation:** In deleteAccount, before blanking stripe_customer_id, best-effort list active subscriptions for the customer and call stripe.subscriptions.cancel (optionally stripe.customers.del to honor erasure). Guard it so a Stripe outage doesn't block local deletion; log failures for retry.

### 2. Privacy policy names the wrong subprocessors and omits the real ones (Railway, Resend, Cloudflare R2)  `S1` — _CONFIRMED_

**Evidence:** privacy.html:159 discloses hosting/database as 'Vercel — provide server, database', but the API + SQLite run on Railway (railway.json builder=DOCKERFILE server/Dockerfile; better-sqlite3 on a Railway volume) — Vercel only serves the static client. privacy.html:161 says email is via 'our cPanel email host', but email.js:8,18-27 sends via Resend (api.resend.com/emails) using RESEND_API_KEY. privacy.html:162 lists 'Vercel Web Analytics', but grep shows NO Vercel analytics script in index.html; the only analytics is first-party ct-analytics.js:169 POSTing to /api/events. litestream.yml replicates the full SQLite DB (emails, pw_hash, geo) to an S3/R2 replica (per project memory, durability is live to Cloudflare R2) — an undisclosed backup subprocessor + international-transfer path.

**Impact:** GDPR Art.13(1)(e)/Art.28 and CCPA/CPRA require accurate recipient/subprocessor disclosure. The stated list is both over-inclusive (Vercel-DB, cPanel, Vercel-Analytics are not used) and under-inclusive (Railway, Resend, Cloudflare R2 omitted), undermining any DPA/SCC chain and exposing the operator on first audit or complaint.

**Recommendation:** Rewrite privacy.html §5.1 to: Railway (hosting + SQLite database), Resend (transactional email), Cloudflare R2 (encrypted backups via Litestream), Stripe (payments), and LibreTranslate host if/when enabled. Remove the Vercel-database, cPanel-email, and Vercel-Web-Analytics claims. Ensure a signed DPA/SCC exists with each.

### 3. Trophy leaderboard & profile trophy counts are client-authoritative (spoofable)  `S2` — _CONFIRMED_

**Evidence:** POST /api/progress (requireAuth, req.userId at server.js:852) forwards caller-supplied achievements[]/streakTrophies[]/trophyPoints with only shape/length bounds (server.js:823-835). store.setProgress persists them verbatim: trophy_points clamped only to 0..100,000,000, achievements/streak_trophies JSON.stringify'd up to 2000 entries each with arbitrary id strings (db.js:1057-1069). These exact columns back the PUBLIC trophies leaderboard — topByMetric('trophies') orders by trophy_points with a json_array_length tiebreak (db.js:1105,1111,1131,1135) — and the public profile trophyCount.

**Impact:** Any signed-in user can POST {trophyPoints:100000000, achievements:[...2000 fabricated ids]} for their own account and instantly top the global trophy ladder and show a fabricated trophy case on their public profile. No cross-account/ownership bug, but it makes a competitive ranking meaningless and is visible to everyone.

**Recommendation:** Make trophies server-authoritative: derive trophy_points and achievements in the game-finish/puzzle-solve paths and stop accepting them from /api/progress — or validate each achievement id against a known catalog and compute the points total server-side from earned rows.

### 4. Realtime socket.io client loaded from cdnjs with no Subresource Integrity (SRI), despite a vendored local copy  `S2` — _CONFIRMED_

**Evidence:** index.html:2191 loads https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.5/socket.io.min.js with crossorigin=anonymous but NO integrity= attribute. The meta CSP (index.html:24) allows the entire host: script-src 'self' https://cdnjs.cloudflare.com. A byte-identical local copy exists at vendor/socket.io.min.js (46829 bytes, verified) and build.mjs copies vendor/ into dist/, but ct-socket-fallback.js:7-8 loads it only when the CDN load fails — so the primary path is always the un-pinned CDN script.

**Impact:** A cdnjs compromise or MITM/DNS attack serving a tampered socket.io.min.js executes attacker JS in-page with full DOM access, including the client-side JWT — account takeover for every visitor. The whole-host CSP allowance also means any future script-injection could pull arbitrary libraries from cdnjs.

**Recommendation:** Serve socket.io from the already-vendored vendor/socket.io.min.js as the PRIMARY source and drop cdnjs from CSP script-src; or add integrity="sha384-..." pinned to the exact 4.7.5 file. Also align the CDN version (4.7.5) with the server's socket.io (4.8.3, verified) to avoid protocol drift.

### 5. Deployed ws version (8.20.1) is behind the patched release; claimed memory-exhaustion DoS advisory  `S2` — _PLAUSIBLE_

**Evidence:** server/package-lock.json pins ws 8.20.1 (verified via node reading the lockfile: ws=8.20.1, socket.io=4.8.3, engine.io=6.6.8). This is the websocket transport under socket.io->engine.io->ws, exposed to the public internet by the IO server (server.js:124). The raw findings cite npm audit flagging ws high (range 8.0.0-8.20.1, fixed 8.21.0, GHSA-96hv-2xvq-fx4p, 'Memory exhaustion DoS from tiny fragments and data chunks'). I could not re-run npm audit live (no network in the audit sandbox), so the advisory's applicability is unverified though the outdated pin is certain.

**Impact:** If the advisory holds, an unauthenticated attacker opening a WebSocket to the Railway backend and sending crafted tiny fragments can drive memory allocation up and OOM-crash the single-instance (numReplicas:1) game server, taking down all live games and matchmaking.

**Recommendation:** Bump ws to >=8.21.0 via npm update ws in server/ and COMMIT the updated package-lock.json (per the repo's known 'npm ci lockfile' gotcha, node_modules alone won't deploy on Railway). Re-run npm audit --omit=dev to confirm the high clears.

### 6. Signup response is an email/username enumeration oracle  `S3` — _CONFIRMED_

**Evidence:** signup() throws the specific 'An account with that email or username already exists.' when store.getUserByEmail/getUserByUsername matches (auth.js:42), surfaced verbatim via the 400 handler. Login (auth.js:66-77, generic message + dummy bcrypt compare against DUMMY_HASH) and forgot (auth.js:93-100, always-200 with {token:null}) are deliberately enumeration-hardened; signup is not.

**Impact:** An attacker can probe whether an email/username exists via signup attempts, defeating the anti-enumeration hardening applied elsewhere. Rate-limited to 20/15min per IP by authLimiter (server.js:171), so slow but a working oracle across rotating IPs.

**Recommendation:** Return a generic 'Could not create the account' without distinguishing existence, or move to verify-email-first that always responds 200 and emails 'you already have an account' out-of-band (same pattern as forgot).

### 7. CORS fails OPEN to wildcard '*' in production when CORS_ORIGIN is unset (deduped)  `S3` — _CONFIRMED_

**Evidence:** parseCorsOrigins returns '*' for any falsy/blank value (server.js:108-111); in production an unset value only console.warns (server.js:116-118) and still serves every origin; DEFAULT_WEB_ORIGINS is union'd in ONLY when the value is not '*' (server.js:121-123), so an unset env stays '*'. cors() (server.js:183) and the Socket.IO server (server.js:124) are then configured with '*'. [Two identical raw findings merged here.]

**Impact:** If CORS_ORIGIN is ever missing/blank on a deploy, any website can call the API and sockets cross-origin. Bounded because auth is a Bearer JWT (no ambient-credential CSRF), but it removes origin as a defense layer and eases scripted abuse of public/rate-limited endpoints. Fail-open default rather than a hard failure.

**Recommendation:** Fail closed: when CORS_ORIGIN is unset in production, default to DEFAULT_WEB_ORIGINS (or refuse to boot) instead of '*'. Reserve wildcard for an explicit opt-in.

### 8. Stale localhost/capacitor origins remain permanently CORS-allowlisted after native removal  `S3` — _CONFIRMED_

**Evidence:** DEFAULT_WEB_ORIGINS still contains https://localhost, capacitor://localhost, and http://localhost (server.js:103-105), always union'd into the allowlist (server.js:122). Native/Capacitor was removed 2026-06-07 (project memory), so these WebView origins have no legitimate consumer; the comment at server.js:86-87 still references the removed native app.

**Impact:** http://localhost (any port) is a permanently trusted origin. A page on a victim's own machine could make cross-origin authenticated calls, though a Bearer token is still required and a foreign localhost page cannot read this site's token. Unnecessary allowlist surface.

**Recommendation:** Remove the three localhost/capacitor entries now that native is gone; if localhost is needed for dev, gate it behind NODE_ENV !== 'production'.

### 9. Best-effort abuse buckets key on raw X-Forwarded-For, so challenge social-proof counters (and analytics/error sinks) are header-spoofable (merged)  `S3` — _CONFIRMED_

**Evidence:** POST /api/challenges/:id/result increments plays/beats for any id with no auth and only a per-IP token bucket (challenges.js:119-130). ipOf() takes the first token of the raw XFF header (challenges.js:29), so rotating the header mints a fresh bucket and bypasses the 20/10s cap. The same raw-XFF pattern backs the analytics ingest (analytics.js:78) and client-error sink (client-errors.js:46). The primary authLimiter/apiLimiter correctly use trust-proxy req.ip (server.js:181), so AUTH surfaces are unaffected.

**Impact:** The 'N players tried / M beat it' social-proof numbers on shared challenge cards/OG previews (challenges.js) can be inflated to arbitrary values by anyone; analytics-event and client-error tables/logs can be flooded past intended per-IP caps. Integrity/cost only — no user data or money.

**Recommendation:** Key these buckets on express's trust-proxy-resolved req.ip (single trusted hop) rather than parsing raw XFF, and cap counters per challenge (tie increments to the session that loaded the challenge).

### 10. admin.html ships with no Content-Security-Policy backstop  `S3` — _CONFIRMED_

**Evidence:** helmet is configured with contentSecurityPolicy:false (server.js:182), so Railway-served pages get no CSP header. grep of admin.html for Content-Security-Policy/http-equiv returned no matches (index.html has one at line 24; admin.html has none). Vercel's vercel.json adds only frame-ancestors 'none'. admin.html does escape user data via esc(), so no confirmed injection today.

**Impact:** The owner-analytics dashboard renders user PII (usernames, emails, geo) and holds ADMIN_KEY in-page yet runs with zero CSP. Any future unescaped-innerHTML regression among its many innerHTML sinks would be directly XSS-exploitable with no mitigation. Defense-in-depth gap, not an active vuln.

**Recommendation:** Add a restrictive CSP to admin.html — a meta tag mirroring index.html (script-src 'self') or a per-route helmet CSP for /admin.html. The app is already inline-free, so extending real CSP coverage is low-risk.

### 11. In-game chat text will egress to an undisclosed external LibreTranslate host once enabled (latent)  `S3` — _CONFIRMED_

**Evidence:** POST /api/translate forwards raw chat q to ${LIBRETRANSLATE_URL}/translate (server.js:864-887) when the env var is set (auth-gated + translateLimiter). Chat is user-generated free text. privacy.html §5.1 lists no translation vendor. The route is env-gated and returns text UNCHANGED with {disabled:true} until LIBRETRANSLATE_URL is set (server.js:874-875), so no egress happens today. (Downgraded from S2: inert/contingent, overlaps the privacy-policy accuracy finding.)

**Impact:** If translation is activated, every cross-language chat message leaves the platform to a third-party translation service with no disclosure and, for a public instance, no DPA — a GDPR transfer/disclosure gap for content that can contain personal data. Latent, not live.

**Recommendation:** Add the translation provider to the privacy recipients before enabling, prefer a self-hosted instance under a DPA, disclose that opponent chat is sent for translation, and consider a per-user opt-out.

### 12. Re-engagement/comeback emails lack a one-click unsubscribe link and postal address (CAN-SPAM)  `S3` — _CONFIRMED_

**Evidence:** email.js:70-99 sendComebackEmail builds a plain-text marketing email whose only opt-out is 'You can stop these anytime from your profile.' (email.js:97) — no tokenized unsubscribe URL and no physical mailing address. Sent by the reengage scheduler to reachable users. Env-gated on RESEND_API_KEY.

**Impact:** US CAN-SPAM (and similar) require a functioning unsubscribe mechanism and a valid postal address on promotional email; 'manage it in your profile' is not compliant. Bounded because these send only to users who enabled updates.

**Recommendation:** Add a tokenized unsubscribe link (reuse the reset-token pattern) that flips the notification flag without login, plus a postal address, to the comeback template.

### 13. Soft-anonymize leaves analytics_events.user_id linked to the tombstoned row  `S3` — _CONFIRMED_

**Evidence:** deleteAccountData (db.js:477-498) deletes friend graph/pushes/resets/verifications/league memberships and blanks users-row PII, but does not touch analytics_events — those rows keep user_id pointing at the anonymized account. Only the ADMIN hard delete scrubs analytics_events (db.js:526). The users row is intentionally retained (db.js:471-476) to preserve FKs.

**Impact:** Low: the retained user_id resolves to a row stripped of email/name, so it is de-identified rather than PII. Still, behavioral event history tied to the account survives a GDPR erasure request, which a strict reading of privacy.html:192 could challenge.

**Recommendation:** Null out analytics_events.user_id in deleteAccountData (cheap DELETE/UPDATE in the existing transaction), or document that anonymized aggregate analytics rows are retained after erasure.
