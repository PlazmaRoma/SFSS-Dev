#!/usr/bin/env bash
# Снимает ответы sfss в src/shared/fixtures/*.json: Площадка работает и без запущенного
# сервиса. Запуск: bash sfss/playground/tools/snapshot.sh
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

echo "→ /predict — куб модели по трём осям (ползунки и цвета комнат)"
python3 "$ROOT/tools/build_predict_cube.py" "$API" "$OUT"

# Раньше здесь был свой список вопросов и другой формат файла: снимок
# затирал query_cache.json тем, что фронт прочитать не может.
echo "→ /query — 8 тем на двух языках (долго, 30-60 с каждый ответ)"
python3 "$ROOT/tools/build_query_cache.py" "$API"

echo
echo "Готово. Файлы:"
ls -lh "$OUT"
