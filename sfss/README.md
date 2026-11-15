# SFSS: the service

A RAG + ML service over NASA data on combustion in microgravity
(NASA Space Apps 2026, "Flame in Freefall").

It does two things:

- **answers questions** from NASA reports, with references to the document and page;
- **predicts the burning rate** of a fuel droplet from the atmosphere composition.

---

## Quick start

This folder is part of the SFSS-Dev repository: the `sfss` service and the Playground in
`playground/`. The Anti-Fire app is next to it, in `../apps/anti-fire`. The NASA reports, the
trained model and the ready index are in git. The service runs in the background and is
controlled with the `sfss` command:

```bash
./install.sh                   # from the SFSS-Dev root, once; Windows: install.ps1
sfss start --with-llm          # the daemon and the model with context 8192
sfss status
```

What the installer does, removal and troubleshooting, per system: [`../docs/install/`](../docs/install/).

The model loads by itself on the first question. To load it in advance: `sfss load`, the button
in Anti-Fire, or `POST /v1/llm/load`. To unload: `sfss unload` or the same button. LM Studio does
not need to be open, but it must be installed. Ollama works instead of it: see "Language model
settings".

```bash
sfss predict --o2 0.30 --psi 8.2
sfss ask "How does helium in the atmosphere affect combustion?"
sfss predict --csv runs.csv --out results.csv
sfss import report.pdf
sfss playground                # the Playground in a browser
sfss logs -f
sfss stop
sfss help predict
```

The daemon pid and log are in `data/run/`. For development, `.venv/bin/uvicorn app.main:app
--reload` is still handier.

Open **http://localhost:8000/docs** to try every endpoint with the mouse.

Check that everything is alive without `sfss`:

```bash
curl http://localhost:8000/health
```

Expected: `"status": "ok"`, `"indexed_documents": 1131`.

**If `"lm_studio": false`**, the model runtime is not running. It is only needed for `/query`;
`/predict` works without it. How to start it: "LM Studio" below.

> Commands start with `.venv/bin/...` so you do not have to activate the environment. If you
> prefer activating it: `source .venv/bin/activate`, then just `uvicorn`, `python`, `pytest`.

---

## Documents

| Document | About |
|---|---|
| [`docs/SMOKE-TEST.md`](docs/SMOKE-TEST.md) | **how to try it by hand and see that nothing broke** |
| [`docs/CODEMAP.md`](docs/CODEMAP.md) | what every code file does |
| [`docs/INTEGRATION.md`](docs/INTEGRATION.md) | **how to connect your own program to SFSS**; a working example: [`examples/telemetry_monitor.py`](examples/telemetry_monitor.py) |
| [`docs/API.md`](docs/API.md) | endpoint reference with examples |
| [`docs/DEMO.md`](docs/DEMO.md) | the 3-minute demo script |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | requirements after the call with the organisers and what was done |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | how it works and why; the log of all decisions |
| [`docs/anti-fire-backend-mvp.md`](docs/anti-fire-backend-mvp.md) | the original specification |

---

## Four requests to remember what it can do

```bash
# 1. Status
curl http://localhost:8000/health

# 2. Dashboard data in one request
curl -s http://localhost:8000/dashboard

# 3. A question to the NASA reports (needs the model runtime)
curl -X POST http://localhost:8000/query \
  -H 'Content-Type: application/json' \
  -d '{"question": "How does oxygen concentration affect flame spread?"}'

# 4. Burning rate prediction
#    Pass only what you change; the rest is filled in (standard air)
curl -X POST http://localhost:8000/predict \
  -H 'Content-Type: application/json' \
  -d '{"parameters": {"oxygen_level": 0.30}}'
```

The last one returns `predicted_value`, the burning rate in mm²/s. All fields and errors are
described in [`docs/API.md`](docs/API.md).

To check that the model answers sensibly rather than inventing things, go through
[`docs/SMOKE-TEST.md`](docs/SMOKE-TEST.md): four requests with reference answers, including a
control question for hallucinations.

---

## Language model settings

The runtime (where the model runs) and the model (which one) are set separately, at once and
without a restart: the `sfss config` command, the "AI settings" window in Anti-Fire and the
Playground, `config` in the Anti-Fire terminal, `GET` and `PATCH /v1/llm/config`.

```bash
sfss config                                 # current settings
sfss config runtime ollama                  # the runtime and its default port, 11434
sfss config runtime --port 1235             # the port only
sfss config runtime lmstudio --host 10.0.0.5 --port 1234
sfss config models                          # models the runtime has
sfss config model ministral-3:3b --max-tokens 256
sfss config reset                           # back to the values from .env
```

Settings live in `data/llm.json` and take precedence over `.env`. When the daemon is off, the
command edits this file and the setting applies on `sfss start`.

