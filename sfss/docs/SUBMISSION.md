# Submission page draft

The project must be submitted on the Space Apps website by 15 November 2026, 23:59 local time.
The requirements are in `ROADMAP.md`. What a person still has to fill in is marked **[to fill]**.

## Team and challenge

- **Team:** TwinByte.
- **Members:** **[to fill]**.
- **Challenge:** Flame in Freefall.

## What the project does

SFSS is a service that runs in the background and does two things: it calculates the burning rate
of a fuel droplet in a given atmosphere and answers questions only from NASA reports, with a page
reference. Any program can connect to it, over the API or from a terminal.

Anti-Fire is a working app on this service: one screen with calculations, CSV import, questions
to the reports and a terminal. SFSS Playground is a place to explore the idea.

## How it works

- **Calculation.** A random forest trained on 259 FLEX experiments from the ISS. Input:
  atmosphere composition, pressure, droplet size and fuel. The answer comes in tens of
  milliseconds, with a warning if the conditions are outside the training range.
- **Questions.** Hybrid search over 1131 chunks from 16 reports and a local model allowed to
  answer only from what was found. Everything runs on one laptop, with no network.
- **Connection.** An HTTP API under `/v1`, batch calculation, PDF upload, the `sfss` command. A
  third-party example is an atmosphere monitor on made-up telemetry: it raises an alarm and asks
  the reports.
- **Installation.** One script per system installs the service and the app without admin rights,
  on macOS, Linux and Windows.

## Advantages

- Every answer can be checked: it links to a NASA report page.
- Works offline and sends no data out.
- It does not replace other programs; it connects to them.

## What we want to achieve

Give an engineer choosing an atmosphere for a spacecraft or a base a quick comparison of the
options and a direct path to the primary source.

**Limitations.** The model covers fuel droplets, not materials: it compares atmospheres and does
not forecast a fire on a station. Mean error 0.055 mm²/s, R² 0.65 in cross-validation by
condition. Answers are written by a small model, so they should be checked against the reference.

## Data

| Data | Source | Used for |
|---|---|---|
| 16 NASA reports | NASA NTRS, https://ntrs.nasa.gov/ | the corpus for answers |
| FLEX experiments, 259 rows | NTRS-20150023456, pp. 26–34 | training the model |
| BASS-II experiments, 129 rows | NASA PSI, PSI-25, https://psi.nasa.gov/ | the Playground |
| BASS manifest | NASA PSI, PSI-26 | cross-checking experiments |

The telemetry in `examples/station_telemetry.csv` is made up, written by us.

## Tools

- **Back end:** Python, FastAPI, uvicorn, onnxruntime, tokenizers, scikit-learn, pandas, NumPy,
  pypdf, httpx, the openai client.
- **Front end:** TypeScript, React, Vite, Tauri.
- **Running models locally:** LM Studio, MLX, Ollama.
- **Installation:** uv (Astral), bash, PowerShell, GitHub Actions.
- **Hardware:** a MacBook with Apple Silicon and 8 GB of memory.

## Where and how AI was used

| Tool | Developer | Where and how |
|---|---|---|
| Ministral 3B | Mistral AI, France | in the product: writes answers from the found chunks and translates into Russian |
| paraphrase-multilingual-MiniLM-L12-v2 | sentence-transformers, ONNX build by Xenova | in the product: vector search |
| Claude Code | Anthropic, USA | development: back-end and Anti-Fire code, tests, installers, documentation |
| **[to fill]** | | what the other members used, for code, text and images |

The prediction model was trained by us on the FLEX data and is not third-party.

There are no NASA logos, flags or insignia in the project. The landing page footer has the Space
Apps logo and a note that the project is not affiliated with NASA.

Until 1 November 2026 answers were written by the local Qwen3-4B model. After the rules changed it
was replaced, the recorded answers were redone, and it is not in the product.

**[to fill]** Check the origin of everything else: `demo.mp4`, the TwinByte logo and other front-end
images. If something was made with AI, add it as a row in the table.
