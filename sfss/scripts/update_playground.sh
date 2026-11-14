#!/usr/bin/env bash
# Обновляет Площадку, которая идёт в комплекте с sfss: app/static/playground/index.html.
#
# Собранный файл хранится в git, поэтому для работы sfss не нужен Node. Запускать после
# изменений в sfss/playground. Зависимости ставятся один раз из корня репозитория: npm ci.
# VITE_API="" значит запросы к тому же адресу, с которого открыта страница: порт
# демона может быть любым.
#
# Запуск: bash sfss/scripts/update_playground.sh
set -euo pipefail

SFSS="$(cd "$(dirname "$0")/.." && pwd)"
FRONT="$SFSS/playground"
OUT="$SFSS/app/static/playground/index.html"

[ -d "$SFSS/../node_modules" ] || ( cd "$SFSS/.." && npm ci >/dev/null )

mkdir -p "$(dirname "$OUT")"
cd "$FRONT"
VITE_API="" npx vite build --config vite.config.program.ts >/dev/null
node tools/inline.mjs dist-program "$OUT"
