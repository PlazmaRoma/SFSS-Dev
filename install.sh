#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SFSS="$ROOT/sfss"
VENV="$SFSS/.venv"
PY="$VENV/bin/python"
TOOLS="$ROOT/.tools"
BIN="$HOME/.local/bin"
LINK="$BIN/sfss"
RELEASE="$ROOT/apps/anti-fire/release"
PYTHON_VERSION="3.12"
UV_VERSION="0.12.5"
MODEL_ID="ministral-3-3b-instruct-2512"
MODEL_MLX="https://huggingface.co/mlx-community/Ministral-3-3B-Instruct-2512-4bit"
MODEL_GGUF="https://huggingface.co/lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF"
MODEL_OLLAMA="ministral-3:3b"
OS="$(uname -s)"

usage() {
  cat <<'HELP'
Installs SFSS and Anti-Fire on macOS and Linux from a clone of the repository.

  ./install.sh              install and check
  ./install.sh --yes        answer yes to every question
  ./install.sh --no-llm     leave the language model alone
  ./install.sh --no-app     skip the Anti-Fire app
  ./install.sh --uninstall  remove everything this script installed

Python and libraries come through uv: one file, no admin rights, and it downloads
Python itself if needed. Safe to run again. Windows: install.ps1. Details: docs/install.
HELP
}

YES=""; NO_LLM=""; NO_APP=""; UNINSTALL=""
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    --no-llm) NO_LLM=1 ;;
    --no-app) NO_APP=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $arg. Help: ./install.sh --help" >&2; exit 2 ;;
  esac
done

STEP=0
step() { STEP=$((STEP + 1)); printf '\n[%s] %s\n' "$STEP" "$1"; }
note() { printf '    %s\n' "$1"; }
fail() { printf '\nError: %s\n' "$1" >&2; exit 1; }

ask() {
  [ -n "$YES" ] && return 0
  [ -t 0 ] || return 1
  printf '    %s [Y/n] ' "$1"
  read -r answer
  case "$answer" in ""|y|Y|yes|Yes|д|Д|да) return 0 ;; *) return 1 ;; esac
}

to_trash() {
  if [ "$OS" = "Darwin" ]; then
    local name ext=""; name="$(basename "$1")"
    case "$name" in *.app) ext=".app"; name="${name%.app}" ;; esac
    mkdir -p "$HOME/.Trash"
    mv "$1" "$HOME/.Trash/$name $(date +%Y-%m-%d\ %H.%M.%S)$ext"
  else
    rm -rf "$1"
  fi
}

link_is_ours() { [ -L "$LINK" ] && [ "$(readlink "$LINK")" = "$VENV/bin/sfss" ]; }

LINUX_APP="$HOME/.local/share/anti-fire"
LINUX_DESKTOP="$HOME/.local/share/applications/anti-fire.desktop"
MAC_APP="/Applications/Anti-Fire.app"

