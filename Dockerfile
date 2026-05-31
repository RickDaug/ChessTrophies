# ChessTrophies backend (server/) — deterministic build for Railway.
# Use node:24 on Debian "trixie": GLIBC 2.41 (>=2.38 for better-sqlite3) AND
# (which requires GLIBC >= 2.38) loads at runtime. Bookworm (2.36) does not.
FROM node:24-trixie-slim

# Toolchain so better-sqlite3 can compile from source if no prebuilt matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./

ENV NODE_ENV=production
# Railway injects PORT; server.js reads process.env.PORT || 3000
EXPOSE 3000
CMD ["node", "server.js"]
