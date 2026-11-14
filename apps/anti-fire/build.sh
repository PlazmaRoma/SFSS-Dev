#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"

UNIVERSAL=""; INSTALL=""
for arg in "$@"; do
  case "$arg" in
    --universal) UNIVERSAL=1 ;;
    --install) INSTALL=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

command -v node >/dev/null || { echo "Node.js not found. Install version 22 or newer: https://nodejs.org" >&2; exit 1; }
if ! command -v cargo >/dev/null; then
  echo "→ installing Rust into ~/.cargo (once, a couple of minutes)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal >/dev/null
  export PATH="$HOME/.cargo/bin:$PATH"
fi
[ -d "$ROOT/node_modules" ] || ( echo "→ installing Node dependencies"; cd "$ROOT" && npm ci >/dev/null )

echo "→ building the page into the window"
( cd "$HERE" && npm run --silent page )

echo "→ building the app (about ten minutes the first time)"
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
  [ "$(uname -s)" = "Darwin" ] || { echo "--install works on macOS only" >&2; exit 1; }
  APP="/Applications/Anti-Fire.app"
  pkill -f "$APP/Contents/MacOS/anti-fire" 2>/dev/null || true
  if [ -e "$APP" ]; then
    mv "$APP" "$HOME/.Trash/Anti-Fire $(date +%Y-%m-%d\ %H.%M.%S).app"
    echo "→ previous version moved to Trash"
  fi
  cp -R "$TARGET/bundle/macos/Anti-Fire.app" "$APP"
  echo "→ installed: $APP"
fi