if [ -n "$UNINSTALL" ]; then
  step "Stopping SFSS"
  if [ -x "$VENV/bin/sfss" ]; then "$VENV/bin/sfss" stop || true; else note "not installed"; fi

  step "Removing the sfss command"
  if link_is_ours; then rm "$LINK"; note "removed $LINK"
  elif [ -e "$LINK" ]; then note "$LINK points to another install, leaving it"
  else note "it was not there"; fi

  step "Removing the environment, search model and daemon state"
  if [ -x "$TOOLS/uv" ]; then
    "$TOOLS/uv" cache clean >/dev/null 2>&1 || true
    "$TOOLS/uv" python uninstall --all >/dev/null 2>&1 || true
    note "removed the uv cache and the Python it downloaded"
  fi
  rm -rf "$VENV" "$SFSS/data/embedding" "$SFSS/data/run" "$SFSS/data/chroma" "$TOOLS" "$SFSS"/*.egg-info
  note "done"

  step "Removing Anti-Fire"
  found=""
  if [ "$OS" = "Darwin" ]; then
    pkill -f "$MAC_APP/Contents/MacOS/anti-fire" 2>/dev/null || true
    for path in "$MAC_APP" "$HOME/Library/Caches/org.twinbyte.antifire" "$HOME/Library/WebKit/org.twinbyte.antifire"; do
      if [ -e "$path" ]; then to_trash "$path"; note "moved to Trash: $path"; found=1; fi
    done
  else
    pkill -f "$LINUX_APP/anti-fire" 2>/dev/null || true
    for path in "$LINUX_APP" "$LINUX_DESKTOP" "$BIN/anti-fire" "$HOME/.local/share/org.twinbyte.antifire" "$HOME/.cache/org.twinbyte.antifire"; do
      if [ -e "$path" ] || [ -L "$path" ]; then rm -rf "$path"; note "removed: $path"; found=1; fi
    done
  fi
  [ -n "$found" ] || note "it was not there"

  OLD_MODEL="$HOME/.cache/huggingface/hub/models--sentence-transformers--paraphrase-multilingual-MiniLM-L12-v2"
  if [ -d "$OLD_MODEL" ]; then
    step "Search model from the previous version"
    note "470 MB left in $OLD_MODEL"
    if ask "Remove it?"; then rm -rf "$OLD_MODEL"; note "removed"; fi
  fi

  printf '\nDone. Kept: the clone in %s, NASA reports, the index, sfss/.env and model settings.\n' "$ROOT"
  note "The language model in LM Studio or Ollama is untouched: remove it there."
  exit 0
fi

printf 'Installing SFSS from %s\n' "$ROOT"

step "Package installer uv"
UV="$(command -v uv || true)"
[ -z "$UV" ] && [ -x "$TOOLS/uv" ] && UV="$TOOLS/uv"
if [ -z "$UV" ]; then
  note "downloading uv $UV_VERSION, about 20 MB, into $TOOLS"
  if command -v curl >/dev/null; then fetch="curl -LsSf"; else fetch="wget -qO-"; fi
  $fetch "https://astral.sh/uv/$UV_VERSION/install.sh" | env UV_UNMANAGED_INSTALL="$TOOLS" sh >/dev/null \
    || fail "Could not download uv. Check the network and run the installer again."
  UV="$TOOLS/uv"
fi
note "$("$UV" --version)"

step "Python $PYTHON_VERSION and SFSS libraries, about 100 MB"
if [ -x "$PY" ] && ! "$PY" -c "import sys; sys.exit(sys.version_info[:2] != (3, 12))" 2>/dev/null; then
  note "the environment uses another Python version, recreating it"
  rm -rf "$VENV"
fi
if [ ! -x "$PY" ]; then
  "$UV" venv --python "$PYTHON_VERSION" "$VENV" \
    || fail "Could not create the Python environment. Check the network and run the installer again."
fi
"$UV" pip install --python "$PY" -e "$SFSS" \
  || fail "Libraries did not install. Check the network and run the installer again: downloads are kept."
note "done: $VENV"

step "Settings"
if [ -f "$SFSS/.env" ]; then note "sfss/.env already exists, leaving it"
else cp "$SFSS/.env.example" "$SFSS/.env"; note "created sfss/.env"; fi

step "Search model for the reports, 130 MB, once"
( cd "$SFSS" && "$PY" -m app.services.embedder ) \
  || fail "Could not download the search model. Check the network and run the installer again."

step "Index of the NASA reports"
if [ -f "$SFSS/data/index/chunks.jsonl" ]; then
  note "ready, from the repository"
else
  note "not found, building it, about a minute"
  ( cd "$SFSS" && "$PY" scripts/ingest_documents.py >/dev/null 2>&1 ) \
    || fail "Could not build the index. By hand: cd sfss && .venv/bin/python scripts/ingest_documents.py"
fi

step "The sfss command"
mkdir -p "$BIN"
if [ -e "$LINK" ] && ! link_is_ours; then
  note "$LINK already points elsewhere: $(readlink "$LINK" 2>/dev/null || echo 'a regular file')"
  if ask "Switch it to this install?"; then ln -sf "$VENV/bin/sfss" "$LINK"; fi
else
  ln -sf "$VENV/bin/sfss" "$LINK"
fi
note "$LINK"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *)
    case "${SHELL:-}" in */zsh) rc="~/.zshrc" ;; */bash) rc="~/.bashrc" ;; *) rc="your shell startup file" ;; esac
    note "$BIN is not in PATH. Add this line to $rc and open a new terminal:"
    note "    export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac

APP_STATE="skipped"
if [ -z "$NO_APP" ]; then
  step "Anti-Fire app"
  if [ "$OS" = "Darwin" ]; then
    DMG="$(ls "$RELEASE"/Anti-Fire-macos-*.dmg 2>/dev/null | head -1 || true)"
    if [ -z "$DMG" ]; then
      note "no ready build in $RELEASE. Build it: bash apps/anti-fire/build.sh --install"
    elif ask "Install Anti-Fire into Applications?"; then
      MOUNT="$(mktemp -d)"
      hdiutil attach -nobrowse -readonly -quiet -mountpoint "$MOUNT" "$DMG" || fail "Could not open $DMG"
      pkill -f "$MAC_APP/Contents/MacOS/anti-fire" 2>/dev/null || true
      if [ -e "$MAC_APP" ]; then to_trash "$MAC_APP"; note "previous version moved to Trash"; fi
      ditto "$MOUNT/Anti-Fire.app" "$MAC_APP"
      hdiutil detach -quiet "$MOUNT" || true
      APP_STATE="$MAC_APP"
      note "$MAC_APP"
    else
      note "skipped"
    fi
  elif [ "$(uname -m)" = "x86_64" ]; then
    TGZ="$RELEASE/Anti-Fire-linux-x86_64.tar.gz"
    if [ ! -f "$TGZ" ]; then
      note "no ready build in $RELEASE. Build it: bash apps/anti-fire/build.sh"
    elif ask "Install Anti-Fire into ~/.local/share/anti-fire?"; then
      rm -rf "$LINUX_APP"; mkdir -p "$LINUX_APP" "$(dirname "$LINUX_DESKTOP")"
      tar -xzf "$TGZ" -C "$LINUX_APP" --strip-components=1
      cp "$ROOT/apps/anti-fire/src-tauri/icons/128x128.png" "$LINUX_APP/icon.png"
      ln -sf "$LINUX_APP/anti-fire" "$BIN/anti-fire"
      cat > "$LINUX_DESKTOP" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Anti-Fire
