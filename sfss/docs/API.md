# API reference

The server listens on `http://localhost:8000`; interactive documentation is at
`http://localhost:8000/docs`.

`/query` needs a running model runtime (**LM Studio** or Ollama), see
[`../README.md`](../README.md), "LM Studio".

| Method | Path | What it does | Needs the runtime | Time |
|---|---|---|---|---|
| GET | `/health` | service and dependency status | no | instant |
| GET | `/dashboard` | data for drawing a page | no | instant |
| POST | `/query` | an answer from NASA documents with references | **yes** | 33-46 s |
| POST | `/predict` | burning rate prediction | no | instant |
| POST | `/v1/llm/load` | load the model, start the LM Studio server | no | up to a minute |
| POST | `/v1/llm/unload` | unload the model from memory | no | seconds |
| GET | `/v1/llm/config` | model settings: runtime and model | no | instant |
| PATCH | `/v1/llm/config` | change settings at once, without a restart | no | up to a minute if it unloads the previous model |
| DELETE | `/v1/llm/config` | back to the values from `.env` | no | same |
| GET | `/v1/llm/models` | models the runtime has | **yes** | instant |
| POST | `/ingest` | re-index `data/raw` | no | minutes |

---

All paths are available with the `/v1` prefix, and new code should use it. Paths without the
prefix are hidden from the schema and kept for the Playground and recorded fixtures. Batch
prediction and documents exist only under `/v1`. How to connect your program and how access
works: [`INTEGRATION.md`](INTEGRATION.md).

## Building a front end? Read this first

**Order on page load:**

1. `GET /health` to check that the back end is alive. It answers in milliseconds. The server
   warms up at start (a few seconds), so the rule is simple: **if the port is open, it is
   ready**. If there is no connection, show a "back end not running" screen with the command,
   not a spinner.
2. `GET /dashboard`: everything to draw — experiment points, model quality, corpus contents. One
   call, about 47 KB.
3. Then `POST /predict` on every slider move: it is instant.

**Never call `POST /query` on page load.** It takes 33-46 seconds. Only on an explicit user
action, with an honest waiting indicator. For a UI `POST /query/stream` is better: the text
arrives as it is generated. Raise the `fetch`/`axios` timeout to at least 90 seconds, otherwise
the request breaks off mid-generation.

**Four rules that are easy to break:**

| | |
|---|---|
| show `predicted_value` with units from `model.units`, not `risk_score` | "0.55 mm^2/s" means something, "0.49" does not |
| `is_heuristic: true` must change the label in the UI | otherwise a stub looks like a model prediction |
| non-empty `sources` does not mean the answer is grounded | search always returns 3 chunks, even when the model refused to answer |
| show `defaults_applied` | the user must know which conditions were chosen for them |

---

## GET /health

Checks that the service is alive and both dependencies answer. The first thing to call when
something does not work.

```bash
curl http://localhost:8000/health
```

```json
{
  "status": "ok",
  "chroma": true,
  "lm_studio": true,
  "model": "ministral-3-3b-instruct-2512",
  "indexed_documents": 1131
}
```

| Field | Meaning |
|---|---|
| `status` | `ok`: both dependencies are alive; `degraded`: at least one is unavailable |
| `chroma` | the report index is in place; the name is kept for compatibility |
| `lm_studio` | the model runtime answers. The old name dates from when there was one runtime |
| `runtime`, `runtime_name`, `runtime_address` | which runtime is configured: `ollama`, `Ollama`, `localhost:11434` |
| `model` | which model is configured (not necessarily loaded) |
| `indexed_documents` | how many chunks are in the index; `null` if there is no index |
| `model_loaded` | the model is in memory; `false`: the service loads it on the first question; `null`: the runtime does not report its state (not LM Studio) |
| `model_context_length` | context length of the loaded model. 8192 is needed: with more, an 8 GB machine starts swapping |
| `model_context_limit` | the context from the settings; `null` if the runtime sets it (Ollama) |
| `model_loading` | the service is loading the model right now |

