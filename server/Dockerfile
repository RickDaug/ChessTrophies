# Build context = REPO ROOT (Railway Root Directory = /).
# Serves the API from server/ and the static client from /app/public.
FROM node:24-trixie-slim

# Native build deps for better-sqlite3 + ca-certificates/wget for the Litestream download
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

# Litestream — continuous SQLite -> object-storage backups. The binary is always
# installed but stays INERT at runtime unless LITESTREAM_REPLICA_URL is set
# (docker-entrypoint.sh then runs the server under it; otherwise plain `node server.js`).
ARG LITESTREAM_VERSION=0.3.13
# BEST-EFFORT: an optional backup tool must NEVER fail the build. If the download/
# extract fails, the image builds without litestream and the entrypoint falls back
# to plain `node server.js` (backups simply unavailable). tar extracts the whole
# archive (the binary) rather than naming a member, which is more robust.
RUN ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)" \
    && case "$ARCH" in arm64) LS_ARCH=arm64 ;; *) LS_ARCH=amd64 ;; esac \
    && ( wget -qO /tmp/litestream.tar.gz "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${LS_ARCH}.tar.gz" \
         && tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz \
         && rm -f /tmp/litestream.tar.gz \
         && litestream version ) \
    || echo "[docker] WARNING: Litestream install failed — building WITHOUT backups (entrypoint runs plain node server.js)."

WORKDIR /app

# Install server deps first (better layer caching)
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# Server source
COPY server/ ./

# Static client assets (served by express.static from /app/public).
# NOTE: keep this list in sync with the <script>/asset references in index.html.
# Docker COPY fails if ANY source is missing, so do not list deleted files
# (e.g. the removed puzzles.js/puzzles-data.js) or the build breaks.
RUN mkdir -p ./public
COPY index.html admin.html config.js app.js academy.js learn-library.js review.js trophy-extras.js chess960.js chess.min.js sounds.js stockfish-ai.js sw.js manifest.json icon.svg icon-192.png icon-512.png icon-1024.png og-image.png privacy.html terms.html \
     ct-onerror.js ct-boot.js ct-chess-check.js ct-socket-fallback.js ct-auth.js ct-net.js ct-ai.js ct-ai-worker.js trophy-data.js ct-duo.js ct-ads.js ct-sw-register.js \
     checkers.js checkers-ai.js checkers-ai-worker.js ct-checkers.js \
     ./public/
COPY vendor/ ./public/vendor/

# Server-runtime copy: the server require()s the checkers engine for move
# validation ('../checkers.js' in dev, './checkers.js' in the image, where
# server modules live at /app via `COPY server/ ./`). Placed AFTER `COPY
# server/ ./` so it lands in /app and is not overwritten by it.
COPY checkers.js ./checkers.js
# Same for the CHESS engine: server/bot.js loads chess.min.js + ct-ai.js head-less
# to power ranked bot-backfill + arena bot games. bot.js looks in /app (and /),
# but the lines above only copy these into /app/public (the client bundle), so
# without this runtime copy botEngineReady() is FALSE in the image and ranked
# never bot-backfills (a lone player waits out the 120s search → "no opponent").
COPY chess.min.js ct-ai.js ./

ENV NODE_ENV=production
EXPOSE 3000
# Entrypoint runs the server under Litestream when backups are configured, else
# plain `node server.js` (see server/docker-entrypoint.sh, copied via `COPY server/ ./`).
# NOTE: railway.json `startCommand` overrides this CMD — keep them in sync.
CMD ["sh", "docker-entrypoint.sh"]