Comment=Combustion in microgravity: calculations and NASA reports, a client of SFSS
Exec=$LINUX_APP/anti-fire
Icon=$LINUX_APP/icon.png
Categories=Science;Education;
Terminal=false
DESKTOP
      APP_STATE="$BIN/anti-fire, also in the applications menu"
      note "$APP_STATE"
      libraries="$( (ldconfig -p || /sbin/ldconfig -p) 2>/dev/null || true)"
      if [ -n "$libraries" ] && [[ "$libraries" != *libwebkit2gtk-4.1* ]]; then
        note "The window needs the WebKitGTK 4.1 library:"
        note "    Fedora: sudo dnf install webkit2gtk4.1    Ubuntu: sudo apt install libwebkit2gtk-4.1-0"
      fi
    else
      note "skipped"
    fi
  else
    note "no ready build for $(uname -m). Build it: bash apps/anti-fire/build.sh"
  fi
fi

LLM_STATE="skipped"
if [ -z "$NO_LLM" ]; then
  step "Language model for answering questions"
  LMS="$(command -v lms || true)"
  [ -z "$LMS" ] && [ -x "$HOME/.lmstudio/bin/lms" ] && LMS="$HOME/.lmstudio/bin/lms"
  OLLAMA="$(command -v ollama || true)"
  for place in /opt/homebrew/bin/ollama /usr/local/bin/ollama /Applications/Ollama.app/Contents/Resources/ollama; do
    [ -z "$OLLAMA" ] && [ -x "$place" ] && OLLAMA="$place"
  done

  if [ -n "$LMS" ]; then
    note "found LM Studio: $LMS"
    models="$("$LMS" ls 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)"
    if [[ "$models" == *"$MODEL_ID"* ]]; then
      note "model $MODEL_ID is already downloaded"; LLM_STATE="LM Studio, $MODEL_ID"
    elif ask "Download Ministral 3B, about 3 GB?"; then
      if [ "$OS-$(uname -m)" = "Darwin-arm64" ]; then source_url="$MODEL_MLX"; else source_url="$MODEL_GGUF"; fi
      if "$LMS" get "$source_url" --yes; then LLM_STATE="LM Studio, $MODEL_ID"
      else note "download failed. By hand: lms get $source_url"; LLM_STATE="LM Studio, no model"; fi
    else
      note "later: lms get $MODEL_MLX"; LLM_STATE="LM Studio, no model"
    fi
  elif [ -n "$OLLAMA" ]; then
    note "found Ollama: $OLLAMA"
    have_model=""
    models="$("$OLLAMA" list 2>/dev/null || true)"
    if [[ $'\n'"$models" == *$'\n'"$MODEL_OLLAMA"* ]]; then
      note "model $MODEL_OLLAMA is already downloaded"; have_model=1
    elif ask "Download $MODEL_OLLAMA, about 3 GB?"; then
      if "$OLLAMA" pull "$MODEL_OLLAMA"; then have_model=1; else note "download failed. By hand: ollama pull $MODEL_OLLAMA"; fi
    fi
    "$VENV/bin/sfss" config runtime ollama >/dev/null
    if [ -n "$have_model" ]; then
      "$VENV/bin/sfss" config model "$MODEL_OLLAMA" >/dev/null
      LLM_STATE="Ollama, $MODEL_OLLAMA"
    else
      note "later: ollama pull $MODEL_OLLAMA && sfss config model $MODEL_OLLAMA"; LLM_STATE="Ollama, no model"
    fi
  else
    note "Neither LM Studio nor Ollama found. Calculations, CSV and the Playground work without a model."
    note "To answer questions, install one of them and run ./install.sh again:"
    note "    LM Studio  https://lmstudio.ai"
    note "    Ollama     https://ollama.com"
    LLM_STATE="not found"
  fi
fi

step "Starting and checking"
"$VENV/bin/sfss" start || fail "SFSS did not start. The reason is in the log: $VENV/bin/sfss logs"
"$VENV/bin/sfss" predict --o2 0.30 --psi 8.2 | sed 's/^/    /' \
  || fail "The calculation did not answer. Log: $VENV/bin/sfss logs"

cat <<EOF

Done. SFSS is installed and running.
    Anti-Fire:  $APP_STATE
    Model:      $LLM_STATE

    sfss status                      what is running
    sfss predict --o2 0.30 --psi 8.2 a calculation
    sfss ask "How does helium in the atmosphere affect combustion?"
    sfss playground                  the Playground in a browser
    sfss stop                        stop the service
    ./install.sh --uninstall         remove everything

Details: docs/install/macos.md, docs/install/linux.md
EOF
