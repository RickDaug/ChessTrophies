# ChessTrophies Server

Node.js + Express + Socket.IO + SQLite backend for ChessTrophies online play.

## What it provides

- Email/password signup and login (JWT, 30-day tokens)
- Profile, friends list, recent game history
- Top-N rankings by ELO / Wins / Best Streak / Invites
- Real-time matchmaking (skill-based, widening ELO tolerance over time)
- Authoritative move validation (server-side chess.js)
- Persistent game records with PGN
- Recruiter trophy tracking across devices (via `invitedBy` on signup)

## Run locally

```bash
cd server
cp .env.example .env
# Edit .env to set a real JWT_SECRET
npm install
npm start
# Server listens on :3000 by default
```

Health check: `curl http://localhost:3000/health`

## Deploy

### Railway (recommended for quick start)
1. Push this folder to a GitHub repo (or include in your existing ChessTrophies repo as `/server`).
2. On railway.app, click "New Project → Deploy from GitHub repo".
3. Pick the repo and the `server` directory as the root.
4. Add env var `JWT_SECRET` (random 64-char string).
5. Railway auto-detects Node.js and runs `npm start`.

### Render
Same workflow — set the root directory to `server/`, build command `npm install`, start command `npm start`.

### Fly.io
```bash
fly launch
fly secrets set JWT_SECRET=your-secret-here
fly deploy
```

## Wire the client to the server

In `app.js` on the client, set:

```js
const SERVER_URL = 'https://your-deployment.railway.app';
```

Replace the localStorage-based auth in `signup()` / `login()` with calls to:
- `POST /api/auth/signup` — body `{ email, username, password, region, invitedBy }`
- `POST /api/auth/login` — body `{ email, password }`
Both return `{ token }` — store in localStorage and send as `Authorization: Bearer <token>` header.

For real-time play, on the client:

```js
import { io } from 'https://cdn.socket.io/4.7.5/socket.io.esm.min.js';
const socket = io(SERVER_URL);
socket.emit('auth', { token: localStorage.getItem('ct_token') });
socket.on('auth_ok', () => socket.emit('mm_join', { mode: 'ranked' }));
socket.on('match_found', ({ gameId, white, black }) => { /* start game */ });
socket.on('move_made', ({ move, fen }) => { /* sync board */ });
socket.on('game_over', ({ winnerId, reason, whiteDelta, blackDelta }) => { /* show result */ });
```

## API reference

| Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|
| `/health` | GET | — | — | `{ ok, time }` |
| `/api/auth/signup` | POST | — | `{ email, username, password, region, invitedBy }` | `{ token }` |
| `/api/auth/login` | POST | — | `{ email, password }` | `{ token }` |
| `/api/me` | GET | yes | — | user profile |
| `/api/rankings?metric=elo&limit=100` | GET | — | — | `{ metric, players: [...] }` |
| `/api/users/search?q=al&limit=8` | GET | yes | — | `{ users: [{ id, username, elo }] }` |
| `/api/friends` | GET | yes | — | `{ friends: [...] }` |
| `/api/friends/add` | POST | yes | `{ username }` | `{ ok, friend }` |
| `/api/games/recent` | GET | yes | — | `{ games: [...] }` |
| `/api/auth/forgot` | POST | — | `{ email }` | `{ ok, devToken? }` |
| `/api/auth/reset` | POST | — | `{ token, newPassword }` | `{ ok }` |
| `/api/auth/change-password` | POST | yes | `{ currentPassword, newPassword }` | `{ ok }` |
| `/api/progress` | GET | yes | — | `{ lessonsCompleted, puzzles }` |
| `/api/progress` | POST | yes | `{ lessonsCompleted?, puzzles? }` | merged `{ lessonsCompleted, puzzles }` |

### Learning-progress sync

Per-user learning progress is persisted in `users.flags` JSON under a `progress`
key, so it survives across devices (web vs Android). Clients should:

