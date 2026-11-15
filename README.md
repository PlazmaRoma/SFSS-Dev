# SFSS Dev

Горение в невесомости по данным NASA: NASA Space Apps 2026, задача «Flame in Freefall»,
команда TwinByte.

- **SFSS** — сервис, он работает в фоне. Считает скорость горения капли топлива по составу
  атмосферы и отвечает на вопросы только по отчётам NASA, со ссылкой на страницу. К нему
  подключается любая программа: по HTTP API или командой `sfss` в терминале.
- **Anti-Fire** — рабочая программа на SFSS. Один экран: расчёт, импорт CSV, вопросы к отчётам
  и терминал.
- **SFSS Playground** — площадка, чтобы посмотреть идею и поиграться. Идёт вместе с сервисом:
  `sfss playground`.

Всё работает на одном компьютере, без сети после установки.

## Установка

Нужен только git. Python, библиотеки, модель поиска и Anti-Fire установщик ставит сам, без
прав администратора. Без нейросети это около 400 МБ загрузки.

### macOS

```bash
git clone --depth 1 https://github.com/PlazmaRoma/SFSS-Dev.git ~/SFSS-Dev
cd ~/SFSS-Dev && ./install.sh
```

Anti-Fire — в «Программах». Удалить всё: `cd ~/SFSS-Dev && ./install.sh --uninstall`.
Подробно: [`docs/install/macos.md`](docs/install/macos.md).

### Linux

```bash
git clone --depth 1 https://github.com/PlazmaRoma/SFSS-Dev.git ~/SFSS-Dev
cd ~/SFSS-Dev && ./install.sh
```

Anti-Fire — в меню программ или командой `anti-fire`, нужен WebKitGTK 4.1. Удалить всё:
`cd ~/SFSS-Dev && ./install.sh --uninstall`. Подробно: [`docs/install/linux.md`](docs/install/linux.md).

### Windows

В PowerShell:

```powershell
git clone --depth 1 https://github.com/PlazmaRoma/SFSS-Dev.git $HOME\SFSS-Dev
cd $HOME\SFSS-Dev; powershell -ExecutionPolicy Bypass -File install.ps1
```

Anti-Fire — в меню «Пуск», команда `sfss` — в новом окне PowerShell. Удалить всё:
`powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall`.
Подробно: [`docs/install/windows.md`](docs/install/windows.md).

### Нейросеть

Ответы на вопросы пишет Ministral 3 3B Instruct 2512 в [LM Studio](https://lmstudio.ai) или
[Ollama](https://ollama.com) на этом же компьютере. Установщик находит их и предлагает скачать
модель, около 3 ГБ. Без нейросети работает всё остальное: расчёт, CSV, Площадка.

| Где | Сборка | Скачать самому |
|---|---|---|
| Mac на Apple Silicon | MLX 4bit: [mlx-community/Ministral-3-3B-Instruct-2512-4bit](https://huggingface.co/mlx-community/Ministral-3-3B-Instruct-2512-4bit) | `lms get https://huggingface.co/mlx-community/Ministral-3-3B-Instruct-2512-4bit` |
| Windows, Linux, Mac на Intel | GGUF `Q4_K_M`, ближайшая к MLX 4bit: [mistralai/Ministral-3-3B-Instruct-2512-GGUF](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF) или та же квантизация в [lmstudio-community](https://huggingface.co/lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF) | `lms get https://huggingface.co/lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF`, вариант `Q4_K_M` |
| Ollama, любая система | [`ministral-3:3b`](https://ollama.com/library/ministral-3), тот же `Q4_K_M` | `ollama pull ministral-3:3b` |

Обе сборки могут лежать в LM Studio рядом: SFSS загрузит родную для машины или ту, что уже
загружена. Чтобы закрепить сборку, укажите её полное имя, например
`sfss config model mlx-community/ministral-3-3b-instruct-2512`. Как выбирали и проверяли GGUF:
[`sfss/docs/TEST-RUN-2026-11-15-GGUF.md`](sfss/docs/TEST-RUN-2026-11-15-GGUF.md).

## Как пользоваться

```bash
sfss status                                   # что запущено
sfss predict --o2 0.30 --psi 8.2              # скорость горения при 30 % кислорода и 8,2 psi
sfss predict --csv sfss/examples/runs.csv     # таблица условий целиком
sfss ask "How does helium in the atmosphere affect combustion?"
sfss playground                               # Площадка в браузере
sfss stop                                     # остановить сервис
sfss help                                     # все команды
```

Своя программа подключается к SFSS по HTTP: [`sfss/docs/INTEGRATION.md`](sfss/docs/INTEGRATION.md),
справочник — [`sfss/docs/API.md`](sfss/docs/API.md), пример стороннего ПО —
[`sfss/examples/telemetry_monitor.py`](sfss/examples/telemetry_monitor.py).

## Что где лежит

| Папка | Что внутри |
|---|---|
| [`sfss/`](sfss/) | сервис: код, тесты, данные NASA, модель расчёта, готовый индекс, документация в `sfss/docs` |
| [`sfss/playground/`](sfss/playground/) | исходники Площадки; собранная лежит в `sfss/app/static/playground` |
| [`apps/anti-fire/`](apps/anti-fire/) | Anti-Fire: страница, окно на Tauri, готовые сборки в `release/` |
| [`docs/install/`](docs/install/) | установка и удаление по системам |
| `install.sh`, `install.ps1` | установщики: macOS и Linux, Windows |

Общий код Площадки и Anti-Fire лежит в `sfss/playground/src/shared`, Anti-Fire берёт его как
`@sfss`. Зависимости Node одни на обе программы (npm workspaces).

## Для разработчиков

```bash
cd sfss && ../.tools/uv pip install --python .venv/bin/python pytest && .venv/bin/python -m pytest -q   # сервис
npm ci && npm test && npm run typecheck                                    # Площадка и Anti-Fire
npm run page -w anti-fire && cd apps/anti-fire/src-tauri && cargo test     # окно Anti-Fire
```

Если uv уже есть в `PATH`, вместо `../.tools/uv` можно просто `uv`.

- Площадка собирается в один HTML внутри сервиса: `bash sfss/scripts/update_playground.sh`.
  Собранный файл лежит в git, поэтому сервису Node не нужен.
- Anti-Fire из исходников: `bash apps/anti-fire/build.sh`. Готовые сборки под три системы
  собирает GitHub Actions, workflow `release`.
- Как устроен сервис: [`sfss/README.md`](sfss/README.md), карта кода
  [`sfss/docs/CODEMAP.md`](sfss/docs/CODEMAP.md), решения
  [`sfss/docs/ARCHITECTURE.md`](sfss/docs/ARCHITECTURE.md).

Раньше проект жил в двух репозиториях: `PlazmaRoma/Anti-Fire_backend_MVP` (сервис) и
`heyyAzamat/space-fire-security-software` (интерфейс). История работы осталась там.

Проект не связан с NASA и не одобрен ею. Данные взяты из открытых источников NASA: NTRS и PSI.