**`lm_studio: false`**: the runtime server is not running. The status is still 200: the service
is alive and starts the server itself on the first question or on `POST /v1/llm/load`.

---

## POST /v1/llm/load

Starts the LM Studio server if it is off and loads the model with context 8192. A model loaded
with a larger context is reloaded. One already loaded correctly is left alone, so repeating is
safe. No body; the answer arrives when the model is ready.

```bash
curl -X POST http://localhost:8000/v1/llm/load
```

```json
{"model": "ministral-3-3b-instruct-2512", "model_loaded": true, "model_context_length": 8192}
```

503 with the reason in `detail`: no `lms` or `ollama` command, the model is not downloaded, the
runtime is on another machine.

## POST /v1/llm/unload

Unloads the model and frees memory. Same response. An already unloaded model is not an error. An
answer being written at that moment ends with an `error` event. The next question loads the model
again.

## GET /v1/llm/config

```json
{
  "runtime": {
    "kind": "lmstudio", "name": "LM Studio", "host": "localhost", "port": 1234,
    "controls_context": true, "reachable": true
  },
  "model": {
    "name": "ministral-3-3b-instruct-2512", "context_length": 8192, "max_tokens": 512,
    "available": true
  },
  "embedding_model": "paraphrase-multilingual-MiniLM-L12-v2"
}
```

`available`: whether the runtime has the model; `null` if it does not answer.
`controls_context: false` means the context is set in the runtime itself (Ollama) and
`context_length` does not affect it. `embedding_model` is read only: changing it needs a new
index of the reports.

## PATCH /v1/llm/config

Send only what changes. Runtime and model are independent.

```bash
curl -X PATCH http://localhost:8000/v1/llm/config -H 'Content-Type: application/json' \
  -d '{"runtime": {"kind": "ollama"}}'
curl -X PATCH http://localhost:8000/v1/llm/config -H 'Content-Type: application/json' \
  -d '{"model": {"name": "ministral-3:3b", "max_tokens": 256}}'
```

The response is the same as for `GET`. Changing the runtime without `port` sets its default port.
Changing the runtime, model or context unloads the previous model: two do not fit into 8 GB. A
runtime that is not answering now is not an error: it may be started later.

| Code | When |
|---|---|
| 422 | the value does not fit, the reason is in `detail`: port out of range, a host with `http://`, a model banned by the hackathon rules |
| 409 | the model is loading right now |

## DELETE /v1/llm/config

Forgets the settings and goes back to the values from `.env`. Same response as `GET`.

## GET /v1/llm/models

```json
{"runtime": "lmstudio", "models": [
  {"id": "mlx-community/ministral-3-3b-instruct-2512", "loaded": true, "max_context_length": 262144, "selected": true},
  {"id": "mistralai/ministral-3-3b-instruct-2512", "loaded": false, "max_context_length": 262144, "selected": false}
]}
```

Without embedding models and without banned ones. 503 if the runtime does not answer.
`selected` marks the model from the settings. A short name such as `ministral-3-3b-instruct-2512`
matches a build with any publisher; of several builds the loaded one is chosen, then the native
format: MLX on Apple Silicon, GGUF elsewhere.

---

## GET /dashboard

Everything a front end draws on load: real experiments for the charts, model quality and corpus
contents. One call instead of three, about 47 KB, instant.

```bash
curl -s http://localhost:8000/dashboard
```

Three sections.

**`model`**: what the model predicts and how much it can be trusted:

```json
{
  "name": "fiery",
  "task": "regression",
  "target": "burn_rate_mm2s",
  "units": "mm^2/s",
  "target_range": [0.05, 1.06],
  "metrics": {"r2": 0.6524, "mae": 0.0547, "rmse": 0.0808,
              "mae_baseline": 0.1063, "rows": 259.0, "folds": 5.0},
  "feature_importance": {"oxygen_level": 0.3496, "d_initial_mm": 0.2268, "he": 0.182},
  "features": ["pressure_mmhg", "oxygen_level", "..."],
  "defaults": {"pressure_mmhg": 760.0, "oxygen_level": 0.21, "n2": 0.79,
               "co2": 0.0, "he": 0.0, "d_initial_mm": 3.0,
               "fuel_heptane": 0.0, "fuel_methanol": 1.0},
  "is_heuristic": false,
  "trained": true
}
```

