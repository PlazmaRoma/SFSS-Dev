#!/usr/bin/env bash
# Установка SFSS и Anti-Fire на macOS и Linux из клона репозитория.
#
#   ./install.sh              поставить и проверить
#   ./install.sh --yes        не задавать вопросов, на всё отвечать «да»
#   ./install.sh --no-llm     не трогать нейросеть
#   ./install.sh --no-app     не ставить программу Anti-Fire
#   ./install.sh --uninstall  убрать всё, что поставил этот скрипт
#
# Python и библиотеки ставит uv: один файл, без прав администратора, Python сам
# скачивает, если его нет. Повторный запуск безопасен. Windows: install.ps1.
# Подробности: INSTALL.md.
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

YES=""; NO_LLM=""; NO_APP=""; UNINSTALL=""
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    --no-llm) NO_LLM=1 ;;
    --no-app) NO_APP=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Неизвестный параметр: $arg. Справка: ./install.sh --help" >&2; exit 2 ;;
  esac
done

STEP=0
step() { STEP=$((STEP + 1)); printf '\n[%s] %s\n' "$STEP" "$1"; }
note() { printf '    %s\n' "$1"; }
fail() { printf '\nОшибка: %s\n' "$1" >&2; exit 1; }

ask() {
  # «да» по умолчанию; без терминала (CI, конвейер) и без --yes отвечаем «нет»
  [ -n "$YES" ] && return 0
  [ -t 0 ] || return 1
  printf '    %s [Д/н] ' "$1"
  read -r answer
  case "$answer" in ""|д|Д|да|Да|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

to_trash() {
  # macOS: в Корзину, чтобы можно было вернуть. На Linux общей Корзины нет: удаляем
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

# --- Удаление ----------------------------------------------------------------

if [ -n "$UNINSTALL" ]; then
  step "Останавливаю SFSS"
  if [ -x "$VENV/bin/sfss" ]; then "$VENV/bin/sfss" stop || true; else note "не установлен"; fi

  step "Убираю команду sfss"
  if link_is_ours; then rm "$LINK"; note "удалена $LINK"
  elif [ -e "$LINK" ]; then note "$LINK ведёт в другую установку, не трогаю"
  else note "её и не было"; fi

  step "Убираю окружение, модель поиска и состояние демона"
  if [ -x "$TOOLS/uv" ]; then
    # uv ставил этот скрипт, значит его кэш и скачанный Python тоже наши
    "$TOOLS/uv" cache clean >/dev/null 2>&1 || true
    "$TOOLS/uv" python uninstall --all >/dev/null 2>&1 || true
    note "кэш uv и скачанный им Python удалены"
  fi
  rm -rf "$VENV" "$SFSS/data/embedding" "$SFSS/data/run" "$SFSS/data/chroma" "$TOOLS" "$SFSS"/*.egg-info
  note "готово"

  step "Убираю Anti-Fire"
  found=""
  if [ "$OS" = "Darwin" ]; then
    pkill -f "$MAC_APP/Contents/MacOS/anti-fire" 2>/dev/null || true
    for path in "$MAC_APP" "$HOME/Library/Caches/org.twinbyte.antifire" "$HOME/Library/WebKit/org.twinbyte.antifire"; do
      if [ -e "$path" ]; then to_trash "$path"; note "в Корзине: $path"; found=1; fi
    done
  else
    pkill -f "$LINUX_APP/anti-fire" 2>/dev/null || true
    for path in "$LINUX_APP" "$LINUX_DESKTOP" "$BIN/anti-fire" "$HOME/.local/share/org.twinbyte.antifire" "$HOME/.cache/org.twinbyte.antifire"; do
      if [ -e "$path" ] || [ -L "$path" ]; then rm -rf "$path"; note "удалено: $path"; found=1; fi
    done
  fi
  [ -n "$found" ] || note "её и не было"

  OLD_MODEL="$HOME/.cache/huggingface/hub/models--sentence-transformers--paraphrase-multilingual-MiniLM-L12-v2"
  if [ -d "$OLD_MODEL" ]; then
    step "Модель поиска от прежней версии"
    note "осталось 470 МБ: $OLD_MODEL"
    if ask "Удалить?"; then rm -rf "$OLD_MODEL"; note "удалена"; fi
  fi

  printf '\nГотово. Остались: клон в %s, отчёты NASA, индекс, sfss/.env и настройки нейросети.\n' "$ROOT"
  note "Нейросеть в LM Studio или Ollama не тронута: её удаляют там же."
  exit 0
fi

printf 'Установка SFSS из %s\n' "$ROOT"

# --- 1. uv -------------------------------------------------------------------

step "Установщик пакетов uv"
UV="$(command -v uv || true)"
[ -z "$UV" ] && [ -x "$TOOLS/uv" ] && UV="$TOOLS/uv"
if [ -z "$UV" ]; then
  note "скачиваю uv $UV_VERSION, около 20 МБ, в $TOOLS"
  # UV_UNMANAGED_INSTALL: только в эту папку, файлы оболочки и PATH не трогаются
  if command -v curl >/dev/null; then fetch="curl -LsSf"; else fetch="wget -qO-"; fi
  $fetch "https://astral.sh/uv/$UV_VERSION/install.sh" | env UV_UNMANAGED_INSTALL="$TOOLS" sh >/dev/null \
    || fail "uv не скачался. Проверьте сеть и запустите установку снова."
  UV="$TOOLS/uv"
fi
note "$("$UV" --version)"

# --- 2. Python и библиотеки --------------------------------------------------

step "Python $PYTHON_VERSION и библиотеки SFSS, около 100 МБ"
if [ -x "$PY" ] && ! "$PY" -c "import sys; sys.exit(sys.version_info[:2] != (3, 12))" 2>/dev/null; then
  note "окружение от другой версии Python, пересоздаю"
  rm -rf "$VENV"
fi
if [ ! -x "$PY" ]; then
  # Если Python 3.12 на машине нет, uv скачает его сам, около 20 МБ
  "$UV" venv --python "$PYTHON_VERSION" "$VENV" \
    || fail "Не создалось окружение Python. Проверьте сеть и запустите установку снова."
fi
"$UV" pip install --python "$PY" -e "$SFSS" \
  || fail "Библиотеки не поставились. Проверьте сеть и запустите установку снова: скачанное не пропадёт."
note "готово: $VENV"

# --- 3. Настройки ------------------------------------------------------------

step "Настройки"
if [ -f "$SFSS/.env" ]; then note "sfss/.env уже есть, не трогаю"
else cp "$SFSS/.env.example" "$SFSS/.env"; note "создан sfss/.env"; fi

# --- 4. Модель поиска --------------------------------------------------------

step "Модель поиска по отчётам, 130 МБ, один раз"
( cd "$SFSS" && "$PY" -m app.services.embedder ) \
  || fail "Модель поиска не скачалась. Проверьте сеть и запустите установку снова."

# --- 5. Индекс ---------------------------------------------------------------

step "Индекс по отчётам NASA"
if [ -f "$SFSS/data/index/chunks.jsonl" ]; then
  note "готовый, из репозитория"
else
  note "его нет в папке, собираю, около минуты"
  ( cd "$SFSS" && "$PY" scripts/ingest_documents.py >/dev/null 2>&1 ) \
    || fail "Индекс не собрался. Вручную: cd sfss && .venv/bin/python scripts/ingest_documents.py"
fi

# --- 6. Команда sfss ---------------------------------------------------------

step "Команда sfss"
mkdir -p "$BIN"
if [ -e "$LINK" ] && ! link_is_ours; then
  note "$LINK уже ведёт в другое место: $(readlink "$LINK" 2>/dev/null || echo 'это файл')"
  if ask "Переключить на эту установку?"; then ln -sf "$VENV/bin/sfss" "$LINK"; fi
else
  ln -sf "$VENV/bin/sfss" "$LINK"
fi
note "$LINK"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *)
    case "${SHELL:-}" in */zsh) rc="~/.zshrc" ;; */bash) rc="~/.bashrc" ;; *) rc="файл настроек вашей оболочки" ;; esac
    note "Папки $BIN нет в PATH. Добавьте в $rc строку и откройте новый терминал:"
    note "    export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac

