# Live Recon & Authenticated Probe

**Surface score:** 85 / 100

## Part 1 — Observable-surface recon (unauthenticated)

The live public surface is in good shape. The Vercel-hosted client ships a strong security-header set (HSTS 2yr, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy) and a full hardened CSP (default-src 'self', locked script/connect/img/object directives); the Railway API applies helmet headers and correctly-restricted CORS (reflects only the allowed origin, rejects a foreign one). SEO plumbing is correct and complete: robots.txt is sane, the 87-URL sitemap spot-checks all 200, and /learn/ + /openings/ pages serve canonical, OG/Twitter, and valid JSON-LD (Article, BreadcrumbList, WebApplication, FAQPage). /health reports a healthy durable+litestream+botReady node. The few observations below are hardening nits, not launch blockers.

---

### 1. Admin key transmitted as a URL query parameter (?key=) by the live admin dashboard  `S2` — _confidence: high_

**Evidence:** GET https://www.playchesstrophies.com/admin.html (200, static shell) serves JS that calls e.g. fetch('/api/admin/user/' + encodeURIComponent(uid) + '?key=' + encodeURIComponent(getKey())) and statsUrl()/usersUrl() built the same way. The ADMIN_KEY is thus sent in the request URL rather than a header/body. Unauthenticated GET /api/admin/stats correctly returns 403, so gating works — but the key travels in the URL.

**Impact:** High-value ADMIN_KEY lands in places URLs are routinely retained: Railway/edge access logs, any proxy or CDN logs, browser history, and the Referer header on any subsequent navigation. A leaked log line grants full admin-dashboard read access (user enumeration, stats). This is credentials-in-URL, an OWASP-flagged anti-pattern.

**Recommendation:** Send the admin key in an Authorization/X-Admin-Key request header instead of the query string (the admin.html already builds a headers() object — route the key through it and drop the ?key= usage). Also confirm server access logging doesn't record full query strings in the interim.

### 2. Core CSP delivered only via <meta http-equiv>, and script-src allowlists cdnjs.cloudflare.com  `S3` — _confidence: high_

**Evidence:** Homepage HTTP response header is only `Content-Security-Policy: frame-ancestors 'none'`. The substantive policy is in the HTML: <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://chesstrophies-production.up.railway.app wss://...; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self';">

**Impact:** Meta-delivered CSP is enforced by modern browsers but is strictly weaker than a header: it doesn't cover the response before the parser reaches the tag and can't carry frame-ancestors/report-to. Separately, allowlisting the entire cdnjs.cloudflare.com host means any script hosted there is a permitted injection sink, and 'unsafe-inline' on style-src slightly widens surface. No XSS demonstrated — this is defense-in-depth hardening.

**Recommendation:** Emit the full CSP as an HTTP header via vercel.json (Vercel supports per-path headers), keeping frame-ancestors there too; pin the specific cdnjs asset with subresource-integrity or self-host it to drop the wildcard host from script-src.

### 3. /health exposes commit SHA and internal deployment config flags to the public  `S3` — _confidence: high_

**Evidence:** GET https://chesstrophies-production.up.railway.app/health returns {"ok":true,"build":"81c8025","litestream":true,"backupsConfigured":true,"durable":true,"dbBackend":"sqlite","sentry":false,"pushConfigured":true,"botReady":true,"multiInstance":false} with no auth.

**Impact:** Minor information disclosure: the exact deployed commit (81c8025) lets an attacker map the public GitHub source to the running binary, and flags like sentry:false / dbBackend:sqlite / multiInstance:false reveal that error monitoring is off and it's a single-instance SQLite node. Not directly exploitable, but it aids reconnaissance.

**Recommendation:** Keep the liveness signal (ok/durable/botReady) public but move the commit SHA and infra flags behind the admin key, or gate the verbose body on a query flag only the dashboard sends.


---

## Part 2 — Authenticated live probe (production Railway API)

Two throwaway accounts created against the live API, probed, then reset + deleted (verified gone). Owner-authorized.

| Probe | Result |
|-------|--------|
| IDOR — A reads B's `/api/users/:id/profile` | ✅ Safe — no email/pw_hash/stripe id/token; only public leaderboard-equivalent fields |
| Admin gating — `/api/admin/stats` no-key / wrong-key | ✅ 403 / 403 |
| Trophy leaderboard integrity — fresh account POSTs `trophyPoints:99999999` | 🔴 CONFIRMED — instantly topped the public global trophy ladder; profile showed fabricated points |
| Cross-account write — A POSTs `/api/progress` with `userId=B.id` | ✅ Safe — B unchanged; server scopes writes to `req.userId` |
| Enumeration oracle — re-signup existing email | 🟠 CONFIRMED — distinct "already exists" message |
| Account deletion | ✅ Works (password-gated); soft-anonymize tombstones + revokes JWTs |

**Takeaway:** the client-authoritative trophy leaderboard is not theoretical — a brand-new account rigged the public ladder in a single request. Prioritize the server-authoritative-trophies fix if the leaderboard is launch-visible.
