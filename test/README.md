# Tests

## `smoke-2v2.mjs` — online 2v2 end-to-end smoke test

Regression guard for real-time online play. It boots the **real** backend
(`server/`) on a throwaway SQLite DB and a free port, serves the **real** web
client, and drives **four isolated browser sessions** through the full flow:

```
signup → socket auth → join 2v2 queue → server match → 4 alternating moves
```

and asserts the game stays server-authoritative and in sync across all four
clients (seat rotation w0 → b0 → w1 → b1).

It exists because of the 2026-06-01 **JWT-drop bug**: the login/signup handlers
overwrote the session and dropped the auth token, so the game socket never
connected and *all* online play (1v1 and 2v2) silently failed. REST-only and
single-player checks couldn't see it — only a live 4-client run does.

### Run

```bash
# one-time setup
cd server && npm i && cd ..      # backend deps (incl. the socket.io client dist)
npx playwright install chromium  # browser used to drive the 4 sessions

# run it
npm run smoke:2v2
```

Exits **0** on PASS, **1** on FAIL, with a per-step log. No app code is modified
to run it — the only harness shims are widening the served `index.html` CSP
`connect-src` to allow the local backend (the same thing
`scripts/refresh-www.sh` does for the Vercel origin) and serving socket.io's
client from the local install instead of the CDN.

### Notes

- The backend's `authLimiter` allows 20 auth attempts / 15 min / IP. Each run
  uses 4 signups against a fresh server instance, so the in-memory limiter is
  clean every time.
- Everything (server process, static client server, temp DB) is torn down on
  exit, including on failure.
