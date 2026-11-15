# Code map: what is where and why

For the "opened the project a month later and remember nothing" case. For every file: what it
does, why it exists and what is not obvious about it. The code itself has no comments, so the
explanations live here. How the mechanisms work as a whole: [`ARCHITECTURE.md`](ARCHITECTURE.md);
the endpoint reference: [`API.md`](API.md).

## Where to start reading

To recall the project in five minutes, in this order:

1. `app/main.py`: every endpoint at a glance
2. `app/config.py`: every setting in one place
3. `app/routers/predict.py` → `app/services/ml_service.py`: the shortest path from HTTP to the
   model

---

## Tree

```
app/                      the web service
├── __init__.py           empty
├── main.py               entry point, assembling the app
├── cli.py                the sfss command: the daemon and calls to it from a terminal
├── security.py           who has access: this machine, a key, the page Origin
├── static/playground/    the Playground as one HTML file, built from playground/ by scripts/update_playground.sh
├── config.py             all settings
├── dependencies.py       creating services (one instance per process)
├── models/schemas.py     request and response formats
├── routers/              the HTTP layer: parsing requests and error codes
│   ├── health.py
│   ├── llm.py
│   ├── dashboard.py
│   ├── query.py
│   ├── predict.py
│   ├── ingest.py
│   └── documents.py      report list, PDF upload, a page as a PDF
└── services/             all logic, without a single mention of HTTP
    ├── rag_service.py       search in the documents
    ├── embedder.py          the search model in ONNX
    ├── vector_store.py      chunks and vectors on disk
    ├── keyword_search.py    keyword search (BM25) and fusion with vector search
    ├── llm_service.py       calls to the local language model
    ├── llm_config.py        model settings: runtime and model, data/llm.json
    ├── llm_runtime.py       LM Studio and Ollama: state, loading, starting the server
    ├── ml_service.py        burning rate prediction
    ├── dashboard_service.py summary for front ends
    ├── ingest_service.py    parsing PDF and CSV
    └── document_service.py  corpus files: what is there, adding, which page

scripts/                  offline jobs, run by hand
├── ingest_documents.py   indexing the documents
├── build_flex_dataset.py building the FLEX dataset (used for training)
├── build_bass_dataset.py building the BASS-II dataset (not used for training)
├── train_model.py        training and an honest evaluation of the model
└── update_playground.sh  building the Playground into app/static/playground

examples/                 a third-party program on the API: an atmosphere monitor
tests/                    pytest, run without a model runtime and without the search model
data/                     reports, datasets, model and index in git
docs/                     documentation
playground/               Playground sources: React, built into app/static/playground
```

**The main principle:** routers hold no logic, services know nothing about HTTP. So services can
be called from scripts and replaced in tests.

---

## app/: the web service

### `main.py`

Creates the FastAPI app and plugs in the routers, each both without a prefix and under `/v1`.
Also CORS (the allowed origins come from `security.py`), the `/playground` page and the warm-up at
start: the keyword index, the search model and the fiery model load before the first request, so
an open port means a ready service.

Run: `uvicorn app.main:app --reload`

### `config.py`

The only place settings live. Reads `.env`; everything has a default, so the service starts
without `.env` too.

Worth knowing:

| Setting | Value | What it affects |
|---|---|---|
| `lm_studio_base_url` | `http://localhost:1234/v1` | the default runtime; `data/llm.json` takes precedence |
| `lm_studio_model` | Ministral 3B (MLX) | the default model; `data/llm.json` takes precedence |
| `llm_config_path` | `data/llm.json` | what a person configured: `sfss config`, `PATCH /v1/llm/config` |
| `index_dir` | `data/index` | the ready index, in git |
| `embedding_dir` | `data/embedding` | the search model, downloaded at installation |
| `embedding_model` | `paraphrase-multilingual-MiniLM-L12-v2` | multilingual: a Russian question finds English text, though worse than an English one |
| `top_k` | 3 | how many chunks go into the prompt |
| `hybrid_search` / `keyword_weight` | `true` / 1.5 | vectors + keyword search (ARCHITECTURE § 7.13) |
| `translate_queries` | `true` | search by the English translation of a Russian question (ARCHITECTURE § 7.11) |
| `answer_ru_via_english` | `true` | write a Russian answer in English and translate it (ARCHITECTURE § 7.12) |
| `chunk_size` / `chunk_overlap` | 500 / 50 | chunk size in **words** |
| `llm_system_prompt` | | the "answer only from the context" instruction, in Russian |
| `llm_system_prompt_en` | | the same for English answers and for Russian ones through an English draft |
| `sfss_api_key` | none | needed only for access from other machines |

`embedding_model` cannot change without a full re-index: old vectors are incompatible with a new
model.

### `dependencies.py`

