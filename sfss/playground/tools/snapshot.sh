#!/usr/bin/env bash
set -u
API="${API:-http://localhost:8000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src/shared/fixtures"
mkdir -p "$OUT"
pp() { python3 -m json.tool --no-ensure-ascii 2>/dev/null || cat; }

echo "→ /health"
curl -s -m 20 "$API/health" | pp > "$OUT/health.json"

echo "→ /dashboard"
curl -s -m 60 "$API/dashboard" | pp > "$OUT/dashboard.json"

echo "→ /predict: model cube over three axes (sliders and room colours)"
python3 "$ROOT/tools/build_predict_cube.py" "$API" "$OUT"

echo "→ /query: 8 topics in two languages (slow, 30-60 s per answer)"
python3 "$ROOT/tools/build_query_cache.py" "$API"

echo
echo "Done. Files:"
ls -lh "$OUT"
