# Security Policy

This document is the authoritative reference for ChessTrophies' security model: what's protected, what isn't, how to report a vulnerability, and what every developer touching the codebase must understand before shipping a change.

Keep this file up-to-date. When you add a security control, document it here. When you remove one, explain why.

---

## Reporting a vulnerability

Email `caveou@gmail.com` with subject line `[SECURITY] ChessTrophies <short description>`. **Do not file a public GitHub issue.** I'll respond within 72 hours. Coordinate disclosure timing with the project owner before publishing details. Once we have a `support@chesstrophies.com` address (post-launch), this email will move there.

---

## Threat model

**In scope:**
1. Stored XSS via user-controlled fields (username, chat, room codes).
2. Online brute force on `/api/auth/login`.
3. Account enumeration via auth error messages or timing.
4. SQL injection (via Express routes or WebSocket handlers).
5. Supply-chain compromise of the `chess.js` CDN (`cdnjs.cloudflare.com`).
6. JWT forgery via a leaked or default `JWT_SECRET`.
7. Cross-origin request abuse against the Phase-2 server.
8. WebSocket DoS — chat flood, matchmaking churn, move spam.

**Out of scope (Phase 1 client; revisit when relevant):**
- Cheating via a modified local client: until Phase 2 server is wired, ELO/trophies are computed locally and a determined user can rewrite localStorage. The Phase 2 server makes this irrelevant by recomputing ELO server-side and validating every move with `chess.js`.
- Browser-side data privacy: anything in `localStorage` is plaintext and readable by any script on the page. We mitigate XSS, but a successful XSS gets the session token.
- Native app keystore safety: lives on the developer's machine; treat it as a high-value secret and back it up.

---

## What's currently protected

### Client (`index.html` + `app.js` + `academy.js`)

| Control | Where | Notes |
|---|---|---|
| Content-Security-Policy | `<meta http-equiv>` in `index.html` | Allows `self` + `cdnjs.cloudflare.com` for scripts, fonts.googleapis.com for styles, fonts.gstatic.com for fonts. Inline scripts/styles still allowed (TODO: switch to nonces). |
| XSS sink hardening | `toast()` in `app.js` | Uses `textContent`, not `innerHTML`. All toast callers concatenate usernames/codes — this is the sink they would have hit. |
| Field-by-field escape | `escapeHTML()` in `app.js` and `academy.js` | Every dynamic template literal touching DOM via `innerHTML` runs through `escapeHTML()`. |
| Client-side input validation | `signup()` in `app.js` | Username `^[a-zA-Z0-9_]{3,20}$`, email `^[^@\s]+@[^@\s]+\.[^@\s]+$`, password 6+ chars. |

### Server (`server/`)

| Control | Where | Notes |
|---|---|---|
| `JWT_SECRET` hard-required in prod | `auth.js` | Process exits if `NODE_ENV=production` and `JWT_SECRET` unset. Dev mode falls back to an ephemeral random key with a loud warning. |
| `helmet` middleware | `server.js` | HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, etc. CSP is disabled here because the client ships its own via `<meta>`. |
| Rate limiting | `server.js` | `express-rate-limit`: 20 attempts / 15 min per IP on `/api/auth/*`, 120 / min per IP on all `/api/`. WebSocket events have per-user token buckets in `game.js`. |
| CORS allowlist | `server.js` | Origins from `CORS_ORIGIN` env (comma-separated). Defaults to `*` in dev only. |
| Server-side input validation | `auth.js`, `server.js` | Mirrors client validation. Type-guards every `req.body` field before use. |
| Constant-time login | `auth.js` | `bcrypt.compare()` runs against a dummy hash when the user doesn't exist, keeping response time independent of email validity. Defeats timing-based enumeration. |
| Generic auth errors | `auth.js` | "Email or password is incorrect." / "An account with that email or username already exists." — does not leak which field matched. |
| Parameterized SQL | `db.js`, `server.js`, `game.js` | All queries use `better-sqlite3` `.prepare(...).run/get/all(args)`. No string-concatenated SQL. `topByMetric` validates the column name against an allowlist. |
| Server-side move validation | `game.js` | Every move runs through `chess.js`. The client cannot fake a move. |
| Chat sanitization + rate limit | `game.js` | Strips control chars and angle brackets; rate-limited at 5 msg / sec / user. Client should also render chat via `textContent`. |
| Body size limit | `server.js` | `express.json({ limit: '256kb' })` blocks oversized payloads. |
| Generic 500 error handler | `server.js` | Stack traces never leak to the client. |

### Build / deploy