# --- 7. Anti-Fire ------------------------------------------------------------

APP_STATE="пропущена"
if [ -z "$NO_APP" ]; then
  step "Программа Anti-Fire"
  if [ "$OS" = "Darwin" ]; then
    DMG="$(ls "$RELEASE"/Anti-Fire-macos-*.dmg 2>/dev/null | head -1 || true)"
    if [ -z "$DMG" ]; then
      note "готовой сборки в $RELEASE нет. Собрать: bash apps/anti-fire/build.sh --install"
    elif ask "Поставить Anti-Fire в «Программы»?"; then
      MOUNT="$(mktemp -d)"
      hdiutil attach -nobrowse -readonly -quiet -mountpoint "$MOUNT" "$DMG" || fail "Не открылся $DMG"
      pkill -f "$MAC_APP/Contents/MacOS/anti-fire" 2>/dev/null || true
      # Старая версия уходит в Корзину: копировать поверх нельзя, файлы смешаются
      if [ -e "$MAC_APP" ]; then to_trash "$MAC_APP"; note "прежняя версия в Корзине"; fi
      ditto "$MOUNT/Anti-Fire.app" "$MAC_APP"
      hdiutil detach -quiet "$MOUNT" || true
      APP_STATE="$MAC_APP"
      note "$MAC_APP"
    fi
  elif [ "$(uname -m)" = "x86_64" ]; then
    TGZ="$RELEASE/Anti-Fire-linux-x86_64.tar.gz"
    if [ ! -f "$TGZ" ]; then
      note "готовой сборки в $RELEASE нет. Собрать: bash apps/anti-fire/build.sh"
    elif ask "Поставить Anti-Fire в ~/.local/share/anti-fire?"; then
      rm -rf "$LINUX_APP"; mkdir -p "$LINUX_APP" "$(dirname "$LINUX_DESKTOP")"
      tar -xzf "$TGZ" -C "$LINUX_APP" --strip-components=1
      cp "$ROOT/apps/anti-fire/src-tauri/icons/128x128.png" "$LINUX_APP/icon.png"
      ln -sf "$LINUX_APP/anti-fire" "$BIN/anti-fire"
      cat > "$LINUX_DESKTOP" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Anti-Fire
