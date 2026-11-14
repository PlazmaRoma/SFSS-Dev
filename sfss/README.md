# SFSS — сервис

RAG + ML сервис по данным NASA о горении в невесомости
(NASA Space Apps 2026, «Flame in Freefall»).

Делает две вещи:

- **отвечает на вопросы** по отчётам NASA со ссылками на документ и страницу;
- **предсказывает скорость горения** капли топлива по составу атмосферы.

---

## Быстрый старт

Эта папка — часть репозитория SFSS-Dev: сервис `sfss` и Площадка в `playground/`.
Программа Anti-Fire лежит рядом, в `../apps/anti-fire`. Отчёты NASA и обученная модель
лежат в git, а индекс собирается на машине один раз. Сервис работает в фоне,
управляется командой `sfss`:

```bash
./install.sh                   # из корня SFSS-Dev, один раз; Windows: install.ps1
sfss start --with-llm          # демон и модель с контекстом 8192
sfss status
```

Что делает установщик, удаление и сбои — по системам: [`../docs/install/`](../docs/install/).

Модель загружается сама при первом вопросе. Заранее: `sfss load`, кнопка в Anti-Fire
или `POST /v1/llm/load`. Выгрузить: `sfss unload` или кнопка там же. LM Studio открывать
не нужно, но он должен быть установлен. Вместо него можно Ollama: раздел «Настройки нейросети».

```bash
sfss predict --o2 0.30 --psi 8.2
sfss ask "Как гелий в атмосфере влияет на горение?"
sfss predict --csv runs.csv --out results.csv
sfss import report.pdf
sfss playground                # Площадка в браузере
sfss logs -f
sfss stop
sfss help predict
```

Pid и лог демона лежат в `data/run/`. Для разработки по-прежнему удобнее
`.venv/bin/uvicorn app.main:app --reload`.

Открыть **http://localhost:8000/docs** — там все эндпоинты можно потыкать мышкой.

Проверить, что всё живо, без `sfss`:

```bash
curl http://localhost:8000/health
```

Ожидаемый ответ: `"status": "ok"`, `"indexed_documents": 1131`.

**Если `"lm_studio": false`** — не запущен LM Studio. Это нужно только для
`/query`; `/predict` работает и без него. Как поднять — раздел «LM Studio» ниже.

> Команды начинаются с `.venv/bin/...`, чтобы не активировать окружение.
> Если удобнее активировать: `source .venv/bin/activate`, дальше просто
> `uvicorn`, `python`, `pytest`.

---

## Что где лежит

| Документ | О чём |
|---|---|
| [`docs/SMOKE-TEST.md`](docs/SMOKE-TEST.md) | **как потыкать руками и понять, что не сломалось** |
| [`docs/CODEMAP.md`](docs/CODEMAP.md) | что делает каждый файл с кодом |
| [`docs/INTEGRATION.md`](docs/INTEGRATION.md) | **как подключить к SFSS свою программу**; рабочий пример — [`examples/telemetry_monitor.py`](examples/telemetry_monitor.py) |
| [`docs/API.md`](docs/API.md) | справочник по эндпоинтам с примерами |
| [`docs/DEMO.md`](docs/DEMO.md) | сценарий показа на 3 минуты |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | требования после созвона с организаторами и что по ним сделано |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | как устроено и почему; журнал всех решений |
| [`docs/anti-fire-backend-mvp.md`](docs/anti-fire-backend-mvp.md) | исходное техническое задание |

---

## Три запроса, чтобы вспомнить, что оно умеет

```bash
# 1. Статус
curl http://localhost:8000/health

# 2. Данные для дашборда одним запросом
curl -s http://localhost:8000/dashboard

# 3. Вопрос по документам NASA (нужен LM Studio, ответ 33-46 секунд)
curl -X POST http://localhost:8000/query \
  -H 'Content-Type: application/json' \
  -d '{"question": "Как концентрация кислорода влияет на распространение пламени?"}'

# 4. Предсказание скорости горения
#    Достаточно того, что меняете — остальное подставится (стандартный воздух)
curl -X POST http://localhost:8000/predict \
  -H 'Content-Type: application/json' \
  -d '{"parameters": {"oxygen_level": 0.30}}'
```

Последний вернёт `predicted_value` — скорость горения в мм²/с. Полное описание
полей и ошибок — в [`docs/API.md`](docs/API.md).

Чтобы проверить, что модель отвечает осмысленно, а не сочиняет, — пройдите
[`docs/SMOKE-TEST.md`](docs/SMOKE-TEST.md): четыре запроса с эталонными
ответами, включая контрольный вопрос на галлюцинации.

---

## Настройки нейросети

Рантайм (где она работает) и модель (какая она) настраиваются отдельно, сразу и без
перезапуска: команда `sfss config`, окно «Настройки AI» в Anti-Fire и на Площадке,
`config` в терминале Anti-Fire, `GET` и `PATCH /v1/llm/config`.

