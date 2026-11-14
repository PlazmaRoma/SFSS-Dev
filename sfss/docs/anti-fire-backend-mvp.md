# Specification: Anti-Fire MVP back end

This is the original specification the back end was built from, kept as written. The project has
grown since: see [`ARCHITECTURE.md`](ARCHITECTURE.md) for what changed and why.

## 1. Purpose of the document

The specification of the back end of the Anti-Fire project (NASA Space Apps 2026, "Flame in
Freefall"). It is meant to be used as the specification when developing with Claude Code.

## 2. Stack

| Component | Technology | Purpose |
|---|---|---|
| API server | FastAPI (Python 3.11+) | taking requests, orchestrating RAG/ML, returning JSON |
| ML (tabular data) | scikit-learn | clustering experiments, ranking risk |
| LLM inference | LM Studio (Bionic), a local server with an OpenAI-compatible API | summarising and generating answers |
| Model | Ministral 3B (`mistralai/ministral-3-3b`, loaded into LM Studio) | generating text from the retrieved context |
| Vector DB | ChromaDB | storing document embeddings, retrieval |
| Embeddings | sentence-transformers (local, no external APIs) | vectorising chunks and queries |
| Data storage | the local file system (`data/raw`, `data/processed`) | PDF/CSV from PSI |

**Important:** LM Studio serves a local OpenAI-compatible `/v1/chat/completions` API (usually
`http://localhost:1234/v1`). FastAPI should integrate through an `openai`-compatible client with
`base_url` pointing to LM Studio, not through an Ollama/vLLM SDK.

## 3. Project structure

```
anti-fire-backend/
├── app/
│   ├── main.py                # FastAPI entry point
│   ├── routers/
│   │   ├── query.py           # /query: RAG + LLM
│   │   ├── predict.py         # /predict: sklearn
│   │   └── health.py          # /health
│   ├── services/
│   │   ├── rag_service.py     # retrieval from ChromaDB
│   │   ├── llm_service.py     # the LM Studio client
│   │   ├── ml_service.py      # sklearn inference
│   │   └── ingest_service.py  # parsing and indexing documents
│   ├── models/
│   │   └── schemas.py         # pydantic request/response schemas
│   └── config.py              # environment variables, paths, LM Studio URL
├── scripts/
│   ├── ingest_documents.py    # offline indexing of PDFs into ChromaDB
│   └── train_model.py         # training/recomputing the sklearn model
├── data/
│   ├── raw/                   # source PDF/CSV from PSI
│   └── processed/             # cleaned datasets
├── requirements.txt
└── .env
```

## 4. API: MVP endpoints

### `GET /health`
Checks that the service is available and connected to ChromaDB/LM Studio.

### `POST /query`
**Input:** `{ "question": str, "filters": dict | null }`
**Logic:**
1. Vectorise the question.
2. Retrieve the top-k (k=5) relevant chunks from ChromaDB.
3. Build the prompt: the question + the chunk context + an instruction to answer only from the
   provided data and to cite the source (document id/page).
4. Call LM Studio.
5. Return the answer tied to its sources.

**Output:**
```json
{
  "answer": "string",
  "sources": [{"doc_id": "string", "excerpt": "string", "page": "int|null"}]
}
```

### `POST /predict`
**Input:** `{ "parameters": {"oxygen_level": float, "gravity": float, "material": str, ...} }`
**Logic:** run the sklearn model (classification/risk scoring) on the given parameters.
**Output:**
```json
{
  "risk_score": "float",
  "cluster": "int|null",
  "chart_data": {"x": [], "y": []}
}
```

### `POST /ingest` (maintenance, not for the front end)
Triggers re-indexing of new documents in `data/raw`.

## 5. Data pipeline

1. **Source:** NASA PSI (Physical Sciences Informatics): the BASS/BASS-II, FLEX, SoFIE and ACME
   experiments.
2. **PDF ingest:** extract text → chunk (about 500 tokens, overlap about 50) → embed with
   sentence-transformers → write to ChromaDB with metadata (doc_id, source, page).
3. **CSV ingest:** clean, cast types, save to `data/processed`. Check for a target variable for
   training; without one, record the risk-scoring heuristic as such (do not present it as a model
   prediction).
4. **Model training:** `scripts/train_model.py`: clustering (KMeans) + a risk model
   (RandomForest), saved with `joblib`.

## 6. Environment variables (.env)

```
LM_STUDIO_BASE_URL=http://localhost:1234/v1
LM_STUDIO_MODEL=mistralai/ministral-3-3b
CHROMA_DB_PATH=./data/chroma
EMBEDDING_MODEL=paraphrase-multilingual-MiniLM-L12-v2
```

## 7. MVP readiness criteria

- [ ] `/health` returns 200 with LM Studio and ChromaDB up.
- [ ] At least 1 document is indexed, `/query` returns an answer with a correct source reference.
- [ ] At least 1 CSV dataset is processed, `/predict` returns a non-stub result.
- [ ] Both endpoints are covered by basic pytest tests (happy path).
- [ ] A `README.md` with instructions for starting LM Studio and the server.

## 8. Explicitly out of the MVP scope

- Streaming answers (SSE/WebSocket): added once `/query` is stable.
- A desktop wrapper (Tauri/Electron): a front-end task, does not block the back end.
- Fine-tuning the model: a ready model is used through LM Studio without further training.