Creates services through `@lru_cache`, one instance per process: the search model and the
indexes must not be loaded per request. Tests replace these same functions with stubs through
`app.dependency_overrides`.

### `security.py`

Who may call the API. Requests from this machine pass without a key; from other addresses a key
is needed (`X-API-Key` or `Authorization: Bearer`). A page from a foreign Origin is not trusted
even from this machine: otherwise any site open in the browser could drive the service. Trusted
without a key: `localhost`, `127.0.0.1`, the Tauri window, an HTML file from disk, and whatever
the `ALLOWED_ORIGINS` regular expression allows.

### `cli.py`

The `sfss` command. It computes nothing itself: `predict` and `ask` go to the daemon over the same
API as any third-party program, so the command answers at once instead of loading models.

- `start` starts uvicorn as a background process with a log in `data/run/sfss.log` and waits for
  `/v1/health`. On Unix the daemon gets its own session; on Windows a new process group without a
  console window and, where the job allows it, leaves the terminal's job, so the service survives
  closing an SSH session.
- `stop` checks that the pid really belongs to our uvicorn (`ps`, or PowerShell on Windows) before
  killing it: after a reboot the number could belong to someone else.
- `predict` fills in nitrogen to make the mixture add up to one; `--csv` sends the table to
  `/v1/predict/batch`.
- `ask` reads `/v1/query/stream` and prints the text as it comes.
- `config` changes settings through the daemon or, if it is off, in `data/llm.json`.
- On Windows the output is switched to UTF-8: `mm²/s` and `×` would otherwise break `print`.

### `models/schemas.py`

Pydantic schemas of all requests and responses: the API contract as code. FastAPI validates input
and builds the `/docs` page from them. Field descriptions are there too. Full description:
[`API.md`](API.md).

### `routers/`: thin files

Each parses the request, calls a service and turns exceptions into HTTP codes. No logic here on
purpose.

| File | Endpoint | What becomes an error code |
|---|---|---|
| `health.py` | `GET /health` | nothing, always 200 |
| `llm.py` | `POST /v1/llm/load`, `/v1/llm/config`, `/v1/llm/models` | the model did not load → 503 with the reason; a setting does not fit → 422; loading in progress → 409 |
| `dashboard.py` | `GET /dashboard` | nothing, it degrades softly |
| `query.py` | `POST /query` | any runtime error → 503 (not 500: an external dependency) |
| | `POST /query/stream` | the same as an NDJSON stream; an error mid-answer is an `error` event |
| `predict.py` | `POST /predict`, `/v1/predict/batch` | model not trained → 503; an unknown parameter or a feature without a default → 422 |
| `documents.py` | `/v1/documents` | a scan without text or not a PDF → 422; the name exists → 409; too large → 413 |
| `ingest.py` | `POST /ingest` | nothing |

---

## app/services/: the logic

### `rag_service.py`

Search in the documents: our own index (`vector_store.py`) and the search model in ONNX
(`embedder.py`). The model loads on the first question or at warm-up, so counting, the report list
and keyword search work without it.

- `retrieve()`: hybrid search, the 20 nearest by vectors and the 20 best by keywords, fused, then
  `top_k`; with `filters`, vectors only. Returns the chunks with `doc_id` and page number
- `keyword_index()`: a BM25 index over the whole index; built at warm-up, rebuilt when the number
  of chunks changes
- `count()`: how many chunks are indexed
- `ping()`: whether the index exists
- `warm_up()`: load the search model in advance

An empty index returns an empty list and a log warning: not an error.

### `embedder.py`

The search model `paraphrase-multilingual-MiniLM-L12-v2` in ONNX, int8: onnxruntime and tokenizers
instead of PyTorch and sentence-transformers. The mean of token vectors, as in
sentence-transformers; the vectors match the previous ones to 99.65 % or better by cosine.
`python -m app.services.embedder` downloads the model with a pinned revision and a sha256 check
into `data/embedding`. Why: ARCHITECTURE § 7.23.

### `vector_store.py`

Chunks and vectors in two files: `data/index/chunks.jsonl` and `vectors.npy`. Search is an exact
cosine scan; on 1131 chunks it takes milliseconds. The `get`, `query`, `upsert`, `delete` and
`count` methods repeat what the service used from a Chroma collection, with the `where` filter in
the same form. Writes are atomic.

### `keyword_search.py`

No dependencies, pure functions: tested without the search model.

- `KeywordIndex`: BM25 over the chunks; question stop words ("how", "does") are dropped
- `fuse()`: reciprocal rank fusion of two lists with a weight for keyword search

Why and with which numbers: ARCHITECTURE § 7.13.

### `llm_service.py`

Calls to the language model. The client is the `openai` library, but with `base_url` pointing to
the runtime: LM Studio and Ollama serve an OpenAI-compatible API, so no separate SDK is needed and
nothing leaves the machine. What that API lacks (state, loading, starting the server) lives in
`llm_runtime.py`. Settings change on the fly: `update_config` unloads the previous model and swaps
the client.

