# Security Overview

This document captures the current hardening posture for ChessTrophies after the 2026-05-28 repair and hardening pass.

## Scope
In scope for Phase 1:
- Stored XSS through user-controlled strings in toasts, names, and room/share text.
- Brute-force and rate abuse on auth and API endpoints.
- Account enumeration and timing leaks in login/signup flows.
- CDN supply-chain risk for `chess.js` and third-party assets.
- JWT forgery and misconfiguration when `JWT_SECRET` is absent.
- CORS abuse and WebSocket abuse.

Out of scope for Phase 1:
- Cheating via modified local clients.
- LocalStorage privacy guarantees.
- Native keystore or device-security hardening.

## Controls added
- Repaired `index.html` to load app scripts in the required order, restored closing tags, and added an explicit CSP meta tag.
- Added SRI integrity for the `chess.js` CDN script.
- Hardened `app.js` toast rendering to use `textContent` instead of `innerHTML`.
- Added username/email validation to client auth flows.
- Hardened server auth with a production secret guard, deterministic fallback warning, and constant-time login responses.
- Added Helmet and rate limiting for `/api/*` and auth endpoints.
- Added CORS origin parsing and a generic 500 error handler.
- Added websocket chat + matchmaking rate limiting and control-character stripping.

## Known gaps and rationale
- CSP still uses `'unsafe-inline'` for scripts/styles because the current UI relies on inline event wiring and existing CSS helpers.
- The server currently has no JWT revocation list or token rotation policy.
- Static hosting still relies on the browser and local storage for MVP persistence.
- The server does not yet implement account lockout, audit logs, or WAF protections.

## Onboarding checklist
1. Run `cd server && npm install`.
2. Copy `server/.env.example` to `server/.env` and set `JWT_SECRET` for production.
3. Verify the client loads with `npx playwright` and the server boots with `npm start`.
4. Keep `CORS_ORIGIN`, `JWT_SECRET`, and `SERVE_CLIENT` reviewed before deployment.

## Incident response
1. Revert the impacted commit or disable the affected route if an exploit is found.
2. Rotate any exposed secrets (`JWT_SECRET`, deployed tokens, and provider keys).
3. Review logs for abuse spikes and patch the vulnerable path before redeploying.
4. Record the incident in `CHANGELOG.md` and update this document.

## Backlog
- Replace inline scripts/styles with a build pipeline and stricter CSP.
- Add server-side audit logging and anomaly detection.
- Introduce password reset, email verification, and account lockout.
- Add real-time replay and anti-cheat scoring.