| | LM Studio | Ollama |
|---|---|---|
| Default port | 1234 | 11434 |
| The service starts the server itself | `lms server start --port` | `ollama serve` |
| Loading and unloading the model | `lms` | `POST /api/generate` with `keep_alive` |
| Context | from SFSS settings, 8192 | set in Ollama itself: `OLLAMA_CONTEXT_LENGTH` |
| The model stays in memory | until unloaded | may leave 5 minutes after an answer; the next question loads it again |

With Ollama, download the model first: `ollama pull name`. Ollama support is tested with unit
tests and against an imitation of its API. Chinese models, banned by the hackathon rules, are
neither listed nor accepted (ARCHITECTURE § 7.18).

---

## LM Studio

Needed only for `/query`: it generates the text. Everything runs locally; nothing leaves the
machine.

1. Open LM Studio → the **Developer** tab (Local Server)
2. Load `mlx-community/Ministral-3-3B-Instruct-2512-4bit` with context length 8192 (LM Studio
   defaults to 262 144, which means swapping on 8 GB)
3. Press **Start Server**

Check:

```bash
curl -s localhost:1234/api/v0/models   # state of all models
```

**Which build.** On a Mac with Apple Silicon take MLX. Everywhere else take GGUF `Q4_K_M`, the
closest to MLX 4bit:
[mistralai/Ministral-3-3B-Instruct-2512-GGUF](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF)
or the same quant in
[lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF](https://huggingface.co/lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF).
In September GGUF answered in about 120 s on a Mac and hit the timeout. On the November LM Studio
runtime it passes the smoke test in 32-36 s per `/query`, while MLX takes 24-36 s:
[`docs/TEST-RUN-2026-11-15-GGUF.md`](docs/TEST-RUN-2026-11-15-GGUF.md).

The model is the one in `LM_STUDIO_MODEL` in `.env` or `sfss config model`. While one build is
downloaded, LM Studio calls it `ministral-3-3b-instruct-2512`. With two, the names get the
publisher in front, `mlx-community/…` or `mistralai/…`. The short name still works: SFSS takes the
loaded build, otherwise the native one (MLX on Apple Silicon, GGUF elsewhere), and loads,
unloads and asks exactly it. A full name pins one build.

---

## Tests

```bash
uv pip install --python .venv/bin/python pytest      # once; uv from PATH or ../.tools/uv
.venv/bin/python -m pytest -q
```

254 tests, a couple of seconds. Services are replaced with stubs, so **neither a model runtime
nor the search model is needed for the tests**.

---

## Rebuilding from scratch

Usually not needed: everything is ready. These commands are for when data got lost.

**Environment:** `../install.sh` from the repository root, or by hand:

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e .
.venv/bin/python -m app.services.embedder     # the search model, 130 MB
```

**Re-indexing the documents** (`data/raw/` → `data/index/`). The ready index is in git; rebuild
it only when the reports or the search model change. About 40 seconds:

```bash
.venv/bin/python scripts/ingest_documents.py --force
```

Commit the new index: `data/index/chunks.jsonl` and `vectors.npy`.

**Rebuilding the dataset and training the model:**

```bash
.venv/bin/python scripts/build_flex_dataset.py

.venv/bin/python scripts/train_model.py \
    --dataset data/processed/flex.csv \
    --target burn_rate_mm2s --group condition \
    --exclude d_extinction_mm burn_time_s
```

This produces `data/models/fiery.joblib` and `fiery_clusters.joblib`. `--dry-run` measures the
quality without overwriting anything.

Why `--group` and `--exclude` are needed and why the evaluation lies without them:
[`docs/CODEMAP.md`](docs/CODEMAP.md), the `train_model.py` section.

---

## Environment variables

`.env` in the service folder (template: `.env.example`):

```
LM_STUDIO_BASE_URL=http://localhost:1234/v1
LM_STUDIO_MODEL=ministral-3-3b-instruct-2512
EMBEDDING_MODEL=paraphrase-multilingual-MiniLM-L12-v2
SFSS_API_KEY=
```

`SFSS_API_KEY` is needed only when programs connect from other machines. The search model is in
`data/embedding`, the index in `data/index`. No network is needed to run: the model is downloaded
once at installation, with a pinned revision and a checksum (`app/services/embedder.py`).

---

## Project state

All MVP readiness criteria from the specification are met:

- [x] `/health` answers with the model runtime and the index up
- [x] documents are indexed: **1131 chunks from 16 NASA reports**, `/query` answers with page
      references
- [x] the dataset is processed, `/predict` gives a real result: model **fiery**, R² 0.65 versus
      zero for a constant
- [x] endpoints are covered by pytest
- [x] a README with startup instructions

What is outside the MVP and why: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), sections 11
(limitations) and 12 (dead ends).
