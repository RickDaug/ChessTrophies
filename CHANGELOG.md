# Changelog

All notable changes to ChessTrophies. Newest at top. Each entry should answer "what changed and why" so a future developer reading git blame doesn't have to reconstruct context.

Format inspired by [Keep a Changelog](https://keepachangelog.com/). Versioning will switch to semver once we're past v1.0.0 in the Play Store.

---

## 2026-05-27 — Pre-launch hardening pass

### Critical: index.html truncation repaired

`index.html` had been silently truncated in the initial commit `5c51c59`. The file ended mid-string at `'<div style="` with no closing `</body></html>` and **no `<script>` tags loading `app.js`, `academy.js`, `sounds.js`, or `stockfish-ai.js`**. Despite `CLAUDE.md` and `HANDOFF.md` claiming "built and verified end-to-end," the on-disk client had been non-functional since day one — chess.js loaded, but no game logic ran.

**Repair:**
- Restored the missing modal HTML below the `<!-- chess.js -->` block.
- Added script tags in dependency order: `sounds.js` → `stockfish-ai.js` → `app.js` → `academy.js`. Order is load-bearing — academy.js reads `window.CT` which is defined by app.js.
- Added a documented fallback that displays a user-readable error if `chess.js` fails to load from CDN.
- Added explicit service worker registration (`navigator.serviceWorker.register('sw.js')`).
- Closed `</body></html>` properly with trailing newline.

**Why this hadn't been caught earlier:** my best guess is a write was interrupted before the initial commit. The user had presumably been opening a previous, working version of the file in a different location at some point, then committed a stale snapshot. Lesson: every entry-point HTML file should have an automated smoke-test that opens it headless and verifies there are no console errors.

### Security hardening — client

- **`toast()` now uses `textContent` instead of `innerHTML`.** Six callers were concatenating user-controlled strings (usernames, opponent names, room codes) into the toast message. A user with username `<img src=x onerror=...>` could have run arbitrary script on every greeted user. Sink fix.
- **Signup validates username charset + email format on the client.** Username `^[a-zA-Z0-9_]{3,20}$`, email `^[^@\s]+@[^@\s]+\.[^@\s]+$`. Defense in depth — the server validates the same rules.
- **Added Content-Security-Policy `<meta>` tag.** Restricts `script-src` to `'self'` + `cdnjs.cloudflare.com`, blocks frame embedding, blocks object/embed, restricts `base-uri`. `'unsafe-inline'` still allowed because `index.html` embeds CSS and bootstrap JS directly; tightening this further is on the post-launch backlog (see `SECURITY.md`).

### Security hardening — server

- **`JWT_SECRET` is now hard-required in production.** Previously defaulted to the literal string `'change-me-in-production'` — a silent fallback that, if shipped, would let attackers forge tokens against any user. The server now exits with a fatal error if `NODE_ENV=production` and `JWT_SECRET` is unset. Dev mode falls back to a random ephemeral secret with a loud warning.
- **Added `helmet` middleware.** Sets HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, etc. CSP is left to the static client.
- **Added `express-rate-limit`.** 20 attempts / 15 min / IP on `/api/auth/*` (prevents brute force on login), 120 / min / IP on the rest of `/api/`. Health endpoint is unrestricted so uptime probes don't get blocked.
- **CORS allowlist via `CORS_ORIGIN` env.** Previously open `*` on both Express and Socket.IO. Now defaults to `*` only when the env var isn't set; production deploys should set it to the exact client origin(s).
- **Constant-time login.** `bcrypt.compare()` now runs against a dummy hash when the user doesn't exist, eliminating the timing-based account-enumeration sidechannel.
- **Generic auth errors.** Both signup and login now return a single error message that doesn't distinguish "email already exists" from "username taken" or "no account" from "incorrect password." Prevents probing.
- **Type guards on `req.body`.** Every signup / login / friends-add field is checked for type and shape before use.
- **Server-side username/email validation.** Mirrors the client rules. The client is hostile in our threat model.
- **Generic 500 error handler.** Prevents stack traces from leaking to clients.
- **Per-user WebSocket rate limits (token bucket).** Chat capped at 5 msg burst, refilling 1/sec. `mm_join` capped at 3 attempts, refilling 1 per 5 sec. Tighter chat sanitization — strips control chars in addition to angle brackets.

### Added

- **`SECURITY.md`** — threat model, control inventory, known gaps, onboarding checklist, incident-response procedure, post-launch hardening backlog.
- **`icon-192.png`, `icon-512.png`, `icon-1024.png`** — PWA manifest icons, generated from `icon.svg` via cairosvg. The 1024 source feeds the Play Store feature graphic and Android adaptive icon layers (see commit `03f03d0`).
- New `server/.env.example` documents `CORS_ORIGIN`, `SERVE_CLIENT`, `NODE_ENV`.

### Server dependencies

- Added `helmet@^7.1.0`.
- Added `express-rate-limit@^7.4.0`.

---

## 2026-05-12 — Initial commit (`5c51c59`)

Built and pushed the Phase 1 client and Phase 2 server scaffold. See `HANDOFF.md` for the feature inventory at that point. Note that this commit included the truncated `index.html` — see the 2026-05-27 entry above for the repair.

---

## Conventions

- One entry per session of work, dated.
- Group changes under `### Added`, `### Changed`, `### Fixed`, `### Removed`, `### Security`, `### Incident: <YYYY-MM-DD>` headings.
- Reference commit hashes when a specific commit is the locus.
- If you touch security: also update `SECURITY.md`.
- If you change architecture or hosting: also update `CLAUDE.md`.
