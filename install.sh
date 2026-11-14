#!/usr/bin/env bash
# Установка SFSS на macOS и Linux из клона репозитория.
#
#   ./install.sh              поставить и проверить
#   ./install.sh --yes        не задавать вопросов, на всё отвечать «да»
#   ./install.sh --no-llm     не трогать нейросеть
#   ./install.sh --uninstall  убрать установку (клон и данные NASA остаются)
#
# Повторный запуск безопасен: готовые шаги пропускаются. Windows: install.ps1.
# Подробности: INSTALL.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SFSS="$ROOT/sfss"
VENV="$SFSS/.venv"
BIN="$HOME/.local/bin"
LINK="$BIN/sfss"
MODEL_ID="ministral-3-3b-instruct-2512"
MODEL_MLX="https://huggingface.co/mlx-community/Ministral-3-3B-Instruct-2512-4bit"
MODEL_GGUF="https://huggingface.co/lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF"
MODEL_OLLAMA="ministral-3:3b"

YES=""; NO_LLM=""; UNINSTALL=""
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    --no-llm) NO_LLM=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Неизвестный параметр: $arg. Справка: ./install.sh --help" >&2; exit 2 ;;
  esac
done

step() { printf '\n→ %s\n' "$1"; }
note() { printf '  %s\n' "$1"; }
fail() { printf '\nОшибка: %s\n' "$1" >&2; exit 1; }

