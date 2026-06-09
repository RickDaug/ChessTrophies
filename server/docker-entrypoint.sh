#!/bin/sh
# ChessTrophies API entrypoint.
#
# When Litestream backups are configured (LITESTREAM_REPLICA_URL set + the litestream
# binary present), this restores the SQLite DB from the replica if the local volume is
# empty, then runs the server UNDER litestream so the DB is continuously replicated to
# object storage. Otherwise it boots the server exactly as before (plain `node server.js`),
# so an unconfigured deploy is byte-for-byte the previous behaviour — backups are opt-in.
#
# Activate (owner): create an S3-compatible bucket (S3 / Cloudflare R2 / B2) and set on Railway:
#   LITESTREAM_REPLICA_URL=s3://<bucket>/chesstrophies
#   LITESTREAM_ACCESS_KEY_ID=<key>   LITESTREAM_SECRET_ACCESS_KEY=<secret>
#   AWS S3 also: AWS_REGION=<bucket region>.  R2/B2/MinIO also: LITESTREAM_ENDPOINT=
#     https://<account>.r2.cloudflarestorage.com  (we inject it into the config below;
#     AWS S3 needs no endpoint, so the base config stays endpoint-free).
set -u

DB_PATH="${DATABASE_PATH:-/app/data.db}"
export LITESTREAM_DB_PATH="$DB_PATH"

if [ -n "${LITESTREAM_REPLICA_URL:-}" ] && command -v litestream >/dev/null 2>&1; then
  echo "[litestream] backups ENABLED (db=$DB_PATH replica=$LITESTREAM_REPLICA_URL)"
  CFG=/app/litestream.yml
  # R2 / B2 / MinIO need an S3-compatible endpoint; AWS S3 does NOT. When
  # LITESTREAM_ENDPOINT is set, regenerate the config with it (litestream still
  # expands ${LITESTREAM_DB_PATH}/${LITESTREAM_REPLICA_URL} at runtime — we keep
  # those literal here). Plain AWS S3 keeps using the endpoint-free base config.
  if [ -n "${LITESTREAM_ENDPOINT:-}" ]; then
    cat > /tmp/litestream.yml <<EOF
dbs:
  - path: \${LITESTREAM_DB_PATH}
    replicas:
      - url: \${LITESTREAM_REPLICA_URL}
        endpoint: $LITESTREAM_ENDPOINT
EOF
    CFG=/tmp/litestream.yml
    echo "[litestream] S3-compatible endpoint: $LITESTREAM_ENDPOINT"
  fi
  if [ ! -f "$DB_PATH" ]; then
    echo "[litestream] local DB missing — attempting restore from replica…"
    if litestream restore -config "$CFG" -if-replica-exists -o "$DB_PATH" "$DB_PATH"; then
      echo "[litestream] restore complete"
    else
      echo "[litestream] no prior backup found — starting fresh"
    fi
  fi
  exec litestream replicate -config "$CFG" -exec "node server.js"
else
  echo "[litestream] backups DISABLED — set LITESTREAM_REPLICA_URL + S3 creds to enable continuous SQLite backups"
  exec node server.js
fi