Every value in `metrics` is a float, including `rows` and `folds`: the schema declares the field
as `dict[str, float]`.

`mae` next to `mae_baseline` is an honest comparison with a constant answer: 0.055 versus 0.106,
half the error. Show both numbers.

`feature_importance` is a ready "what drives combustion" panel: oxygen 35 %, initial droplet
diameter 23 %, helium 18 %.

`defaults` is what to initialise the sliders with. It is standard air, not sample medians: FLEX
deliberately went through unusual atmospheres, and a per-coordinate median would give a mixture
whose fractions add up to 0.86, which is physically impossible.

**`trained: false`** means the model is not trained: `/predict` returns 503, and the prediction
panel should be hidden or disabled.

**`dataset`**: 273 real FLEX experiments, one object per experiment:

```json
{
  "name": "FLEX",
  "source": "FLEX (Flame Extinguishment Experiment), ISS - test matrix from report NASA/TP-2015-216046, pages 26-34",
  "rows": 273,
  "experiments": [
    {"test": "FLEX-001", "fuel": "methanol", "oxygen_level": 0.21,
     "pressure_mmhg": 757.7, "d_initial_mm": 1.69, "burn_rate_mm2s": 0.52,
     "d_extinction_mm": 0.89, "test_end": "disruption"}
  ]
}
```

These are NASA data, not predictions. Draw them as points on the same chart as the model
prediction: you can see whether the prediction fits the real experiments. Some fields may be
`null`: they are empty in the source table.

**All values in the response are ASCII.** Values that front-end code parses are Latin: the back
end cannot localise them, and a Cyrillic "с" is indistinguishable from a Latin "c" when comparing
strings. Take unit labels from `model.units` and translate them on your side.

**`corpus`**: what is in the index:

```json
{"chunks": 1131, "documents": ["NTRS-20210011385-....pdf"],
 "embedding_model": "paraphrase-multilingual-MiniLM-L12-v2"}
```

`chunks: 0` means an empty index: `/query` cannot answer.

---

## POST /query

Answers a question from the indexed NASA reports. The answer is built **only** from the chunks
found, with the document and page.

How it works inside: [`ARCHITECTURE.md`](ARCHITECTURE.md), section 4.

**Request**

