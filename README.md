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

## Установка

```bash
git clone --depth 1 https://github.com/PlazmaRoma/SFSS-Dev.git
cd SFSS-Dev
./install.sh          # Windows: powershell -ExecutionPolicy Bypass -File install.ps1
```

Нужен только git. Установщик сам ставит Python, библиотеки и модель поиска (около 400 МБ без
нейросети), программу Anti-Fire и команду `sfss`, находит LM Studio или Ollama и запускает
проверку. Права администратора не нужны. Удалить всё: `./install.sh --uninstall`.

```bash
sfss status
sfss predict --o2 0.30 --psi 8.2
sfss ask "Как гелий в атмосфере влияет на горение?"
sfss playground
```

Полная инструкция по трём системам, нейросеть, сборка из исходников и что делать при сбоях:
**[`INSTALL.md`](INSTALL.md)**.

## Тесты

```bash
cd sfss && uv pip install --python .venv/bin/python pytest && .venv/bin/python -m pytest -q   # сервис
npm test && npm run typecheck                     # Площадка и Anti-Fire, из корня
npm run page -w anti-fire && cd apps/anti-fire/src-tauri && cargo test     # окно Anti-Fire
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
- Отчёты NASA, датасеты, обученная модель и готовый индекс лежат в `sfss/data`. Модель поиска
  (ONNX, 130 МБ) скачивается при установке. Готовые сборки Anti-Fire — в `apps/anti-fire/release`.

Раньше проект жил в двух репозиториях: `PlazmaRoma/Anti-Fire_backend_MVP` (сервис) и
`heyyAzamat/space-fire-security-software` (интерфейс). История работы осталась там.

Проект не связан с NASA и не одобрен ею. Данные взяты из открытых источников NASA: NTRS и PSI.
