# Техническое задание: Anti-Fire — MVP Backend

## 1. Назначение документа

Спецификация backend-части проекта Anti-Fire (NASA Space Apps 2026, "Flame in Freefall"). Документ предназначен для использования как техническое задание при разработке с Claude Code.

## 2. Стек

| Компонент | Технология | Назначение |
|---|---|---|
| API-сервер | FastAPI (Python 3.11+) | Приём запросов, оркестрация RAG/ML, отдача JSON |
| ML (табличные данные) | scikit-learn | Кластеризация экспериментов, ранжирование риска |
| LLM-инференс | LM Studio (Bionic), локальный сервер с OpenAI-совместимым API | Суммаризация и генерация ответов |
| Модель | Ministral 3B (`mistralai/ministral-3-3b`, загружается в LM Studio) | Генерация текста на основе retrieved-контекста |
| Векторная БД | ChromaDB | Хранение эмбеддингов документов, retrieval |
| Эмбеддинги | sentence-transformers (локально, без внешних API) | Векторизация чанков и запросов |
| Хранилище данных | Локальная файловая система (`data/raw`, `data/processed`) | PDF/CSV из PSI |

**Важно:** LM Studio поднимает локальный сервер с OpenAI-совместимым `/v1/chat/completions` API (обычно `http://localhost:1234/v1`). Интеграция в FastAPI должна идти через `openai`-совместимый клиент с `base_url`, указывающим на LM Studio, а не через Ollama/vLLM SDK.

## 3. Структура проекта

```
anti-fire-backend/
├── app/
│   ├── main.py                # точка входа FastAPI
│   ├── routers/
│   │   ├── query.py           # /query — RAG + LLM
│   │   ├── predict.py         # /predict — sklearn
│   │   └── health.py          # /health
│   ├── services/
│   │   ├── rag_service.py     # retrieval из ChromaDB
│   │   ├── llm_service.py     # клиент к LM Studio
│   │   ├── ml_service.py      # sklearn инференс
│   │   └── ingest_service.py  # парсинг и индексация документов
│   ├── models/
│   │   └── schemas.py         # pydantic-схемы запросов/ответов
│   └── config.py              # переменные окружения, пути, URL LM Studio
├── scripts/
│   ├── ingest_documents.py    # офлайн-индексация PDF в ChromaDB
│   └── train_model.py         # обучение/пересчёт sklearn-модели
├── data/
│   ├── raw/                   # исходные PDF/CSV из PSI
│   └── processed/             # очищенные датасеты
├── requirements.txt
└── .env
```

## 4. API — эндпоинты MVP

### `GET /health`
Проверка доступности сервиса и подключения к ChromaDB/LM Studio.

### `POST /query`
**Вход:** `{ "question": str, "filters": dict | null }`
**Логика:**
1. Векторизация вопроса.
2. Retrieval top-k (k=5) релевантных чанков из ChromaDB.
3. Формирование промпта: вопрос + контекст чанков + инструкция отвечать только на основе предоставленных данных и указывать источник (id документа/страницу).
4. Запрос к LM Studio.
5. Возврат ответа с привязкой к источникам.

**Выход:**
```json
{
  "answer": "string",
  "sources": [{"doc_id": "string", "excerpt": "string", "page": "int|null"}]
}
```

### `POST /predict`
**Вход:** `{ "parameters": {"oxygen_level": float, "gravity": float, "material": str, ...} }`
**Логика:** запуск sklearn-модели (классификация/скоринг риска) на переданных параметрах.
**Выход:**
```json
{
  "risk_score": "float",
  "cluster": "int|null",
  "chart_data": {"x": [], "y": []}
}
```

### `POST /ingest` (служебный, не для фронта)
Триггер переиндексации новых документов в `data/raw`.

## 5. Пайплайн данных

1. **Источник:** NASA PSI (Physical Sciences Informatics) — эксперименты BASS/BASS-II, FLEX, SoFIE, ACME.
2. **Ingest PDF:** извлечение текста → чанкинг (размер чанка ~500 токенов, overlap ~50) → эмбеддинг через sentence-transformers → запись в ChromaDB с метаданными (doc_id, источник, страница).
3. **Ingest CSV:** очистка, приведение типов, сохранение в `data/processed`. Проверка на наличие целевой переменной для обучения; при отсутствии — фиксация эвристики скоринга риска как таковой (не выдавать за предсказание модели).
4. **Обучение модели:** `scripts/train_model.py` — кластеризация (KMeans) + модель риска (RandomForest), сохранение через `joblib`.

## 6. Переменные окружения (.env)

```
LM_STUDIO_BASE_URL=http://localhost:1234/v1
LM_STUDIO_MODEL=mistralai/ministral-3-3b
CHROMA_DB_PATH=./data/chroma
EMBEDDING_MODEL=paraphrase-multilingual-MiniLM-L12-v2
```

## 7. Критерии готовности MVP

- [ ] `/health` возвращает 200 при поднятом LM Studio и ChromaDB.
- [ ] Минимум 1 документ проиндексирован, `/query` возвращает ответ с корректной ссылкой на источник.
- [ ] Минимум 1 CSV-датасет обработан, `/predict` возвращает не-заглушечный результат.
- [ ] Оба эндпоинта покрыты базовыми pytest-тестами (happy path).
- [ ] Файл `README.md` с инструкцией запуска LM Studio + сервера.

## 8. Явно вне скоупа MVP

- Стриминг ответов (SSE/WebSocket) — добавляется после стабилизации `/query`.
- Десктоп-обёртка (Tauri/Electron) — фронтенд-задача, не блокирует backend.
- Файн-тюнинг модели — используется готовая модель через LM Studio без дообучения.