ask() {
  # «да» по умолчанию; без терминала (CI, конвейер) и без --yes отвечаем «нет»
  [ -n "$YES" ] && return 0
  [ -t 0 ] || return 1
  printf '  %s [Д/н] ' "$1"
  read -r answer
  case "$answer" in ""|д|Д|да|Да|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

link_is_ours() { [ -L "$LINK" ] && [ "$(readlink "$LINK")" = "$VENV/bin/sfss" ]; }

# --- Удаление ----------------------------------------------------------------

if [ -n "$UNINSTALL" ]; then
  step "Останавливаю SFSS"
  if [ -x "$VENV/bin/sfss" ]; then "$VENV/bin/sfss" stop || true; else note "не установлен"; fi
  step "Убираю команду sfss"
  if link_is_ours; then rm "$LINK"; note "удалена $LINK"
  elif [ -e "$LINK" ]; then note "$LINK ведёт в другую установку, не трогаю"
  else note "её и не было"; fi
  step "Убираю окружение, индекс и состояние демона"
  rm -rf "$VENV" "$SFSS/data/chroma" "$SFSS/data/run" "$SFSS"/*.egg-info
  printf '\nГотово. Остались: клон в %s, отчёты NASA, модель расчёта, sfss/.env и настройки нейросети.\n' "$ROOT"
  note "Модель поиска в ~/.cache/huggingface и нейросеть в LM Studio или Ollama не тронуты."
  exit 0
fi

# --- 1. Python ---------------------------------------------------------------

step "Ищу Python 3.10 или новее"
PYTHON=""
for candidate in python3 python3.14 python3.13 python3.12 python3.11 python3.10 python3.15; do
  if command -v "$candidate" >/dev/null 2>&1 \
    && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
    PYTHON="$(command -v "$candidate")"; break
  fi
done
if [ -z "$PYTHON" ]; then
  case "$(uname -s)" in
    Darwin) hint="https://www.python.org/downloads/ или: brew install python" ;;
    *) hint="Fedora: sudo dnf install python3   Ubuntu: sudo apt install python3 python3-venv" ;;
  esac
  fail "Python 3.10+ не найден. Поставьте его и запустите установку снова. $hint"
fi
note "$("$PYTHON" --version), $PYTHON"

# --- 2. Окружение ------------------------------------------------------------

step "Ставлю SFSS и его библиотеки (первый раз несколько минут)"
if [ ! -x "$VENV/bin/python" ]; then
  "$PYTHON" -m venv "$VENV" \
    || fail "Не создалось окружение. На Ubuntu нужен пакет: sudo apt install python3-venv"
fi
PIP_ARGS=(--quiet --disable-pip-version-check)
# На Linux pip по умолчанию берёт PyTorch с CUDA: это около 2 ГБ, а считаем на процессоре
[ "$(uname -s)" = "Linux" ] && PIP_ARGS+=(--extra-index-url https://download.pytorch.org/whl/cpu)
PIP_LOG="$(mktemp)"
if ! { "$VENV/bin/python" -m pip install "${PIP_ARGS[@]}" --upgrade pip \
    && "$VENV/bin/python" -m pip install "${PIP_ARGS[@]}" -e "$SFSS"; } >"$PIP_LOG" 2>&1; then
  tail -20 "$PIP_LOG" >&2
  fail "Библиотеки не поставились. Проверьте сеть. Если pip пишет о конфликте версий, поставьте Python 3.12: под самый новый Python библиотек может ещё не быть. Весь вывод: $PIP_LOG"
fi
rm -f "$PIP_LOG"
note "готово: $VENV"

# --- 3. Настройки ------------------------------------------------------------

step "Настройки"
if [ -f "$SFSS/.env" ]; then note "sfss/.env уже есть, не трогаю"
else cp "$SFSS/.env.example" "$SFSS/.env"; note "создан sfss/.env"; fi

# --- 4. Модель поиска --------------------------------------------------------

step "Модель поиска по отчётам"
load_embeddings() {
  ( cd "$SFSS" && "$VENV/bin/python" -c '
from app.config import get_settings
from sentence_transformers import SentenceTransformer
settings = get_settings()
SentenceTransformer(settings.embedding_model, local_files_only=settings.embedding_local_files_only)
print(settings.embedding_model)' ) 2>/dev/null
}
if name="$(load_embeddings)"; then
  note "$name уже на диске"
else
  note "скачиваю с Hugging Face, около 470 МБ, один раз"
  # Сервис работает без сети, поэтому скачивание разрешается только здесь
  name="$(EMBEDDING_LOCAL_FILES_ONLY=false HF_HUB_OFFLINE=0 load_embeddings)" \
    || fail "Модель поиска не скачалась. Проверьте сеть и запустите установку снова."
  note "$name скачана"
fi

# --- 5. Индекс ---------------------------------------------------------------

step "Индекс по отчётам NASA"
chunks() {
  ( cd "$SFSS" && "$VENV/bin/python" -c '
from app.dependencies import get_rag_service
print(get_rag_service().count())' ) 2>/dev/null || echo 0
}
count="$(chunks)"
if [ "${count:-0}" -gt 0 ] 2>/dev/null; then
  note "уже собран: $count фрагментов"
else
  note "собираю, около минуты"
  ( cd "$SFSS" && "$VENV/bin/python" scripts/ingest_documents.py >/dev/null 2>&1 ) \
    || fail "Индекс не собрался. Запустите вручную: cd sfss && .venv/bin/python scripts/ingest_documents.py"
  note "собран: $(chunks) фрагментов"
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

# --- 7. Нейросеть ------------------------------------------------------------

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
      if [ "$(uname -s)-$(uname -m)" = "Darwin-arm64" ]; then source_url="$MODEL_MLX"; else source_url="$MODEL_GGUF"; fi
      if "$LMS" get "$source_url" --yes; then LLM_STATE="LM Studio, $MODEL_ID"
      else note "не скачалась. Вручную: lms get $source_url"; LLM_STATE="LM Studio без модели"; fi
    else
      note "позже: lms get $MODEL_MLX"; LLM_STATE="LM Studio без модели"
    fi
  elif [ -n "$OLLAMA" ]; then
    note "найдена Ollama: $OLLAMA"
    if "$OLLAMA" list 2>/dev/null | grep -q "^$MODEL_OLLAMA"; then
      note "модель $MODEL_OLLAMA уже скачана"; have_model=1
    elif ask "Скачать $MODEL_OLLAMA, около 3 ГБ?"; then
      if "$OLLAMA" pull "$MODEL_OLLAMA"; then have_model=1; else note "не скачалась. Вручную: ollama pull $MODEL_OLLAMA"; fi
    fi
    "$VENV/bin/sfss" config runtime ollama >/dev/null
    if [ -n "${have_model:-}" ]; then
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

# --- 8. Проверка -------------------------------------------------------------

step "Запускаю и проверяю"
"$VENV/bin/sfss" start || fail "SFSS не запустился. Причина в логе: $VENV/bin/sfss logs"
"$VENV/bin/sfss" predict --o2 0.30 --psi 8.2 | sed 's/^/  /' \
  || fail "Расчёт не ответил. Лог: $VENV/bin/sfss logs"

cat <<EOF

Готово. SFSS установлен и работает. Нейросеть: $LLM_STATE.

  sfss status                      что запущено
  sfss predict --o2 0.30 --psi 8.2 расчёт
  sfss ask "Как гелий в атмосфере влияет на горение?"
  sfss playground                  Площадка в браузере
  sfss stop                        остановить

Программа Anti-Fire и остальное: INSTALL.md
EOF
