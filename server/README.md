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

## Scaling: single instance only

This server MUST run as a single instance (one replica). Active games, the
matchmaking queue, and Socket.IO connections are all held in process memory and
are NOT shared between instances. Running multiple replicas would split players
across isolated states — matchmaking would fail to pair, and in-game move/chat
events would not reach the opponent if they're connected to a different replica.

`railway.json` pins `deploy.numReplicas: 1` to enforce this. Before horizontal
scaling is possible, the server needs: a shared Socket.IO adapter (e.g. the
Redis adapter) so events fan out across instances, and a shared matchmaking
store (e.g. Redis) so the queue is global rather than per-process.

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