- `search_query()`: the search text. A Russian question is translated into English through the
  runtime with a JSON answer schema; an English one is returned as is; on any failure, the original
  question
- `build_context()`: joins the found chunks into blocks like `[NTRS-20000030678, стр. N]` + text:
  the report number without the file name tail, `p. N` for `language="en"`. The model copies this
  header into the answer's references
- `generate_stream()`: the same as `generate()`, but as `stage` and `delta` events; the Russian
  translation is pulled out of the JSON stream by `JsonStringStream`
- `translate_answer()`: an English answer into Russian, also with a JSON schema; `None` if it
  failed
- `generate()`: for `language="ru"` writes the answer in English and translates it, and answers
  in Russian directly if the translation fails. The model call itself is `_answer()`: a system
  prompt requiring answers only from the context, `temperature=0.2` for reproducibility; with a
  `language`, the instruction from `LANGUAGE_INSTRUCTIONS` is appended to the prompt

An important detail: if no chunks were found, it returns "no data" (in the question language) at
once, without calling the model. That saves a minute of waiting.

The language instruction lives here, not in the question: the question goes to search, and an
addition to it changes the pages found (ARCHITECTURE § 7.10).

### `llm_config.py` and `llm_runtime.py`

`llm_config.py` keeps what a person configured in `data/llm.json`, merges it with `.env`, validates
changes and rejects models banned by the rules (§ 7.18). `llm_runtime.py` knows each runtime: is it
answering, which models it has, how to load and unload a model and how to start its server (`lms`
for LM Studio, `ollama serve` and `keep_alive` for Ollama). It looks for the commands in standard
places too, because the daemon does not start from a shell and `PATH` may lack them.

LM Studio names a model `publisher/name` once two builds of it are downloaded, for example MLX and
GGUF. `LMStudioRuntime` then finds a short name from the settings among them: the loaded build
first, then the native format (`native_format()`: MLX on Apple Silicon, GGUF elsewhere). Each
`state()` remembers the found id, and `resolved()` gives it to loading, unloading and
`LLMService.model_id` for the requests themselves.

### `ml_service.py`

Prediction. The model is called `fiery` and lives in `data/models/fiery.joblib`.

- `_load()`: lazy loading on the first request; without the file it raises
  `ModelNotTrainedError` with the command to run
- `resolve()`: completes the request with values from `FEATURE_DEFAULTS` and remembers which ones
  were filled in; an unknown parameter name raises an error instead of being ignored
- `_vectorize()`: builds a `DataFrame` **with column names**, not a numpy array: the model was
  trained on named columns, and without names sklearn complains about a schema mismatch
- `_score()`: turns the prediction into a 0..1 `risk_score` over the training range and returns
  the raw value separately
- `_build_chart()`: 20 points of "risk versus oxygen" for a chart

`fiery.joblib` holds a dictionary, not a bare model: the model, the feature list **in the right
order**, the task type, the target name and its range. Feature order is critical: if it differs
from training, predictions are silently wrong.

### `dashboard_service.py`

Gathers what a front end draws on load into one response: FLEX experiment points from
`data/processed/flex.csv`, model quality and corpus contents.

It computes nothing on the fly. Metrics and feature importance come **from the model artifact**,
where `train_model.py` puts them. They must not be hard-coded: after retraining they would lie,
and nobody would notice.

It degrades softly: no dataset → `rows: 0`, no model → `trained: false`, no index → `chunks: 0`.
The endpoint always answers 200, and a front end decides from these fields which panels to show.

### `ingest_service.py`

Parsing files from `data/raw`.

- PDF → text per page through `pypdf` → chunks of about 500 words with an overlap of 50 → into the
  index with `doc_id`, `source`, `page` metadata. That is where the page references in `/query`
  answers come from
- CSV → cleaning with pandas → `data/processed/<name>.csv`

The chunk id is deterministic: `{doc_id}-p{page}-c{number}-{hash}`. Before writing, the previous
chunks of the same file are removed, so re-indexing does not create duplicates even when the text
is extracted differently.

`detect_shift()` and `shift_text()` repair PDFs whose fonts lack ToUnicode, where pypdf returns
text with shifted character codes (that is how the FLEX report `NTRS-20120015928` was broken). The
shift is found automatically: a normal English text has 20-30 % stop words, a shifted one has none,
so the shift that brings stop words back wins. Details: ARCHITECTURE § 11, item 7.

A PDF without a text layer (a scanned image) gives zero chunks and a log warning. There is no OCR.

### `document_service.py`

The corpus files: the report list with chunk counts, adding an uploaded PDF (with size, type and
text checks, then indexing), and cutting out one page as a separate PDF for the page viewer. A
`doc_id` is only ever compared with file names from the folder and never used to build a path,
so a request cannot reach a file outside `data/raw`.

