#!/usr/bin/env bash
# Собирает приложение Anti-Fire: страница в один HTML, вокруг окно Tauri.
#
# Запуск из любой папки: bash apps/anti-fire/build.sh [--universal]
# --universal: сборка сразу под Intel и Apple Silicon.
#
# Зависимости ставятся один раз из корня репозитория: npm ci.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
INLINE="$ROOT/sfss/playground/tools/inline.mjs"
export PATH="$HOME/.cargo/bin:$PATH"

command -v cargo >/dev/null || { echo "нет Rust: curl https://sh.rustup.rs -sSf | sh"; exit 1; }
[ -d "$ROOT/node_modules" ] || ( cd "$ROOT" && npm ci >/dev/null )

echo "→ собираю страницу и вплавляю её в окно"
mkdir -p "$HERE/dist"
( cd "$HERE" && npx vite build >/dev/null && node "$INLINE" dist-build "$HERE/dist/index.html" index.html )

echo "→ собираю приложение"
if [ "${1:-}" = "--universal" ]; then
  rustup target add x86_64-apple-darwin aarch64-apple-darwin >/dev/null 2>&1 || true
  ( cd "$HERE" && npx tauri build --target universal-apple-darwin )
  BUNDLE="$HERE/src-tauri/target/universal-apple-darwin/release/bundle"
else
  ( cd "$HERE" && npx tauri build )
  BUNDLE="$HERE/src-tauri/target/release/bundle"
fi

find "$BUNDLE" -maxdepth 2 \( -name '*.app' -o -name '*.dmg' \) | while read -r f; do
  echo "→ $f  ($(du -sh "$f" | cut -f1))"
done