- `GET /api/progress` on login to hydrate local state.
- `POST /api/progress` after completing a lesson/puzzle. Posts MERGE server-side:
  `lessonsCompleted` arrays are unioned (deduped) and `puzzles` are shallow-merged.

### Password-reset email

`POST /api/auth/forgot` issues a reset token. If `RESEND_API_KEY` is set, the
token/link is emailed via [Resend](https://resend.com) (link built from
`APP_URL`). The response includes a `devToken` ONLY when `EXPOSE_RESET_TOKEN=1`
is explicitly set (a dev/test escape hatch). This is intentionally NOT keyed off
`NODE_ENV`, so a misconfigured production deploy can never leak a usable token --
`EXPOSE_RESET_TOKEN` must stay unset in production. Relevant env vars:
`RESEND_API_KEY`, `RESEND_FROM`, `APP_URL`, `EXPOSE_RESET_TOKEN`.

## WebSocket events

**Client → Server**
- `auth` `{ token }` — must be first event
- `mm_join` `{ mode: 'ranked'|'friendly' }` — enter matchmaking queue
- `mm_leave` — leave queue
- `move` `{ gameId, from, to, promotion? }`
- `resign` `{ gameId }`
- `chat` `{ gameId, text }`

**Server → Client**
- `auth_ok` `{ user }` / `auth_err` `{ error }`
- `match_found` `{ gameId, white, black, mode }`
- `move_made` `{ gameId, move, fen }`
- `illegal_move` `{ gameId, from, to }`
- `chat` `{ from, text, at }`
- `game_over` `{ gameId, winnerId, reason, whiteDelta, blackDelta, pgn }`

## Scaling (single instance by default; multi-instance via REDIS_URL)

By default (no `REDIS_URL`) the server runs as a SINGLE instance: active games,
the matchmaking queue, and presence live in process memory. `railway.json` keeps
`deploy.numReplicas: 1` for this default.

Set `REDIS_URL` to enable HORIZONTAL SCALING across multiple replicas:
- Socket.IO uses the Redis adapter, so broadcasts fan out across instances.
- Matchmaking (1v1 + 2v2/duo), live game state (board + server clocks),
  presence, disconnect-grace, reconnect/resume, and rematch are all kept in
  Redis with per-game locks, so any instance can host either player and games
  survive being spread across replicas. (See `scale-store.js` / `scale-team.js`.)

To scale: provision a Redis instance, set `REDIS_URL`, then raise
`deploy.numReplicas`. Across replicas, prefer the WebSocket transport (or enable
load-balancer session affinity) so a connection stays on one instance; the client
already prefers WebSocket. Verified with two instances + a shared Redis: players
on different instances match, exchange moves with synced clocks, reconnect on the
other instance, and rematch — for both 1v1 and 2v2.

## Persistence backends (SQLite default; PostgreSQL for horizontal scale)

Addresses audit finding **PE-M1**: the app advertises horizontal scaling (Redis
socket layer) but historically funnelled *all* persistence through a single
synchronous `better-sqlite3` file, which becomes a write-lock / event-loop
bottleneck once you run more than one replica.

There are now **two interchangeable persistence backends** behind one async
data-access facade (`store.js`):

| Backend | When | Module | Notes |
|---|---|---|---|
| **SQLite** (default) | `DATABASE_URL` unset | `db.js` | Zero config. Embedded file at `DATABASE_PATH`. What local dev and the test suite use. Behavior unchanged. |
| **PostgreSQL** (scalable) | `DATABASE_URL` set | `db-pg.js` | `node-postgres` connection pool. Scales horizontally across replicas; no single-writer file lock. |

The schema is ported 1:1 to Postgres (see `db-pg.js`). SQL translations applied:
`?` placeholders → `$1,$2,…`; `json_array_length(col)` →
`jsonb_array_length(col::jsonb)`; `LIKE … COLLATE NOCASE` → `ILIKE`;
`INSERT OR IGNORE` → `INSERT … ON CONFLICT DO NOTHING`; integer ms time columns →
`BIGINT`. Parameterized queries, the `topByMetric` allowlist, and the LIKE-escape
hardening are preserved identically on both backends. Transactions are atomic on
both (better-sqlite3 `db.transaction()` / Postgres `BEGIN`…`COMMIT` on a pooled
client with rollback on throw), exposed via `store.runTransaction(fn)`.