```json
{
  "question": "How does oxygen concentration affect flame spread?",
  "filters": null,
  "language": "en"
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `question` | string | yes | the question; an empty string → 422 |
| `filters` | object or `null` | no | a filter on chunk metadata, like a Chroma `where`: equality, `$in`, `$and`, `$or`. For example `{"doc_id": "NTRS-20210011385-..."}` |
| `language` | `"ru"`, `"en"` or `null` | no | answer language; any other value → 422 |

**Set the answer language with the `language` field, not with a request in the question text.**
The whole question is vectorised for search, and appending "Answer in Russian, translate the terms
like this: ..." pulls the search toward pages resembling the request itself: on eight test topics
only one of 24 chunks matched the search with the bare question. The field goes only into the
model prompt.

A Russian question is searched by its English translation: the corpus is English, and this finds
noticeably more of what is needed. The translation takes about two seconds and comes back in
`search_query`.

With `language: "ru"` the model writes the answer in English and translates it: fewer Latin words
end up in the Russian text, and it is even faster than a direct Russian answer
([`ARCHITECTURE.md`](ARCHITECTURE.md), § 7.12).

Without `language` the model usually answers in Russian, because the system prompt is Russian,
even to an English question. For `ru` a glossary of terms is added to the prompt: without it the
3B model translates "microgravity" as "microscopy".

**Response**

```json
{
  "answer": "Ignition delay decreases as oxygen concentration increases [NTRS-20000030678, p. 91] ...",
  "sources": [
    {
      "doc_id": "NTRS-20000030678-Cooperative-Research-Projects-in-the-Microgra",
      "excerpt": "ignition delay decreases with increasing ambient oxygen concentration...",
      "page": 91
    }
  ],
  "search_query": null
}
```

`search_query`: the English translation used for search; `null` if the question was not Russian
or the translation failed and the question itself was used.

Up to three chunks come back (`top_k` in `app/config.py`).

`sources` is always returned: even if the model did not cite the sources in the text, a front end
can show what the answer is based on.

**Questions may be in Russian** although the documents are in English: the embedding model is
multilingual and finds English chunks for a Russian query.

**The answer "there is no data in the indexed documents"** means retrieval found nothing. The
request does not reach the model in that case.

**Errors**

| Code | When |
|---|---|
| 422 | empty `question` |
| 503 | the runtime does not answer, or `.env` names a model the runtime does not have |

A request takes **33-46 seconds** on an 8 GB Mac: that is the local model at work, not an error.
Most of the time goes into processing the context, not generation.

**The first request after a long idle period may take 20 s more:** LM Studio unloads the model on
a timeout and loads it again. Before a demo, make one warm-up request.

---

## POST /query/stream

The same as `/query`, but the answer comes **as a stream**: the text can be shown as it is
generated rather than after half a minute. The request is the same.

The response is `application/x-ndjson`: one JSON line per event.

```
{"type": "stage", "stage": "loading"}
{"type": "stage", "stage": "searching"}
{"type": "sources", "sources": [{"doc_id": "...", "excerpt": "...", "page": 5}], "search_query": null}
{"type": "stage", "stage": "answering"}
{"type": "delta", "text": "Helium raises "}
{"type": "delta", "text": "the burning rate..."}
{"type": "done", "answer": "Helium raises the burning rate..."}
```

| Event | When | What the front end does |
|---|---|---|
| `sources` | right after search | show the sources while the model thinks |
| `stage` | `loading`: the model was not in memory and the service loads it, then `searching`; `answering`: the model writes the answer; `translating`: it translates the answer into Russian | a waiting label |
| `delta` | a piece of text | append to the answer |
| `done` | last; `answer` is the whole text | replace what was collected with `answer` |
| `error` | the model did not load or the runtime failed mid-answer | show the error; `done` will not come |

A runtime error comes as an `error` event, not as 503: the answer has already started with
status 200 by then. An empty question gets 422, as with `/query`.

For `language: "ru"` the model first writes the whole answer in English (`stage: answering`, no
text meanwhile), and then the translation streams. So the first Russian text appears after 10–20
seconds, but then flows word by word.

Read the stream in a browser with `fetch` and `response.body.getReader()`, splitting on `\n`.
`EventSource` will not do: it only does GET.

---

## POST /predict

Predicts the **burning rate of a fuel droplet** in mm²/s from the atmosphere composition and the
droplet size. The model is called `fiery` and is trained on the FLEX experiment data (ISS). Why
this task: [`ARCHITECTURE.md`](ARCHITECTURE.md), section 7.7.

**Pass only what the user changes.** The rest is filled with defaults: the standard sea-level
atmosphere and a typical methanol droplet. Take the starting slider values from `model.defaults`
in `/dashboard`.

```bash
curl -s -X POST http://localhost:8000/predict \
  -H 'Content-Type: application/json' \
  -d '{"parameters": {"oxygen_level": 0.30}}'
```

The response includes `defaults_applied`, the features missing from the request. **Show this to
the user:** otherwise they will not realise half the conditions were chosen for them.

```json
{"predicted_value": 0.6415,
 "defaults_applied": ["pressure_mmhg", "n2", "co2", "he", "d_initial_mm",
                      "fuel_heptane", "fuel_methanol"]}
