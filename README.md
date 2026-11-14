# SFSS Dev

Горение в невесомости по данным NASA: NASA Space Apps 2026, задача «Flame in Freefall»,
команда TwinByte.

Здесь весь проект в одном репозитории:

| Папка | Что это |
|---|---|
| [`sfss/`](sfss/) | **SFSS**, основная программа. Сервис работает в фоне, даёт API и команду `sfss`. Считает скорость горения капли топлива по составу атмосферы и отвечает на вопросы только по отчётам NASA, со ссылкой на страницу |
| [`sfss/playground/`](sfss/playground/) | **SFSS Playground**, площадка, чтобы посмотреть идею и поиграться. Идёт в комплекте с сервисом и открывается командой `sfss playground` |
| [`apps/anti-fire/`](apps/anti-fire/) | **Anti-Fire**, рабочая программа на SFSS. Один экран: расчёт, импорт CSV, вопросы к отчётам и терминал |

Anti-Fire и Площадка — клиенты SFSS по HTTP. Своя программа подключается к SFSS так же:
[`sfss/docs/INTEGRATION.md`](sfss/docs/INTEGRATION.md), пример —
[`sfss/examples/telemetry_monitor.py`](sfss/examples/telemetry_monitor.py).

## Быстрый старт на macOS

Нужны Python 3.10+, LM Studio с моделью `mlx-community/Ministral-3-3B-Instruct-2512-4bit`,
а для сборки программ ещё Node 22+ и Rust.

```bash
cd sfss
python3 -m venv .venv
.venv/bin/pip install -e .
cp .env.example .env
.venv/bin/python scripts/ingest_documents.py     # индекс по отчётам, около минуты
mkdir -p ~/.local/bin && ln -sf "$PWD/.venv/bin/sfss" ~/.local/bin/sfss
sfss start --with-llm
sfss status
sfss playground
```

Anti-Fire:

```bash
npm ci                          # из корня репозитория, один раз
npm run dev -w anti-fire        # в браузере: http://localhost:5174
bash apps/anti-fire/build.sh    # приложение: apps/anti-fire/src-tauri/target/release/bundle
```

Приложение само запускает и останавливает SFSS на этой машине. Для этого нужна команда
`sfss` в `~/.local/bin`, `/opt/homebrew/bin` или `/usr/local/bin`.

## Тесты

```bash
cd sfss && .venv/bin/python -m pytest -q          # сервис
npm test && npm run typecheck                     # Площадка и Anti-Fire, из корня
cd apps/anti-fire/src-tauri && cargo test         # окно Anti-Fire
```

## Как устроено

- Сервис: [`sfss/README.md`](sfss/README.md), карта кода
  [`sfss/docs/CODEMAP.md`](sfss/docs/CODEMAP.md), решения
  [`sfss/docs/ARCHITECTURE.md`](sfss/docs/ARCHITECTURE.md), справочник API
  [`sfss/docs/API.md`](sfss/docs/API.md).
- Площадка собирается в один HTML внутри сервиса:
  `bash sfss/scripts/update_playground.sh`. Собранный файл лежит в git, поэтому для
  работы `sfss` Node не нужен.
- Общий код Площадки и Anti-Fire лежит в `sfss/playground/src/shared`, Anti-Fire берёт его
  как `@sfss`. Зависимости Node одни на обе программы (npm workspaces).
- Отчёты NASA, датасеты и обученная модель лежат в `sfss/data`. Индекс собирается на машине.

Раньше проект жил в двух репозиториях: `PlazmaRoma/Anti-Fire_backend_MVP` (сервис) и
`heyyAzamat/space-fire-security-software` (интерфейс). История работы осталась там.

Проект не связан с NASA и не одобрен ею. Данные взяты из открытых источников NASA: NTRS и PSI.