Comment=Горение в невесомости: расчёт и отчёты NASA, клиент SFSS
Exec=$LINUX_APP/anti-fire
Icon=$LINUX_APP/icon.png
Categories=Science;Education;
Terminal=false
DESKTOP
      APP_STATE="$BIN/anti-fire, есть в меню программ"
      note "$APP_STATE"
      if command -v ldconfig >/dev/null && ! ldconfig -p 2>/dev/null | grep -q 'libwebkit2gtk-4.1'; then
        note "Для окна нужна библиотека WebKitGTK 4.1:"
        note "    Fedora: sudo dnf install webkit2gtk4.1    Ubuntu: sudo apt install libwebkit2gtk-4.1-0"
      fi
    fi
  else
    note "готовой сборки под $(uname -m) нет. Собрать: bash apps/anti-fire/build.sh"
  fi
fi

# --- 8. Нейросеть ------------------------------------------------------------

LLM_STATE="пропущена"
if [ -z "$NO_LLM" ]; then
  step "Нейросеть для ответов на вопросы"
  LMS="$(command -v lms || true)"
  [ -z "$LMS" ] && [ -x "$HOME/.lmstudio/bin/lms" ] && LMS="$HOME/.lmstudio/bin/lms"
  OLLAMA="$(command -v ollama || true)"
  for place in /opt/homebrew/bin/ollama /usr/local/bin/ollama /Applications/Ollama.app/Contents/Resources/ollama; do
    [ -z "$OLLAMA" ] && [ -x "$place" ] && OLLAMA="$place"
  done

  if [ -n "$LMS" ]; then
    note "найден LM Studio: $LMS"
    if "$LMS" ls 2>/dev/null | grep -qi "$MODEL_ID"; then
      note "модель $MODEL_ID уже скачана"; LLM_STATE="LM Studio, $MODEL_ID"
    elif ask "Скачать Ministral 3B, около 3 ГБ?"; then
      if [ "$OS-$(uname -m)" = "Darwin-arm64" ]; then source_url="$MODEL_MLX"; else source_url="$MODEL_GGUF"; fi
      if "$LMS" get "$source_url" --yes; then LLM_STATE="LM Studio, $MODEL_ID"
      else note "не скачалась. Вручную: lms get $source_url"; LLM_STATE="LM Studio без модели"; fi
    else
      note "позже: lms get $MODEL_MLX"; LLM_STATE="LM Studio без модели"
    fi
  elif [ -n "$OLLAMA" ]; then
    note "найдена Ollama: $OLLAMA"
    have_model=""
    if "$OLLAMA" list 2>/dev/null | grep -q "^$MODEL_OLLAMA"; then
      note "модель $MODEL_OLLAMA уже скачана"; have_model=1
    elif ask "Скачать $MODEL_OLLAMA, около 3 ГБ?"; then
      if "$OLLAMA" pull "$MODEL_OLLAMA"; then have_model=1; else note "не скачалась. Вручную: ollama pull $MODEL_OLLAMA"; fi
    fi
    "$VENV/bin/sfss" config runtime ollama >/dev/null
    if [ -n "$have_model" ]; then
      "$VENV/bin/sfss" config model "$MODEL_OLLAMA" >/dev/null
      LLM_STATE="Ollama, $MODEL_OLLAMA"
    else
      note "позже: ollama pull $MODEL_OLLAMA && sfss config model $MODEL_OLLAMA"; LLM_STATE="Ollama без модели"
    fi
  else
    note "LM Studio и Ollama не найдены. Расчёт, CSV и Площадка работают и без нейросети."
    note "Для ответов на вопросы поставьте одно из двух и запустите ./install.sh ещё раз:"
    note "    LM Studio  https://lmstudio.ai"
    note "    Ollama     https://ollama.com"
    LLM_STATE="не найдена"
  fi
fi

# --- 9. Проверка -------------------------------------------------------------

step "Запускаю и проверяю"
"$VENV/bin/sfss" start || fail "SFSS не запустился. Причина в логе: $VENV/bin/sfss logs"
"$VENV/bin/sfss" predict --o2 0.30 --psi 8.2 | sed 's/^/    /' \
  || fail "Расчёт не ответил. Лог: $VENV/bin/sfss logs"

cat <<EOF

Готово. SFSS установлен и работает.
    Anti-Fire:  $APP_STATE
    Нейросеть:  $LLM_STATE

    sfss status                      что запущено
    sfss predict --o2 0.30 --psi 8.2 расчёт
    sfss ask "Как гелий в атмосфере влияет на горение?"
    sfss playground                  Площадка в браузере
    sfss stop                        остановить
    ./install.sh --uninstall         удалить всё

Подробности: INSTALL.md
EOF
