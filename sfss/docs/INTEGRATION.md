# Connecting to SFSS

SFSS is a service that runs in the background and does the calculations. The Anti-Fire app, the
Playground and the `sfss` command all use the same API. Your program can too.

## From zero to the first answer

```bash
./install.sh                # once, from the repository root: docs/install
sfss start --with-llm
curl -X POST http://127.0.0.1:8000/v1/predict -H 'Content-Type: application/json' \
  -d '{"parameters": {"oxygen_level": 0.30, "n2": 0.70}}'
```

Interactive schema of all requests: http://127.0.0.1:8000/docs.

## What you can ask

| Request | What it does | Needs the language model |
|---|---|---|
| `GET /v1/health` | state of the service, index and model | no |
| `GET /v1/dashboard` | FLEX experiments, model quality, corpus contents | no |
| `POST /v1/predict` | burning rate for one set of conditions, with an oxygen chart | no |
| `POST /v1/predict/batch` | many conditions in one request, JSON or CSV | no |
| `POST /v1/query` | an answer from the NASA reports with references, in one piece | **yes** |
| `POST /v1/query/stream` | the same, with the text arriving as it is generated | **yes** |
| `GET`, `PATCH`, `DELETE /v1/llm/config` | model settings: LM Studio or Ollama, port, model | no |
| `GET /v1/documents` | which reports are in the corpus | no |
| `POST /v1/documents` | add a PDF to the corpus | no |
| `GET /v1/documents/{doc_id}/pages/{n}` | one report page as a PDF | no |

Response fields in detail: [`API.md`](API.md).

## Calculations

```bash
curl -X POST http://127.0.0.1:8000/v1/predict/batch -H 'Content-Type: text/csv' \
  --data-binary @runs.csv
```

CSV columns are named like the model features: `oxygen_level`, `n2`, `co2`, `he`,
`pressure_mmhg`, `d_initial_mm`, `fuel_heptane`, `fuel_methanol`. An empty cell means "not set".
A bad row gets an `error` field; the others are calculated. The same from the terminal, writing
a results table:

```bash
sfss predict --csv runs.csv --out results.csv
```

**Read `warnings`.** They say why the number deserves less trust:

- conditions outside the training range. The model is trained on oxygen 0.12–0.34; above that it
  plateaus and does not grow;
- gas fractions do not add up to one. **The API does not fill in nitrogen by itself**:
  `{"oxygen_level": 0.30}` means 30 % oxygen plus the 79 % nitrogen of air, 109 % in total. Pass
  `n2` explicitly. `sfss predict` fills it in for you.

The model covers **fuel droplets** from the FLEX experiments. Materials (fabric, plastic, cables)
are not in it.

## Asking the reports from Python

Only `httpx` is needed. The model takes tens of seconds to answer: the first words of a Russian
answer appear after about 50 s, hence the long timeout.

```python
import json
import httpx

question = {"question": "How does helium affect combustion?", "language": "en"}
with httpx.stream("POST", "http://127.0.0.1:8000/v1/query/stream",
                  json=question, timeout=180) as response:
    response.raise_for_status()
    for line in response.iter_lines():
        event = json.loads(line)
        if event["type"] == "delta":
            print(event["text"], end="", flush=True)
        elif event["type"] == "sources":
            sources = event["sources"]
        elif event["type"] == "error":
            raise RuntimeError(event["detail"])
print()
for source in sources:
    print(source["doc_id"], source["page"])
```

A runtime failure in the middle of an answer arrives as an `error` event: status 200 has already
been sent by then, so checking the status is not enough.

The numbers in references like `[NTRS-20000030678, p. 97]` lead to the page:
`GET /v1/documents/NTRS-20000030678/pages/97`.

## Your own documents

```bash
curl -X POST http://127.0.0.1:8000/v1/documents -F file=@report.pdf
```

The answer arrives once the document is searchable: a large report takes minutes to index. A
text layer is required: a scan returns 422, there is no OCR. The limit is 100 MB
(`MAX_UPLOAD_MB`). A file with the same name already exists: 409.

## Access

- **From this machine, no key is needed.**
- **From another address, a key is needed.** Set `SFSS_API_KEY` in `.env`, run
  `sfss start --host 0.0.0.0` and send `X-API-Key: <key>` or `Authorization: Bearer <key>`.
  Without a key in `.env`, such a start refuses to run. Traffic is not encrypted: an untrusted
  network needs a TLS proxy. A proxy on the same machine disables the address check, because all
  its requests come from 127.0.0.1, so it must check the key itself.
- **Pages in a browser.** Without a key only `localhost`, `127.0.0.1`, the Tauri window and an
  HTML file from disk are trusted. For other sites set the `ALLOWED_ORIGINS` regular expression,
  otherwise the browser will not hand them the response.

## A third-party example

[`examples/telemetry_monitor.py`](../examples/telemetry_monitor.py): a mock station atmosphere
monitor, about a hundred lines, only `httpx` needed. It reads telemetry, sends it in batches to
`/v1/predict/batch` and asks the NASA reports when the threshold is exceeded:

```bash
.venv/bin/python examples/telemetry_monitor.py
```

The telemetry is made up and the threshold is arbitrary.

## Looking without your own program

- `sfss playground` opens the Playground: play with it and see the idea.
- The Anti-Fire app is a working client: calculations, CSV, questions to the reports, and a
  terminal that shows every request.

## When something does not work

```bash
sfss status
sfss logs -n 100
```

| What you see | What it is | What to do |
|---|---|---|
| connection refused | the daemon is not running | `sfss start` |
| 401 | another address or a site without a key | a key, see "Access" |
| 503 on `/v1/query` | the model did not load, the reason is in `detail` | `sfss load` shows the same |
| 503 on `/v1/predict` | the model is not trained | `scripts/train_model.py`, see README |
| 413 | more than 10 000 rows or 100 MB | split the request |
| 422 | a wrong parameter or file | the reason is in `detail` |
| a question takes minutes | a large model context or swapping | `sfss load` reloads with context 8192, `sfss status` |
