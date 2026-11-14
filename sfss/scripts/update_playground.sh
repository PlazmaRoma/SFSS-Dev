#!/usr/bin/env bash
set -euo pipefail

SFSS="$(cd "$(dirname "$0")/.." && pwd)"
FRONT="$SFSS/playground"
OUT="$SFSS/app/static/playground/index.html"

[ -d "$SFSS/../node_modules" ] || ( cd "$SFSS/.." && npm ci >/dev/null )

mkdir -p "$(dirname "$OUT")"
cd "$FRONT"
VITE_API="" npx vite build --config vite.config.program.ts >/dev/null
node tools/inline.mjs dist-program "$OUT"
