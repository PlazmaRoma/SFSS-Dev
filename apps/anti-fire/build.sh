#!/usr/bin/env bash
# Собирает приложение Anti-Fire: страница в один HTML, вокруг окно Tauri.
#
#   bash apps/anti-fire/build.sh              собрать под эту машину
#   bash apps/anti-fire/build.sh --universal  macOS: сразу под Intel и Apple Silicon
#   bash apps/anti-fire/build.sh --install    macOS: собрать и положить в /Applications
#
# Rust скрипт ставит сам, в ~/.cargo, без sudo. Node 22+ нужен заранее.
# На Linux до сборки нужны системные библиотеки, см. docs/install/linux.md.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"

UNIVERSAL=""; INSTALL=""
for arg in "$@"; do
  case "$arg" in
    --universal) UNIVERSAL=1 ;;
    --install) INSTALL=1 ;;
    *) echo "Неизвестный параметр: $arg" >&2; exit 2 ;;
  esac
done

command -v node >/dev/null || { echo "Нет Node.js. Поставьте версию 22 или новее: https://nodejs.org" >&2; exit 1; }
if ! command -v cargo >/dev/null; then
  echo "→ ставлю Rust в ~/.cargo (один раз, пара минут)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal >/dev/null
  export PATH="$HOME/.cargo/bin:$PATH"
fi
[ -d "$ROOT/node_modules" ] || ( echo "→ ставлю зависимости Node"; cd "$ROOT" && npm ci >/dev/null )

echo "→ собираю страницу и вплавляю её в окно"
( cd "$HERE" && npm run --silent page )

echo "→ собираю приложение (первый раз около десяти минут)"
if [ -n "$UNIVERSAL" ]; then
  rustup target add x86_64-apple-darwin aarch64-apple-darwin >/dev/null 2>&1 || true
  ( cd "$HERE" && npx tauri build --target universal-apple-darwin )
  TARGET="$HERE/src-tauri/target/universal-apple-darwin/release"
else
  ( cd "$HERE" && npx tauri build )
  TARGET="$HERE/src-tauri/target/release"
fi

find "$TARGET/bundle" -maxdepth 2 \( -name '*.app' -o -name '*.dmg' -o -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' -o -name '*.exe' -o -name '*.msi' \) | while read -r f; do
  echo "→ $f  ($(du -sh "$f" | cut -f1))"
done

if [ -n "$INSTALL" ]; then
  [ "$(uname -s)" = "Darwin" ] || { echo "--install работает только на macOS" >&2; exit 1; }
  APP="/Applications/Anti-Fire.app"
  pkill -f "$APP/Contents/MacOS/anti-fire" 2>/dev/null || true
  # Старая версия уходит в Корзину, а не затирается: поверх копировать нельзя, файлы смешаются
  if [ -e "$APP" ]; then
    mv "$APP" "$HOME/.Trash/Anti-Fire $(date +%Y-%m-%d\ %H.%M.%S).app"
    echo "→ прежняя версия в Корзине"
  fi
  cp -R "$TARGET/bundle/macos/Anti-Fire.app" "$APP"
  echo "→ установлено: $APP"
fi
