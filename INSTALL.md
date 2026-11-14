# Установка

Ставятся две вещи. **SFSS** — сервис, он считает и отвечает; без него ничего не работает.
**Anti-Fire** — программа с окном, клиент сервиса; ставится по желанию.

| | macOS | Linux | Windows |
|---|---|---|---|
| SFSS | `./install.sh` | `./install.sh` | `install.ps1` |
| Anti-Fire | `.dmg` | `tar.gz` | `zip` |
| Проверено | вживую, с чистой установки | в GitHub Actions, Ubuntu | только в GitHub Actions, без нейросети |

## 1. Что должно стоять заранее

- **git** и **Python 3.10 или новее**.
  - macOS: [python.org](https://www.python.org/downloads/) или `brew install python`. Системный
    Python 3.9 не подойдёт, установщик его пропустит и скажет об этом.
  - Fedora: `sudo dnf install python3 git`. Ubuntu: `sudo apt install python3 python3-venv git`.
  - Windows: [python.org](https://www.python.org/downloads/), при установке отметить
    «Add python.exe to PATH».
- **Около 3 ГБ на диске** и сеть на время установки: библиотеки и модель поиска (470 МБ).
  После установки сервис работает без сети.
- **Для ответов на вопросы** — [LM Studio](https://lmstudio.ai) или [Ollama](https://ollama.com).
  Без них работает всё остальное: расчёт, CSV, Площадка.

## 2. SFSS

```bash
git clone https://github.com/PlazmaRoma/SFSS-Dev.git
cd SFSS-Dev
./install.sh
```

Windows, в PowerShell:

```powershell
git clone https://github.com/PlazmaRoma/SFSS-Dev.git
cd SFSS-Dev
powershell -ExecutionPolicy Bypass -File install.ps1
```

Установщик сам:

1. находит Python и создаёт окружение `sfss/.venv`;
2. ставит библиотеки;
3. скачивает модель поиска по отчётам;
4. собирает индекс по 16 отчётам NASA, около минуты;
5. даёт команду `sfss`: ссылка в `~/.local/bin`, на Windows — `%LOCALAPPDATA%\sfss\bin`;
6. ищет LM Studio или Ollama и предлагает скачать нейросеть Ministral 3B, около 3 ГБ;
7. запускает сервис и делает один расчёт.

Первая установка идёт около десяти минут, почти всё время — скачивание. Повторный запуск
безопасен: готовые шаги пропускаются.

| Параметр | Что делает |
|---|---|
| `--yes` (`-Yes`) | не задаёт вопросов |
| `--no-llm` (`-NoLlm`) | не трогает нейросеть |
| `--uninstall` (`-Uninstall`) | убирает установку |

Если установщик пишет, что папки `~/.local/bin` нет в `PATH`, добавьте в `~/.zshrc` или
`~/.bashrc` строку, которую он напечатал, и откройте новый терминал. На Windows новый
терминал нужен в любом случае.

### Проверка

```bash
sfss status
sfss predict --o2 0.30 --psi 8.2
sfss playground
```

Ожидается: 1131 фрагмент в индексе, скорость горения 0.676 мм²/с, в 1,33 раза быстрее
обычного воздуха; в браузере открывается Площадка.

## 3. Нейросеть

Нейросеть работает в LM Studio или Ollama на этой же машине. Установщик находит их сам.
Если он ничего не нашёл или вы ставили их позже, запустите его ещё раз или подключите вручную.

**LM Studio.** Открывать его не нужно, достаточно установить и один раз запустить.

```bash
lms get https://huggingface.co/mlx-community/Ministral-3-3B-Instruct-2512-4bit        # Mac на Apple Silicon
lms get https://huggingface.co/lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF   # остальные
sfss load
```

**Ollama.**

```bash
ollama pull ministral-3:3b
sfss config runtime ollama
sfss config model ministral-3:3b
```

Проверка: `sfss ask "Как гелий в атмосфере влияет на горение?"`. Первый ответ идёт до
минуты. Другой адрес, порт или модель: `sfss config`, подробности в
[`sfss/README.md`](sfss/README.md), раздел «Настройки нейросети». Китайские модели сервис
не принимает: они запрещены регламентом.

## 4. Anti-Fire

Готовые файлы лежат в [Releases](https://github.com/PlazmaRoma/SFSS-Dev/releases).

- **macOS.** Открыть `.dmg`, перетащить Anti-Fire в «Программы». Первый запуск: правый клик →
  «Открыть», потому что сборка без подписи Apple.
- **Linux.** Распаковать `tar.gz` и запустить `./Anti-Fire/anti-fire`. Нужен WebKitGTK 4.1:
  `sudo dnf install webkit2gtk4.1` или `sudo apt install libwebkit2gtk-4.1-0`.
- **Windows.** Распаковать `zip` и открыть `Anti-Fire.exe`. SmartScreen: «Подробнее» →
  «Выполнить в любом случае».

Программа сама находит команду `sfss`, поэтому кнопки «Запустить SFSS» и «Остановить SFSS»
работают сразу после шага 2.

### Сборка из исходников

Нужен Node 22+. Rust скрипт поставит сам, в `~/.cargo`, без sudo.

```bash
bash apps/anti-fire/build.sh --install    # macOS: собрать и положить в «Программы»
bash apps/anti-fire/build.sh              # Linux: файл в apps/anti-fire/src-tauri/target/release
```

На Linux до сборки:

```bash
sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel libappindicator-gtk3-devel   # Fedora
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev   # Ubuntu
```

Сборку под все три системы делает GitHub Actions: вкладка Actions → `release` → Run workflow.
Файлы появятся в артефактах запуска, а по тегу `v*` — в Releases.

## 5. Удаление

```bash
./install.sh --uninstall
```

Убирает демон, команду `sfss`, окружение и индекс. Остаются клон, отчёты NASA и `sfss/.env`.
Модель поиска лежит в `~/.cache/huggingface`, нейросеть — в LM Studio или Ollama: их удаляют
там же. Anti-Fire на macOS — перетащить из «Программ» в Корзину.

## 6. Тесты

```bash
cd sfss && .venv/bin/pip install pytest && .venv/bin/python -m pytest -q   # сервис
npm ci && npm test && npm run typecheck                                    # Площадка и Anti-Fire
npm run page -w anti-fire && cd apps/anti-fire/src-tauri && cargo test     # окно Anti-Fire
```

## 7. Если что-то пошло не так

| Что видно | Что делать |
|---|---|
| «Python 3.10+ не найден» | поставить Python из раздела 1 и запустить установку снова |
| `sfss: command not found` | открыть новый терминал; проверить `PATH`, см. раздел 2 |
| «Порт 8000 занят» | `sfss start --port 8010` |
| pip пишет о конфликте версий | Python слишком новый, библиотек под него ещё нет: поставить Python 3.12 и запустить установку снова |
| «Модель поиска не скачалась» | проверить сеть и запустить установку снова, она продолжит с этого шага |
| Нейросеть «не отвечает» | открыть LM Studio один раз или `ollama serve`; затем `sfss load` |
| Anti-Fire: «Команда sfss не найдена» | сначала установить SFSS, раздел 2 |

Лог сервиса: `sfss logs`.

## 8. Что не проверено

- **Windows вживую.** Установщик и сервис проверяются только в GitHub Actions, без нейросети.
  Запасной путь — WSL и тот же `./install.sh`.
- **Anti-Fire на Linux и Windows** собран в GitHub Actions, на настоящих машинах не запускался.
- **Ollama** на настоящей установке: поддержка проверена тестами и на имитации её API.
