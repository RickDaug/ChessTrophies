# Build context = REPO ROOT (Railway Root Directory = /).
# Serves the API from server/ and the static client from /app/public.
FROM node:24-trixie-slim

# Native build deps for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

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

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