---

## scripts/: run by hand

### `ingest_documents.py`

A wrapper around `IngestService` for the terminal. Does the same as `POST /ingest`, but handier:
you see the result and there is a `--force` flag.

### `build_flex_dataset.py`: **used for training**

Extracts the FLEX test table from the PDF report `NTRS-20150023456.pdf` (pages 26-34) with a
regular expression and builds `data/processed/flex.csv`: 273 fuel droplet combustion experiments
on the ISS.

What it provides: atmosphere composition, pressure and initial droplet diameter as features;
burning rate, extinction diameter and burn time as measured results.

Not obvious: the `condition` column is the environment code extracted from an id like `C14M101`.
Experiments with one code were run back to back in one atmosphere, so they are not independent
rows and must fall into the same fold in evaluation.

### `build_bass_dataset.py`: **not used for training**

Builds the BASS-II dataset by joining two sources: the experiment table from the NASA PSI website
(numbers) and Appendix A of report `NTRS-20210011385` (the outcome, missing from the website
table).

The trickiest part of the project, and in the end no model is built on this data: the target
turned out to reflect the experiment protocol, not the material properties (details:
`ARCHITECTURE.md`, section 7.7). The file stays because the data will be useful if measured limits
appear.

What is useful and reusable in it:

- joining the table with the PDF on the "test number + sample number" pair: the test number alone
  is not enough, the id `O2` is indistinguishable from the oxygen formula
- converting instrument readings into flow speed with the calibration table, matching the curve
  to the day of the experiment
- parsing sample descriptions into numeric features: `100-µm`, `1/4 in`, `2 cm wide`

### `train_model.py`

Training and, more importantly, **an honest evaluation**. It handles both tasks, regression and
classification, chosen by the type of the target column.

Why it is not five lines of `train_test_split`: a naive evaluation on such data overstates the
quality. So the script has:

- **grouped cross-validation** (`--group`): rows of one group never split between training and
  test, otherwise the model "guesses" from memory
- **a baseline next to the metric**: the share of the most frequent class for classification, a
  constant mean for regression. Without it the number is unreadable
- **`--exclude`**: columns that must not be features: measured experiment results would leak the
  target
- **an imputer** inside the pipeline: missing values are normal (a film has no diameter), but
  KMeans cannot handle them
- **`--dry-run`**: measure the quality without overwriting the model

The command that trained the current model is in [`../README.md`](../README.md).

### `update_playground.sh`

Builds the Playground from `playground/` with Vite and inlines script and styles into one HTML file
in `app/static/playground`. The built file is in git, so the service needs no Node.

---

## tests/

254 tests in a couple of seconds.

`conftest.py` replaces the services with stubs through `app.dependency_overrides`. So the tests
**need neither a model runtime, nor the search model, nor a trained model**: they check the HTTP
contract, not the integration. `test_installers.py` checks the installers for things that break
silently on someone else's machine: the BOM in `install.ps1`, Unix line endings in `install.sh`,
the same pinned versions in both.

Run: `pytest`

These tests do not check the live chain with the real model and data: for that there is the manual
procedure in [`SMOKE-TEST.md`](SMOKE-TEST.md).

---

## data/: almost everything in git

| Folder | Contents |
|---|---|
| `data/raw/` | sources: 16 NASA report PDFs, PSI tables in CSV |
| `data/processed/` | built datasets: `flex.csv`, `bass_ii.csv` |
| `data/index/` | the index: 1131 chunks and their vectors, 3.5 MB |
| `data/embedding/` | the search model, downloaded at installation, not in git |
| `data/models/` | `fiery.joblib` and `fiery_clusters.joblib` |

`raw/`, `processed/`, `models/` and `index/` are in git, about 145 MB: the largest file is 47 MB,
under GitHub's 100 MB limit. The ready index saves installation a minute of indexing. The search
model is 113 MB and does not fit into git: the installer downloads it. `data/run/` and
`data/llm.json` are the daemon state and a person's settings, not in git.

---

## Further reading

| Question | Where |
|---|---|
| How to start the server | [`../README.md`](../README.md) |
| How to check by hand that everything works | [`SMOKE-TEST.md`](SMOKE-TEST.md) |
| Which fields an endpoint has | [`API.md`](API.md) |
| Why it is built this way | [`ARCHITECTURE.md`](ARCHITECTURE.md), section 7, the decision log |
| Known limitations | [`ARCHITECTURE.md`](ARCHITECTURE.md), section 11 |
| What was tried and did not work | [`ARCHITECTURE.md`](ARCHITECTURE.md), section 12, dead ends |
| What was asked for originally | [`anti-fire-backend-mvp.md`](anti-fire-backend-mvp.md) |
