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

# Static client assets (served by express.static from /app/public)
RUN mkdir -p ./public
COPY index.html app.js academy.js puzzles.js puzzles-data.js review.js chess.min.js sounds.js stockfish-ai.js sw.js manifest.json icon.svg icon-192.png icon-512.png icon-1024.png privacy.html terms.html ./public/

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