```bash
sfss config                                 # что сейчас настроено
sfss config runtime ollama                  # рантайм и его стандартный порт, 11434
sfss config runtime --port 1235             # только порт
sfss config runtime lmstudio --host 10.0.0.5 --port 1234
sfss config models                          # какие модели есть у рантайма
sfss config model ministral-3:3b --max-tokens 256
sfss config reset                           # назад к значениям из .env
```

Настройки лежат в `data/llm.json` и важнее `.env`. Демон выключен: команда правит этот файл,
и настройка сработает при `sfss start`.

| | LM Studio | Ollama |
|---|---|---|
| Порт по умолчанию | 1234 | 11434 |
| Сервис сам поднимает сервер | `lms server start --port` | `ollama serve` |
| Загрузка и выгрузка модели | `lms` | `POST /api/generate` с `keep_alive` |
| Контекст | из настроек SFSS, 8192 | задаётся в самой Ollama: `OLLAMA_CONTEXT_LENGTH` |
| Модель остаётся в памяти | пока её не выгрузят | может уйти через 5 минут после ответа, следующий вопрос загрузит снова |

В Ollama модель надо скачать заранее: `ollama pull имя`. Поддержка Ollama проверена на тестах
и на имитации её API, с настоящей Ollama ещё не запускалась. Запрещённые регламентом китайские
модели в списке не показываются и не принимаются (ARCHITECTURE § 7.18).

---

## LM Studio

Нужен только для `/query`: он отвечает за генерацию текста. Всё работает
локально, наружу не уходит ничего.

1. Открыть LM Studio → вкладка **Developer** (Local Server)
2. Загрузить модель `mlx-community/Ministral-3-3B-Instruct-2512-4bit` с длиной
   контекста 8192 (по умолчанию LM Studio ставит 262 144, и на 8 ГБ это своп)
3. Нажать **Start Server**

Проверка:

```bash
curl -s localhost:1234/api/v0/models   # состояние всех моделей
```

**Берите MLX-сборку, а не GGUF.** На этой машине замеряли: GGUF Q4_K_M отвечает
~120 с и упирается в таймаут, MLX — 3-7 с. Имя загруженной модели должно
совпадать с `LM_STUDIO_MODEL` в `.env`.

---

## Тесты

```bash
uv pip install --python .venv/bin/python pytest      # один раз; uv из PATH или ../.tools/uv
.venv/bin/python -m pytest -q
```

238 тестов, проходят за пару секунд. Сервисы подменены заглушками, поэтому
**ни LM Studio, ни модель поиска для тестов не нужны**.

---

## Если нужно пересобрать с нуля

Обычно не нужно — всё уже готово. Команды на случай, если данные потерялись.

**Установка окружения:** `../install.sh` из корня репозитория, или вручную:

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e .
.venv/bin/python -m app.services.embedder     # модель поиска, 130 МБ
```

**Переиндексация документов** (`data/raw/` → `data/index/`). Готовый индекс лежит в git,
пересобирать его нужно, только если поменялись отчёты или модель поиска, около 40 секунд:

```bash
.venv/bin/python scripts/ingest_documents.py --force
```

Новый индекс закоммитить: `data/index/chunks.jsonl` и `vectors.npy`.

**Пересборка датасета и обучение модели:**

```bash
.venv/bin/python scripts/build_flex_dataset.py

.venv/bin/python scripts/train_model.py \
    --dataset data/processed/flex.csv \
    --target burn_rate_mm2s --group condition \
    --exclude d_extinction_mm burn_time_s
```

Появятся `data/models/fiery.joblib` и `fiery_clusters.joblib`.
Флаг `--dry-run` считает качество, ничего не перезаписывая.

Зачем нужны `--group` и `--exclude` и почему без них оценка врёт — в
[`docs/CODEMAP.md`](docs/CODEMAP.md), раздел про `train_model.py`.

---

## Переменные окружения

`.env` в корне проекта (шаблон — `.env.example`):

```
LM_STUDIO_BASE_URL=http://localhost:1234/v1
LM_STUDIO_MODEL=ministral-3-3b-instruct-2512
EMBEDDING_MODEL=paraphrase-multilingual-MiniLM-L12-v2
```

Модель поиска лежит в `data/embedding`, индекс — в `data/index`. Сеть для работы не нужна:
модель скачивается один раз при установке, с закреплённой версией и проверкой контрольной
суммы (`app/services/embedder.py`).

---

## Состояние проекта

Все критерии готовности MVP из ТЗ закрыты:

- [x] `/health` отвечает при поднятых LM Studio и индексе
- [x] документы проиндексированы — **1131 чанк из 16 отчётов NASA**,
      `/query` отвечает со ссылками на страницы
- [x] датасет обработан, `/predict` даёт не-заглушечный результат —
      модель **fiery**, R² 0.65 против нуля у константы
- [x] эндпоинты покрыты pytest
- [x] README с инструкцией запуска

Что осталось за рамками MVP и почему — [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
разделы 11 (ограничения) и 12 (что дальше).
