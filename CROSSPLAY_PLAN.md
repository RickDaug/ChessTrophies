# ChessTrophies — Cross-Platform Play Game Plan (Phase 2)

> Status: DESIGN / BLUEPRINT. This document describes how to make ranked, private,
> and public matches fully cross-playable across Web, Android, and (later) iOS,
> with globally unique usernames. No app behavior changes from this document alone.

## 1. Guiding principle

The client (web page, Android app, iOS app) is just a *window* into one shared
backend. All identity, matchmaking, ELO, match history, and live game state live
on the server. The device a player uses is irrelevant to who they can play. Get
this right and cross-play + unique usernames are automatic; get it wrong (state
on the device) and platforms become isolated islands that can never meet.

## 2. What already exists (verified in repo)

The backend is already scaffolded for this — more than the MVP login copy implies:

- SQLite schema (server/db.js): `users` (both `email` and `username` are
  `UNIQUE NOT NULL`), `friendships`, `games`, `rooms` (`code` is PRIMARY KEY).
- Username lookups are already case-insensitive: `WHERE LOWER(username)=LOWER(?)`.
- JWT auth (server/auth.js): `makeToken`, `verifyToken`, `requireAuth` Bearer
  middleware, token expiry.
- REST endpoints (server/server.js): guest create/release, recent games
  (auth-protected), static asset serving on PORT 3000.

## 3. What is NOT yet built (the Phase 2 work)

- A real-time transport (no WebSocket layer today). Needed for live moves.
- Live matchmaking queue + pairing endpoints (ranked / public).
- Server-authoritative live game sessions (move validation + relay + clock).
- Client migration off local-storage to server accounts for online play.
- Email/password (or SSO) sign-up wired to the existing users table.

## 4. Data model (extend existing schema)

- users: id, email (unique), username (unique, citext/lowercased), elo, wins,
  losses, best_streak, is_premium, created_at. Username is the single source of
  truth for identity across ALL platforms.
- sessions/tokens: JWT carries user id; refresh handled client-side per platform.
- games: id, white_id, black_id, mode (ranked|private|public|practice),
  result, pgn/moves, started_at, ended_at, elo_delta.
- matchmaking_queue (new): user_id, elo, mode, region, enqueued_at.
- rooms: code (PK), host_id, guest_id, status — already present for private play.

## 5. Username uniqueness (directly answers the requirement)

- Enforced in ONE place: the DB `UNIQUE` constraint on `users.username`.
- Store/compare case-insensitively (already done) so "Magnus" and "magnus"
  cannot both exist.
- Registration on ANY platform calls the same `/api/auth/register`; the DB
  rejects duplicates regardless of device. You literally cannot reuse a name
  taken on another platform because every client queries the same table.
- Guests keep session-only random names and never reserve a real username.

## 6. Matchmaking — all modes cross-play once backend is shared

- Ranked: server-side queue, pair within +/- ELO band from a SINGLE global pool.
  Device type is not a field in matching. Web 1400 vs Android 1400 = same queue.
- Private: host asks server for a room `code`; anyone on any platform enters the
  code to join the same server-side room. Already modeled via `rooms`.
- Public/open: same global matchmaking pool as ranked (or a casual variant).
- Rule: matchmaking MUST run on the server, never the client.

## 7. Real-time move sync

- Add a WebSocket layer (e.g. `ws` library) attached to the existing HTTP server.
- Server is AUTHORITATIVE: it validates each move (reuse chess rules server-side),
  updates game state, then broadcasts to both players' sockets.
- Clients render and send intents only; they never decide legality. This keeps
  web/Android/iOS perfectly in sync and blocks most cheating/desync.
- Reconnect: on socket drop, client re-fetches authoritative game state by id.

## 8. Clients are thin

- Web: existing PWA talks to REST + WebSocket.
- Android / iOS (future): native or wrapper (e.g. Capacitor) hitting the SAME
  API base URL. No game logic lives in the app beyond rendering + input.
- A shared API contract (documented) keeps all clients interchangeable.

## 9. App-store / account caveats (for the mobile phase, later)

- Apple: digital purchases inside the iOS app generally must use Apple IAP;
  entitlements (premium/ads-off) should be tracked by the backend per-account,
  not per-device, so a purchase is honored cross-platform.
- Apple historically requires offering "Sign in with Apple" if other social
  logins are offered. Plan auth to allow SSO providers + email.
- None of this blocks cross-play; it is store-compliance housekeeping.

## 10. Phased, low-risk rollout

1. Auth: wire email/password (or SSO) register/login to existing users table;
   keep local guest mode for offline/practice. (No multiplayer yet.)
2. Read APIs: profile, ELO, recent games served from server for logged-in users.
3. WebSocket layer + a single live game type (private room by code) end-to-end.
4. Ranked queue + ELO updates server-side; then public/casual.
5. Harden: reconnect, clocks, abuse/rate limits, server-side move validation.
6. Mobile clients point at the same API; ship Android, then iOS.

## 11. Explicit non-goals / safety

- Secrets (JWT secret, SSO keys), account creation, and infra/deploy changes are
  done by the operator, not automated.
- This document changes no runtime behavior; it is the blueprint the build follows.
