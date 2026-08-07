# Performance & SEO — Squad Report

**Score:** 80 / 100  ·  **Findings:** 3×S2 · 7×S3

Verified all 10 raw findings against source at C:\Users\RickD\AndroidStudioProjects\ChessTrophies. 8 CONFIRMED, 1 PLAUSIBLE, 1 REJECTED (a malformed placeholder). No S0/S1 issues survived — the platform has solid baseline hygiene (defer-loaded scripts, SW precache with justified exclusions, gzip, self-hosted fonts, ?v= cache-busting, static pre-rendered SEO pages with mostly-correct JSON-LD). The real opportunities are refinements: the biggest first-load lever is that all ~30 JS modules (incl. 131KB learn-library folded into app.bundle.js) eager-load on first paint with zero route splitting; vercel.json ships no Cache-Control/immutable headers; the homepage FAQPage JSON-LD has no matching visible FAQ (a genuine structured-data guidelines violation with zero rich-result upside since FAQ results were restricted in 2023); and a cluster of content-freshness hygiene gaps (sitemap lastmod stamped to build date for all 87 URLs, learn/openings/endgames Article LD missing datePublished/dateModified while blog has them). Image weight (og-image 362KB over WhatsApp's ~300KB preview cap; icon-1024 155KB dead weight in dist) and the /c/:id share card's uncanonicalized /?c= og:url round out the S3 polish. Score 80: no launch blockers, but a coherent set of cheap S2/S3 wins on the exact first-load + share/SEO funnels the product is optimizing.

---

### 1. No route-level code splitting: ~647KB JS (~203KB gzipped) eager-loaded on every first visit  `S2` — _CONFIRMED_

**Evidence:** index.html:2184-2226 declares ~30 defer <script> tags, all requested at first paint. Verified fresh dist: app.bundle.js 360,897B (gz 114,105) + i18n.js 83,176B (gz 23,184) + puzzles.js 24KB + ct-checkers.js 22KB + openings.js 17KB + trophy-data.js 15.7KB + ct-duo.js 11.5KB + coach.js 9.6KB + ct-arena.js 7.1KB + ct-leagues.js 6.8KB + ct-gauntlet.js 5.3KB + shop.js 5.1KB … ; `cat dist/*.js | gzip | wc -c` = 202,668 bytes. build.mjs:67 TAIL = app.js/academy.js/review.js/trophy-extras.js/learn-library.js folded into one app.bundle.js — learn-library.js (131,267B raw) ships to every visitor inside that bundle yet is also emitted as static /learn/*.html SEO pages. None of puzzles/checkers/openings/arena/gauntlet/leagues/coach/shop/duo are on the landing or first-bot-game path.

**Impact:** A first-session guest (the funnel the product optimizes) downloads+parses ~120KB min of off-path modules plus the 131KB learn-library it never executes; on mid-tier mobile that is meaningful main-thread parse/compile time before interactive. defer keeps it non-render-blocking and the SW caches returning visits, which caps this at S2 — but it is the single biggest remaining first-load lever.

**Recommendation:** Lazy-load screen modules on first navigation (dynamic import() or injected <script> in the route handler) instead of the boot list; top candidates puzzles.js, ct-checkers/checkers*.js, openings.js, ct-arena/ct-gauntlet/ct-leagues.js, coach.js, shop.js, ct-duo.js. Split learn-library.js out of app.bundle.js so it loads only when the in-app Learn screen opens (crawlers already get the static /learn pages).

### 2. vercel.json sets no Cache-Control — versioned static assets are not immutable/long-cache  `S2` — _CONFIRMED_

**Evidence:** vercel.json headers block for source `/(.*)` contains only CSP frame-ancestors, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy — no Cache-Control (full file read). Assets are cache-busted via a ?v=<STAMP> query (index.html:2184-2226; build.mjs STAMP is a per-build second-granular timestamp) but filenames like app.bundle.js are stable across deploys (not content-hashed). With no explicit header, Vercel's default applies, so a client without the SW installed must revalidate each of ~30 JS files + fonts on repeat visits.

**Impact:** First-time-per-deploy loads and any non-SW client (SW registration can fail/be unsupported and only controls after the first load event) pay a conditional revalidation round-trip per asset — ~30 requests of latency that could be served immutable from disk cache. Real but SW-mitigated for returning app users, hence medium-confidence S2 (borders S3).

**Recommendation:** Add a vercel.json headers rule for versioned assets (source `/(.*)\.(js|woff2|png|svg)` or the fonts/*.js paths) with `Cache-Control: public, max-age=31536000, immutable` — the ?v= stamp already mints a new URL per deploy so immutable is safe. Keep index.html and sw.js on short/no-cache so new deploys are picked up.

### 3. Homepage FAQPage JSON-LD has no matching visible FAQ (structured-data guidelines violation)  `S2` — _CONFIRMED_

**Evidence:** index.html:89-144 injects a full FAQPage schema with 6 Question/Answer pairs. grep confirms the answer text exists ONLY in the JSON-LD: distinctive phrases 'optional Premium tier only removes ads' (line 99) and 'no app install required' (line 139) each appear exactly once in the file. The visible below-hero section (index.html:902-962) is a 'What you can do' <h4> grid + a 'Learn & tools' link list — no Q&A, <details>, or <dl>. The source comment at index.html:87 claims 'the honest FAQ below the hero' but none is rendered.

**Impact:** Google's FAQPage policy requires the Q&A to be visibly present; markup that does not represent visible content is a guidelines violation that can draw a structured-data manual action. Since FAQ rich results were restricted to gov/health sites in Aug 2023, this markup yields zero rich-result benefit for ChessTrophies — pure downside risk on the site's most important page. (Manual actions for this are uncommon in practice, so calibrated to S2, not higher.)

**Recommendation:** Either render a visible CSP-safe <details>/<summary> FAQ mirroring the 6 Q&As (reuse the auth.skill accordion pattern at index.html:866) or remove the FAQPage JSON-LD. Keep the SiteNavigationElement (index.html:145+) — it correctly mirrors the visible link list.

### 4. og-image.png is 362KB — exceeds common social-crawler preview caps  `S3` — _CONFIRMED_

**Evidence:** og-image.png = 362,768 bytes, 1200x630 8-bit RGB non-interlaced PNG (verified via file). It is the OG/Twitter image in index.html, every generated learn page (build.mjs:487 image: `${SITE}/og-image.png`) and openings/endgames pages, and the /c/:id share card (server/challenges.js fallback image). WhatsApp and several link-preview crawlers cap fetched preview images at ~300KB and skip rendering above that. Correctly excluded from SW precache (PRECACHE_EXCLUDE, build.mjs).

**Impact:** Rich link previews — the stated primary growth mechanic (challenge links + launch posts) — may render blank on WhatsApp and other size-capped crawlers, weakening the share loop. Not on first-paint path, so a social/SEO issue only.

**Recommendation:** Re-encode og-image.png (pngquant to ~40-90KB, or an optimized JPEG under 200KB) keeping 1200x630, and regenerate the copies the learn/openings pages reference.

### 5. icon-1024.png (155KB) copied into dist on every build but unreferenced  `S3` — _CONFIRMED_

**Evidence:** build.mjs:77 lists 'icon-1024.png' in COPY_ASSETS so it is emitted (confirmed dist/icon-1024.png = 155,215 bytes, 1024x1024 RGBA PNG). manifest.json icons reference only icon.svg / icon-192.png / icon-512.png — no 1024. build.mjs:98-99 itself documents it as 'NOT referenced by manifest.json … effectively dead weight'. Kept out of SW precache but still shipped to the CDN.

**Impact:** 155KB of dead payload on the deploy/CDN with no consumer. Never fetched, so no runtime cost — pure cleanup.

**Recommendation:** Drop 'icon-1024.png' from COPY_ASSETS (and the now-moot PRECACHE_EXCLUDE entry), or add a real 1024 maskable icon to manifest.json if an install icon is wanted.

### 6. sitemap.xml stamps every URL's <lastmod> to the build date on every deploy  `S3` — _CONFIRMED_

**Evidence:** build.mjs:751 `const lastmod = new Date().toISOString().slice(0,10)`, applied as the single value to all URLs (build.mjs:763 in the urls.map). All 87 URLs — homepage, /learn/ hub, every article, and the extra opening/tool/endgame/blog surfaces — get the same lastmod. Any redeploy (even a JS-only change) rewrites all content pages' lastmod.

**Impact:** Every deploy falsely signals that all pages changed; Google learns to distrust an always-'today' lastmod and may ignore the field, wasting crawl budget on unchanged pages and discarding the one reliable freshness signal a sitemap gives.

**Recommendation:** Derive per-URL lastmod from real content date/hash (blog posts already carry datePublished/dateModified; give learn/openings/endgames a stable per-article date) so lastmod only moves when content actually changes.

### 7. learn / openings / endgames Article JSON-LD omit datePublished and dateModified  `S3` — _CONFIRMED_

**Evidence:** learn Article LD (build.mjs:479-494) has headline/description/articleSection/author/publisher but no date fields. openings Article LD (scripts/seo/openings-pages.mjs:363; verified in dist/openings/italian-game.html) and endgames (scripts/seo/endgames-pages.mjs:378) likewise omit dates. By contrast the blog generator emits both (scripts/seo/blog-pages.mjs:122-123 datePublished/dateModified; verified 2 occurrences in each dist/blog/*.html), proving the field is known-good and just not applied elsewhere.

**Impact:** datePublished/dateModified are recommended Article fields; their absence forfeits Rich Results enhancement eligibility and freshness signals for the ~74 highest-effort content pages (60 learn + 8 openings + 6 endgames). Not indexing-blocking, but under-sells the largest part of the content moat.

**Recommendation:** Add datePublished/dateModified to the Article LD in build.mjs learnPageHtml and in openings-pages.mjs / endgames-pages.mjs, sourced from the same stable per-article date used for the lastmod fix (not the build clock).

### 8. /c/:id share card sets og:url to a parameterized homepage with no canonical/noindex  `S3` — _CONFIRMED_

**Evidence:** server/challenges.js:164 `url = ${SITE}/?c=${cid}` is passed as og:url in page() (challenges.js:210); the emitted <head> (page() body, challenges.js) has og:url but no <link rel=canonical> and no X-Robots-Tag — grep for canonical/noindex/robots in challenges.js finds only a code comment. The card uses a 0-second meta http-equiv=refresh and is reached via the vercel.json rewrite `/c/:id → railway`. Not in the sitemap.

**Impact:** If crawled (challenge links are shared on social, which crawlers fetch), Google can accumulate near-duplicate /?c=<id> homepage variants — index bloat / duplicate-signal dilution of the real homepage. Real-world exposure is low (not in sitemap, instant redirect), hence S3.

**Recommendation:** Add `<link rel="canonical" href="https://www.playchesstrophies.com/">` to the share-card <head> and/or return `X-Robots-Tag: noindex` on the /c/:id response — crawlers still read OG/Twitter meta for the preview while the parameterized variants stay out of the index.

### 9. In-process bot fallback silently re-introduces event-loop blocking if the worker engine fails to load  `S3` — _PLAUSIBLE_

**Evidence:** server/bot.js:135 `poolUsable()` = `_wantWorkers && pool.some(s => !s.ready || s.engineOk)`; bot.js:139-147 `botMove()` runs synchronous `computeMove(...)` on the main thread whenever poolUsable() is false (no worker ever reached engineOk) OR queue>=MAX_QUEUE(256). This is the same synchronous search that was moved to workers to fix the documented ~1.5s/move p90 stalls. Pool sizing is fine (defaultPoolSize returns >=1 even at ~1 vCPU), so the specific trigger is engine-load failure inside workers — the recurring Dockerfile COPY-drift / ESM-require(UMD) failure class in project memory. botEngineDiag() (bot.js:150+) already exposes workers.ready but /health does not fail on ready===0.

**Impact:** If a deploy ships without engine files reaching the worker runtime dir, every bot move silently falls back to blocking the event loop, resurrecting the server-wide N×1.5s stall the pool was built to eliminate — and it fails quiet (moves still compute) so the regression is non-obvious. Contingent on a specific deploy failure, so S3.

**Recommendation:** Treat a persistent all-workers-unready state as a hard signal: surface botEngineDiag().workers.ready===0 prominently on /health and fail the readiness/durability check (or refuse silent in-process degradation) rather than degrading quietly. The /health?diag=1 wiring is the right hook.

### 10. Malformed placeholder finding (title 't', evidence 'e') — no substantiated issue  `S3` — _REJECTED_

**Evidence:** The 10th raw finding contains single-character placeholder fields (title 't', evidence 'e', impact 'i', recommendation 'r') tagged S1. It cites no file:line and describes nothing verifiable in the source.

**Impact:** None — it is an empty/corrupt entry, not a real defect. Listed so the chief sees it was culled rather than dropped silently.

**Recommendation:** Discard; no code change. Its S1 tag is spurious and should not affect the domain score.