```

An empty request `{"parameters": {}}` is valid too: it returns a prediction for standard air.

**An unknown parameter name is a 422 error, not ignored:**

```json
{"detail": "Unknown parameters: ['oxigen_level']. Expected any of: [...]"}
```

On purpose: otherwise a typo would silently be replaced with a default, and the user would get a
plausible but wrong number.

**A full request with every parameter**

```bash
curl -X POST http://localhost:8000/predict \
  -H 'Content-Type: application/json' \
  -d '{"parameters": {
        "pressure_mmhg": 760.0,
        "oxygen_level": 0.21,
        "n2": 0.75,
        "co2": 0.0,
        "he": 0.0,
        "d_initial_mm": 3.0,
        "fuel_heptane": 1.0,
        "fuel_methanol": 0.0
      }}'
```

| Parameter | Units | Example | Meaning |
|---|---|---|---|
| `pressure_mmhg` | mmHg | 760 | ambient pressure |
| `oxygen_level` | mole fraction | 0.21 | oxygen; **the model's main feature** |
| `n2` | mole fraction | 0.75 | nitrogen |
| `co2` | mole fraction | 0.0 | carbon dioxide |
| `he` | mole fraction | 0.0 | helium as a diluent |
| `d_initial_mm` | mm | 3.0 | initial droplet diameter |
| `fuel_heptane` | 0 or 1 | 1.0 | fuel is heptane |
| `fuel_methanol` | 0 or 1 | 0.0 | fuel is methanol |

The last two are one-hot: exactly one of them is 1.

**Response**

```json
{
  "risk_score": 0.492,
  "predicted_value": 0.546,
  "target": "burn_rate_mm2s",
  "cluster": 1,
  "chart_data": {"x": [0.15, 0.163, 0.176], "y": [0.314, 0.316, 0.416]},
  "is_heuristic": false
}
```

| Field | Meaning |
|---|---|
| `predicted_value` | **the prediction itself in physical units**: 0.546 mm²/s |
| `target` | what is predicted: `burn_rate_mm2s` |
| `risk_score` | the same value scaled to 0..1 over the training range |
| `cluster` | the KMeans cluster the conditions fall into |
| `chart_data` | 20 points: how the risk changes as oxygen goes from 0.15 to 0.40 |
| `defaults_applied` | which features were filled in for the user |
| `is_heuristic` | `false`: the trained model; `true`: a heuristic stub |

**Look at `predicted_value`.** `risk_score` exists because the original contract requires it, but
the number 0.49 by itself says nothing: it is just a position between the training minimum and
maximum.

**The `is_heuristic` flag** is an important safeguard. If the model was trained without a target
variable, a heuristic is saved and the flag becomes `true`. A front end must not present such a
result as a model prediction.

**Errors**

| Code | When |
|---|---|
| 422 | an unknown parameter name, or a model feature with no default |
| 503 | the model is not trained, there is no `data/models/fiery.joblib`; the text has the training command |

---

## POST /ingest

A maintenance endpoint, **not for front ends**. Re-indexes `data/raw`: PDFs go into the index,
CSVs into `data/processed/*.csv`.

```bash
curl -X POST http://localhost:8000/ingest -H 'Content-Type: application/json' -d '{"force": false}'
```

```json
{
  "indexed_files": ["NTRS-20210011385-....pdf", "..."],
  "skipped_files": ["NTRS-20150023456.pdf"],
  "chunks_added": 770
}
```

`force: false` skips files already in the index. `force: true` re-indexes everything.

**Careful:** on the full corpus this takes about a minute and changes the index. The script is
handier for the same job: `python scripts/ingest_documents.py`.

**Changing the search model requires a full re-index**; you cannot add on top:

```bash
python scripts/ingest_documents.py --force
```

---

## Differences from the specification

[`anti-fire-backend-mvp.md`](anti-fire-backend-mvp.md), section 4, describes a shorter contract.
The differences are only added fields; nothing was removed:

| Field | Why it was added |
|---|---|
| `predicted_value`, `target` in `/predict` | the model is a regression; without the physical value `risk_score` is unreadable |
| `is_heuristic` in `/predict` | the specification requires not presenting a heuristic as a model prediction |
| `model`, `indexed_documents` in `/health` | diagnostics: which model is configured and whether the index is filled |