| Control | Where | Notes |
|---|---|---|
| Secrets stay out of git | `.gitignore` | `node_modules/`, `.env*`, `*.sqlite*`, `server/data.db*`. |
| Real `.env` never committed | by convention | `.env.example` is the public template (placeholders only). |
| Android keystore | dev machine only | Required to sign release APKs. **Lose this and you can never update the app on the same Play Store listing.** Back it up to an encrypted external drive AND a password manager. |

---

## Known gaps (intentional, with rationale)

1. **CSP allows `'unsafe-inline'` scripts and styles.** `index.html` embeds a large `<style>` block and several inline `<script>` blocks. Removing this would require moving every inline section to an external file and switching to per-load nonces. Worth doing before public launch; for now, the `script-src` allowlist still blocks `data:` URIs and arbitrary external script injection.

2. **`chess.js` lacks SRI hash.** The sandbox network can't reach cdnjs to compute the hash. Populate via this PowerShell snippet and add `integrity="..."` + `crossorigin="anonymous"` to the script tag in `index.html`:
   ```powershell
   $url='https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js'
   $bytes=(Invoke-WebRequest -UseBasicParsing -Uri $url).Content
   $sha=[System.Security.Cryptography.SHA384]::Create().ComputeHash($bytes)
   'sha384-' + [Convert]::ToBase64String($sha)
   ```
   Better long-term: vendor `chess.js` locally (eliminates the CDN dependency entirely and is required for the Capacitor Android bundle anyway).

3. **No JWT revocation list.** Tokens valid for 30 days regardless of password change. Acceptable for v1 — adding revocation requires Redis or a `revoked_tokens` table. Document this if rolling password reset.

4. **Stockfish is disabled.** Built-in minimax in `app.js` is the active engine. Stockfish is GPL v3; enabling it forces the whole project to GPL v3. See `LICENSES.md`. Don't flip `ENABLE_STOCKFISH = true` without resolving licensing first.

5. **Phase 1 client trusts itself.** Until the Phase 2 server is deployed and the client is wired to it, ELO and trophies are local. A user could edit `localStorage` directly. This is by design for the offline-capable PWA; the server flips the trust model when online.

---

## Onboarding checklist (new developer or future-you)

Before touching the codebase:

1. Read `CLAUDE.md` cover-to-cover — it's the canonical resume artifact.
2. Read this file (`SECURITY.md`) cover-to-cover.
3. Skim `LICENSES.md` for the Stockfish/MIT boundary.
4. Read `CHANGELOG.md` for recent fixes and post-mortems.
5. Verify `git status --short` is clean before starting. If there are uncommitted changes, ask the project owner what they are.
6. Open `index.html` in a browser and verify the app boots — no console errors, all four script files load (`sounds.js`, `stockfish-ai.js`, `app.js`, `academy.js`), the board renders.
7. If touching `server/`, copy `server/.env.example` to `server/.env` and generate a `JWT_SECRET` via the snippet above.

Before opening a PR / pushing:

1. `git diff` — review your own changes before anyone else does.
2. Run `/security-review` (Claude Code slash command) on the pending changes if they touch auth, billing, move validation, or any user-input handling.
3. Update `CHANGELOG.md` with what you changed and why.
4. If you added or removed a security control, update this file.
5. If you added an env var, update `server/.env.example` and document it in `server/README.md`.

---

## Incident response

If you discover a live security incident:

1. Stop the bleeding: take the affected service offline if necessary (`railway down`, or remove the affected Vercel deployment).
2. Document: timestamp, what happened, what was exposed, who's affected. Add an entry to `CHANGELOG.md` under an `### Incident: YYYY-MM-DD <description>` heading.
3. Notify users only if PII or credentials were exposed (email addresses + bcrypt hashes count as PII).
4. Patch on a private branch, deploy, verify, then merge.

The handover doc (`CLAUDE.md`) should be updated in the same commit as any incident.

---

## Future hardening (post-launch backlog)

In rough priority order:

1. SRI on the `chess.js` CDN script (or vendor it locally).
2. Migrate CSP from `'unsafe-inline'` to nonces; remove inline `<script>` and `<style>` blocks.
3. Add `npm audit --production` to CI.
4. Add an `npm audit signatures` check for dependency tampering.
5. Add Dependabot to `RickDaug/ChessTrophies` for automated dep updates.
6. Add Sentry or equivalent for client + server error tracking — early warning of exploit attempts.
7. Add 2FA via TOTP for high-value accounts (Premium subscribers; admin once we have one).
8. Rotate JWT secret quarterly. Document the rotation playbook (issue new tokens via /api/auth/login on next user request, invalidate old after grace period).
9. Encrypt SQLite at rest (SQLCipher) once we have real PII volume.