To enable Postgres: provision a database, set `DATABASE_URL` (and `REDIS_URL` for
the socket layer), then raise `deploy.numReplicas`. The schema is created
automatically on boot (`CREATE TABLE IF NOT EXISTS`). See `.env.example` for
`PGPOOL_MAX` / `PGSSL` tuning.

> **Migration status:** PE-M1 is now **fully closed** — with `DATABASE_URL` set,
> *all* persistence (HTTP/auth/rankings **and** the real-time live-game / ELO
> path) goes to Postgres. SQLite remains the zero-config default and its proven
> path is unchanged (validated by `npm run smoke:2v2`, `test:verify`,
> `test:rankings`).
>
> **Converted to the backend-agnostic `store.*` API (work on SQLite *and*
> Postgres):**
> - `auth.js` — `signup`, `login`, `requireAuth` (async), password reset, email
>   verification issue/verify/resend, change-password. Email upsert uses
>   `ON CONFLICT … DO UPDATE`, valid on both engines.
> - `server.js` — all HTTP routes: `/api/rankings`, `/api/users/search`, avatar,
>   friends, blocks, `/api/games/recent`, `/api/progress`.
> - `game.js`, `scale-store.js`, `scale-team.js` — the real-time matchmaking /
>   live-game path: the `getUserById` display/elo reads, the `areBlocked`
>   matchmaking predicates, and the 1v1 + 2v2 `ELO`+game-result write blocks.
>
> **Dual-path design (non-negotiable constraint):** better-sqlite3 transactions
> are **synchronous** and cannot span `await`, so the code **branches on the
> backend** rather than forcing one path:
> - When `store.usingPostgres` is **false**, the proven synchronous SQLite path
>   runs essentially byte-for-byte: direct `db.transaction(() => { … })()` with
>   synchronous `db.getUserById` / `areBlocked`. Zero behavior change.
> - When `store.usingPostgres` is **true**, an async path performs the same
>   reads/writes via the facade inside `await store.runTransaction(async (tx) => {
>   … })` (Postgres `BEGIN`/`COMMIT`/`ROLLBACK` on one pooled client; every query
>   in `fn` is bound to that transaction client). `areBlocked` is hoisted out of
>   the `.find()` matchmaking predicate into an awaited loop; reads feeding socket
>   responses use `await store.getUserById`.
>
> The shared computed values (new ELOs, win/loss/draw/streak deltas, the game
> record fields) are factored out so the two branches differ only in *how* they
> persist. SQL added on the Postgres branch is portable via the `toPg` translator
> (`?`→`$n`), with two hand-applied translations the translator does not cover:
> SQLite's 2-arg `MAX(best_streak, …)` → Postgres `GREATEST(…)`, and
> `CASE WHEN <int> THEN` → `CASE WHEN <int> = 1 THEN` (Postgres `CASE WHEN` needs
> a boolean, not a 0/1 integer).

## Architecture notes

- All moves are validated server-side using `chess.js` (the same library the client uses) — clients can't cheat by sending illegal moves
- ELO is recalculated server-side using standard K=32 formula
- Matchmaking starts with ±50 ELO tolerance, widens 25 every second, caps at ±500
- Games are kept in-memory while active, persisted to SQLite when finished
- The PGN is stored for each game — useful for the "Analyze with engine" feature
- Schema includes `is_premium` and `invites_accepted` to match the client's user shape

## Next steps

- Add reconnection handling (current state lost if a player disconnects mid-game)
- Add time controls (clocks on each side, time forfeit)
- Add tournament tables (Swiss/Arena formats)
- Add anti-cheat: time-per-move analysis, Stockfish similarity score
- Hook up Stripe for the Premium subscription
