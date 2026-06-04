#!/usr/bin/env bash
#
# refresh-www.sh - regenerate the gitignored www/ Capacitor bundle from the
# repo-root client files, re-apply the two required patches, and sync to the
# Android project. Safe to run repeatedly (idempotent patches).
#
# Usage:  bash scripts/refresh-www.sh
#
set -euo pipefail

# Always run from the repo root (parent of this script's dir).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

FILES=(
  index.html app.js academy.js sounds.js stockfish-ai.js
  chess.min.js chess960.js config.js ct-auth.js ct-net.js ct-ai.js ct-ai-worker.js ct-duo.js
  trophy-data.js puzzles-data.js puzzles.js
  review.js trophy-extras.js learn-library.js sw.js manifest.json
  terms.html privacy.html
  icon.svg icon-192.png icon-512.png icon-1024.png
)

echo "==> Refreshing www/ from repo root"
rm -rf www
mkdir -p www

# Verify every source file exists before copying.
missing=0
for f in "${FILES[@]}"; do
  if [ ! -e "$f" ]; then
    echo "    MISSING source file: $f" >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "ERROR: one or more source files are missing; aborting." >&2
  exit 1
fi

cp "${FILES[@]}" www/
echo "    copied ${#FILES[@]} files into www/"

# --- Patch 1: CSP connect-src must include the Vercel origin (idempotent) ---
if grep -q 'playchesstrophies.com' www/index.html; then
  echo "==> CSP: Vercel origin already present, skipping"
else
  sed -i "s#connect-src 'self' https://chesstrophies-production.up.railway.app wss://chesstrophies-production.up.railway.app;#connect-src 'self' https://chesstrophies-production.up.railway.app https://playchesstrophies.com wss://chesstrophies-production.up.railway.app;#" www/index.html
  if grep -q 'playchesstrophies.com' www/index.html; then
    echo "==> CSP: added Vercel origin to connect-src"
  else
    echo "ERROR: CSP patch did not apply; connect-src directive not in expected form." >&2
    exit 1
  fi
fi

# --- Patch 2: guard service-worker registration against Capacitor (idempotent) ---
# Use whichever Python is on PATH (python3 on most systems, python on Windows).
if command -v python3 >/dev/null 2>&1; then
  PYTHON=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON=python
else
  echo "ERROR: neither python3 nor python found on PATH; cannot apply SW guard patch." >&2
  exit 1
fi

"$PYTHON" - <<'PYEOF'
import sys
p = 'www/index.html'
s = open(p, encoding='utf-8').read()
guarded = "if (!window.Capacitor && 'serviceWorker' in navigator) {"
plain = "if ('serviceWorker' in navigator) {"
if guarded in s:
    print("==> SW guard: already present, skipping")
elif s.count(plain) == 1:
    s = s.replace(plain, guarded)
    open(p, 'w', encoding='utf-8').write(s)
    print("==> SW guard: wrapped service worker registration")
else:
    sys.stderr.write("ERROR: SW registration block not found in expected form (count=%d)\n" % s.count(plain))
    sys.exit(1)
PYEOF

echo "==> Syncing into Android project"
npx cap sync

echo "==> Done. www/ refreshed and synced."
