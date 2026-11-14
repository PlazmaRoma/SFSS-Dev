# SFSS: how it works and why

The working documentation of the service. This document answers "what was done", "why exactly
this way" and "how it works inside".

Everything else: running it in [`../README.md`](../README.md), endpoints in [`API.md`](API.md),
the purpose of every code file in [`CODEMAP.md`](CODEMAP.md), the original assignment in
[`anti-fire-backend-mvp.md`](anti-fire-backend-mvp.md).

Sections 1-6 describe the current state (November 2026). Section 7 is the decision log in the order
the decisions were made, so its early entries describe the system as it was then.

---

## 1. What the system is

The service answers questions from NASA data on combustion experiments in microgravity and
estimates the fire risk from the environment parameters. Two independent halves:

| Half | The question it answers | Technology |
|---|---|---|
| **RAG** (`/query`) | "What do the NASA reports say about X?" | own vector index + a local LLM |
| **ML** (`/predict`) | "How dangerous are these conditions?" | scikit-learn, the **fiery** model |

The key constraint of the whole system: **everything runs locally**. No request with data goes to
an external API: neither embeddings nor generation. The LLM runs in LM Studio or Ollama on the same
machine.

---

## 2. Current status

Against the readiness criteria from section 7 of the specification:

| Criterion | Status |
|---|---|
| `/health` returns 200 with the model runtime and the index up | ✅ checked |
| At least 1 document indexed, `/query` answers with a source reference | ✅ 1131 chunks from 16 reports |
| At least 1 dataset processed, `/predict` gives a non-stub result | ✅ fiery trained on FLEX, R² 0.65 |
| Endpoints covered by pytest (happy path) | ✅ 242 tests |
| A README with startup instructions | ✅ plus installers for three systems |

**All MVP criteria are met.** No more data is expected: everything needed is on disk (§ 7.6).

`fiery` predicts the **burning rate of a fuel droplet** (mm²/s) from the atmosphere composition and
the droplet size; in cross-validation R² = 0.65 versus zero for a constant. Why this task rather
than classifying the BASS-II outcome: § 7.7.

The corpus is indexed in full: all 16 PDFs in `data/raw/` (about 1000 pages) gave 1131 chunks.

---

## 3. Architecture

```
                          ┌──────────────┐
   HTTP :8000             │  app/main.py │  FastAPI, CORS, routers
                          └──────┬───────┘
          ┌──────────────┬───────┴────────┬──────────────┐
          ▼              ▼                ▼              ▼
      /health         /query          /predict       /ingest
          │              │                │              │
          │              ▼                ▼              ▼
          │        RagService        MLService     IngestService
          │              │                │              │
          │              ├─ ONNX model    ├─ fiery.joblib├─ pypdf
          │              │  embeds query  │              │  chunking
          │              ▼                ▼              ▼
          │        ┌───────────┐    ┌───────────┐  ┌──────────┐
          └───────▶│VectorStore│    │data/models│  │ data/raw │
                   │data/index │    └───────────┘  └──────────┘
                   └───────────┘
                         │
                    LLMService ──▶ LM Studio :1234 or Ollama :11434 (Ministral 3B)
```

Services are created lazily and live as one instance per process (`app/dependencies.py`,
`@lru_cache`): the search model and the indexes must not be loaded per request. In tests the same
providers are replaced with stubs through `app.dependency_overrides`.

**Warm-up at start.** Lazy loading meant the very first request paid for the loading, and a front
end polling `/health` took the server for hung. So `lifespan` in `app/main.py` builds the keyword
index and loads the search model and `fiery` before uvicorn starts accepting connections. With the
ONNX search model this takes about 3 seconds (it was 12-16 s with PyTorch, § 7.23).

The contract for front ends becomes honest: if the port is open, the service is ready, and
`/health` can be polled even every 200 ms. It is switched off with `WARMUP_ON_STARTUP=false`, which
the tests do.

If the runtime is off, `/health` takes about a second instead of 5 ms: the connection check waits
for its timeout. It does not affect anything else.

---

## 4. How `/query` works

Five steps; the whole path takes 25-50 seconds on an 8 GB Mac. The bottleneck is the LLM, and not
generation but prompt processing (§ 11, item 1).

**Step 1. Vectorising the question.** A Russian question is first translated into English
(`LLMService.search_query()`, about two seconds): the corpus is English, and the translation finds
noticeably more of what is needed (§ 7.11). An English question goes as is. `RagService.retrieve()`
turns the text into a 384-dimensional vector with `paraphrase-multilingual-MiniLM-L12-v2` in ONNX.
The model answers the original question; the translation is only for search and is returned in the
`search_query` field.

**Step 2. Search.** Hybrid (§ 7.13): the 20 nearest by cosine similarity and the 20 best by BM25,
keyword search, fused into one list with RRF. The top 3 chunks are taken from it (`top_k`; it was
5, lowered for speed, § 11). With `filters` the search is vector only: the filter works like a
Chroma `where` and can limit the search to one document. An empty index returns an empty list and
a log warning.

**Step 3. Building the prompt.** `LLMService.build_context()` joins the chunks into blocks like:

```
[NTRS-20160000593, p. 7]
<chunk text>

---

[NTRS-20150023456, p. 26]
<chunk text>
```

For a Russian answer the label is `стр.` instead of `p.`. The system prompt (in `config.py`)
requires answering **only** from the context, admitting missing data honestly and citing sources.
This is not cosmetic: without such an instruction a 3-billion-parameter model happily invents
plausible numbers.

With a `language` in the request, a language instruction is appended to the user prompt
(`LANGUAGE_INSTRUCTIONS` in `llm_service.py`), for Russian with a glossary of terms. Into the
prompt, not the question: the question goes to search, and any extra text in it changes the pages
found (§ 7.10).

**Step 4. Generation.** A POST to the runtime through the `openai`-compatible client,
`temperature=0.2`: we need reproducibility, not variety.

For `language="ru"` the answer is written in English, to the English version of the question, and
translated with a second request to the same model (§ 7.12). If the translation fails, the model
answers in Russian directly.

**Step 5. The answer.** `{"answer": ..., "sources": [{doc_id, excerpt, page}]}`. Sources are always
returned: even when the model did not cite them in the text, a front end can show what the answer
is built on.

`/query/stream` has the same steps, but the answer goes out as an NDJSON stream (§ 7.14): sources
first, then the text as it is generated.

**Short circuit:** if retrieval found nothing, the model is not called: "there is no data in the
indexed documents" comes back at once. That saves a minute of waiting.

**Error handling:** any runtime exception becomes `503` with the error text, not `500`. In
practice it almost always means "the wrong model in the settings" or "the runtime is not running".

---

## 5. How `/predict` works: the fiery model

**Artifacts.** `data/models/fiery.joblib` (risk scoring) and `fiery_clusters.joblib` (KMeans). The
name is the `MODEL_NAME` constant in `app/services/ml_service.py`; all paths are built from it, so
renaming the model is a one-place change.

**Bundle format.** `fiery.joblib` holds a dictionary, not a bare model:

```python
{
    "model": <sklearn pipeline>,
    "features": ["pressure_mmhg", "oxygen_level", ...],
    "is_heuristic": False,
    "task": "regression",             # regression or classification
    "target": "burn_rate_mm2s",       # returned by /predict as target
    "target_range": (0.05, 1.06),     # for scaling risk_score into 0..1
    "metrics": {...},                 # cross-validated quality
    "feature_importance": {...},      # for /dashboard
}
```

`train_model.py` puts in `metrics` and `feature_importance`; `/dashboard` returns them as they are,
nothing is hard-coded.

`features` is critical: the column order at training and at inference must match.
`MLService._vectorize()` builds a `pandas.DataFrame` **with column names** from the input
dictionary, not a numpy array. So the sklearn pipeline sees the same schema as at training and does
not spew warnings about mismatched features.

**The `is_heuristic` flag** is an important part of the contract, straight from item 5.3 of the
specification. If `--target` was not given at training, no risk model is trained: a heuristic (a
linear combination of normalised features) is saved and the flag is set to `True`. `/predict`
returns the flag. The point: a front end must not be able to present a heuristic as a model
prediction. The stub honestly calls itself a stub.

**`chart_data`** is a sweep of the risk over `oxygen_level` from 0.15 to 0.40, 20 points, with the
other parameters fixed at the given values. Ready data for a "how the risk grows with oxygen" chart.
If the model has no `oxygen_level` feature, an empty chart comes back, not an error.

**Response codes:** `503`: the model is not trained (with a hint about what to run); `422`: an
unknown parameter or a missing feature without a default, listed in the text.

---

## 6. How indexing works

`IngestService.run()` walks through `data/raw`:

**PDF** → text per page through `pypdf` → chunks → upsert into the index. Each chunk's metadata:
`doc_id` (the file name without the extension), `source` (the file name), `page` (the page number
from one). That is where the references in `/query` answers come from. The chunk id is
deterministic: `{doc_id}-p{page}-c{index}-{sha1[:10]}`. Before writing, all previous chunks of the
same `source` are removed: the text hash is part of the id, and if text extraction changed, an
upsert would otherwise leave the old chunks next to the new ones.

**Shifted font encoding.** Before chunking, `detect_shift()` checks whether the character codes are
shifted (§ 11, item 7). If the start of the document has almost no English stop words (`the`,
`of`, `and`…), shifts from −64 to +64 are tried and the one that makes them more than 15 % wins. A
shift that pushes more than 5 % of the characters out of printable ASCII is discarded. A normal
document passes the check in a millisecond: the search only runs for suspicious ones.

**CSV** → `pandas` → drop empty rows and duplicates, normalise column names
(`Oxygen Level` → `oxygen_level`) → `data/processed/<name>.csv`.

**Chunking** is about 500 **words** with an overlap of 50, not tokens. A deliberate simplification
for the MVP: counting tokens exactly would mean dragging in the tokenizer, and at these sizes it
barely affects retrieval quality.

**Repeat runs.** Without `--force`, files whose `source` is already indexed are skipped. With
`--force`, everything is re-indexed. The ready index for the 16 reports is in git
(`data/index/`), so installation does not index anything.

---

## 7. Decision log: what changed and why

In chronological order; every decision was checked by measurement, not picked by default.

### 7.1. Qwen → Ministral 3B
**Why:** a ban on anything affiliated with China.
**What was done:** `LM_STUDIO_MODEL` was switched to Ministral 3B by Mistral AI (France). The code
was not affected: integration goes through an OpenAI-compatible API, and the model changes with one
environment variable.

Later the model went back to Qwen, a local one (§ 7.15), and after the ban "in any form", to
Ministral again.

### 7.2. GGUF → the MLX build of Ministral
**Why:** measurements on this machine (Apple Silicon):

| Build | Warm request |
|---|---|
| `mistralai/ministral-3-3b` (GGUF Q4_K_M) | **~120 s** |
| `mlx-community/ministral-3-3b-instruct-2512` (MLX 4bit) | **3–7 s** |

GGUF hit the 120 s client timeout, and `/query` kept returning 503. The first hypothesis, an
inflated context of 262144 tokens, **was not confirmed**: the MLX build has exactly the same context
and is fast. It is the GGUF runtime itself on this hardware. The GGUF version was later removed
from LM Studio.

### 7.3. all-MiniLM-L6-v2 → paraphrase-multilingual-MiniLM-L12-v2
**Why:** the NASA corpus is in English, and questions are asked in Russian. A monolingual model
matches a Russian query with English text poorly.
**Check:** a Russian question "How does air flow speed affect flame spread?" finds the chunk
"Residence Time Driven Flame Spread… radiative quenching when flow velocity goes below…".
Cross-language search works.
**Cost:** the vector size is the same (384), but the vectors are incompatible with the old ones, so
the index was rebuilt from scratch. A general rule: **changing the embedding model always requires
a full re-index**; you cannot add on top.

### 7.4. numpy → DataFrame in fiery inference
**Why:** the model is trained on a DataFrame with column names, but prediction used a bare
`np.array`: 21 `X does not have valid feature names` warnings per request. It did not affect the
result but would have masked a real schema mismatch.

### 7.5. The model name became a constant
`MODEL_NAME = "fiery"`: renaming the artifacts is a one-line change, not a search through the
repository.

---

### 7.6. The BASS-II dataset was built from a PDF, not downloaded from PSI

The PSI-25 experiment table is served **truncated** by the website: it lacks the "Test observations
and anomalies" column, that is, the target variable. The full version
(`BASS-II Test Matrix by PI Final.xlsx`, 29 KB) is in the Raw Data section, but:

* the whole section weighs **274.6 GB**, of which 99.94 % are 266 archives and 296 videos;
* the PSI interface does not let you go inside the folder, only download it whole;
* the page builds a 274 GB tree in the browser and eats all the memory;
* the direct S3 links the API returns give `NoSuchKey`: checked on a sample of 14 files, 0
  available.

Solution: the same matrix is printed in full in **Appendix A of report `NTRS-20210011385`**
(pp. 111-122, tables A.1-A.6 by PI), already downloaded from NTRS. Of the 129 tests in the PSI table
**126** were found there; only O20-O22 are missing, the February 2016 tests that appeared after the
report.

`scripts/build_bass_dataset.py` joins the two sources and builds the dataset. Downloading 274 GB was
not needed.

---

### 7.8. A lower limit on LLM size instead of universality

Checked by measurement: three identical questions, one prompt, one corpus, only the model differed.

| | gemma-3-1b | Ministral 3B |
|---|---|---|
| a corpus question | degenerated: one reference without an answer, 73 characters | a coherent answer, 567 characters |
| control (football) | a reference to an unrelated document, no refusal | refused correctly |
| trap (Saffire-IV) | **invented a result and a reference to p. 209** | refused correctly |

The trap is a question that is on topic and plausible but absent from the corpus. The 1B model made
up a fact and attached a reference to a document that does not contain it.

**Following the rules is a capability of the model, not a property of the prompt.** The same "answer
only from the context" instruction works on 3B and not on 1B.

There are two different ways to break:

* *a model that is too compressed* fails from inability: it invents a fact with a plausible
  reference. The answer looks grounded, but there is no grounding;
* *a model that is too large* fails from knowledge: it answers correctly from its own knowledge
  without looking at the documents. Worse, because the error is invisible: the answer is right, but
  the value of "grounded in NASA reports" is lost.

Hence the policy: **a lower limit checked by measurement and no upper limit**. The hardware limits
from above, and the risk of knowledge leaking in is handled not by banning size but by a mandatory
trap check (`SMOKE-TEST.md`, check 5) whenever the model changes.

Caveat: one run per model, not a full evaluation. But the difference is qualitative: not "words it
worse" but "invents facts with a fake reference".

### 7.9. Cyrillic does not cross the API boundary

The rule: **human language for people, ASCII for machines.**

What a person reads may be in Russian: the LLM system prompt and the `answer` field of `/query`.

In ASCII: JSON field values (`units`, `dataset.source`) and the `detail` of HTTP errors. Front-end
code parses these and cannot localise them on the back end's behalf.

Two technical reasons besides language: a Cyrillic "с" (U+0441) is indistinguishable from a Latin
"c" when comparing strings, and a superscript `²` breaks when copied into a terminal or CSV. Hence
`mm^2/s`, not `мм²/с`.

The guard is `tests/test_api_ascii.py`: it checks that the whole `/dashboard` JSON and the
`TARGET_UNITS` values stay ASCII. (In November the documentation, logs and command output moved to
English and the code comments were removed; the Russian version lives in the `dev(ru)` branch.)

### 7.10. The answer language is a request field, not an addition to the question

The front end got the right language by appending a request to the question: "Answer in English."
or a long "Answer in Russian... Translate the terms like this: microgravity → невесомость, ...". The
back end did not change, but the question is vectorised for search whole, together with the
addition.

Measured on the front end's eight topics, three chunks per topic:

| | matches with the search by the bare question |
|---|---|
| a short English addition | 19 of 24 |
| a Russian addition with a glossary | **1 of 24** |

With the Russian glossary the search found the same pages for almost any question, pages resembling
the glossary itself, and the model answered from the wrong documents. For example, to a question
about droplet size it talked about PMMA rods in BASS-II.

So the language is now set with the `language` field and goes only into the LLM prompt. At the same
time the glossary got a ban on English words: the model read the "microgravity → невесомость"
format as permission to leave terms in English.

Without the field the behaviour is unchanged; old clients do not break.

#### References in answers

The model copies the chunk header from the context into the answer's references as is. Hence three
fixes:

- The page label is in the answer language: English answers came out with `[..., стр. 97]`
  references; for `en` it is now `p. N`.
- The header holds the report number (`NTRS-20000030678`), not a 60-character file name.
- The `[doc_id, стр. N]` template was removed from the prompt: the model copied it literally, and in
  Russian answers 16 references of 26 came out with the word `doc_id` instead of a number. Now the
  prompt asks to repeat the chunk header. On the same eight topics no literal `doc_id` was left.

References like `[Olson 1988]` stay without a number: the model takes them from the text of the
reports themselves. They are not made up, but they do not lead into the corpus.

### 7.11. A Russian question is searched by its English translation

The corpus is entirely in English, and `paraphrase-multilingual-MiniLM-L12-v2` matches a Russian
question with English text noticeably worse than an English one. For example, the Russian question
about droplet size found none of the pages the English one finds.

The metric: how much of what the Russian question finds matches what the English question on the
same topic finds. The front end's eight topics:

| option | top-3 | top-8 |
|---|---|---|
| the Russian question as is | 8 of 24 | 26 of 64 |
| a manual translation (the metric's ceiling: even an English paraphrase searches differently) | 14 of 24 | 40 of 64 |
| Ministral translation with a JSON schema | **15 of 24** | **43 of 64** |
| `multilingual-e5-small` instead of MiniLM, no translation | 5 of 24 | 11 of 64 |

The translation reaches the ceiling of the manual one; replacing the embedding model with a small
one does not help. Large models (`bge-m3`, 2.2 GB) were not measured: they would require
re-indexing and the whole team downloading the model, and translation is already at the ceiling.

With a plain "translate" request, the 3B model answered the question instead of translating it half
the time, and search used its answer. An answer schema `{"english": ...}` through `response_format`
and feeding the question as `Query: ...` gave 13 translations out of 13 at 2.4 s on average.

If the runtime did not answer or sent something else, search uses the original question. Switched
off with `TRANSLATE_QUERIES=false`.

### 7.12. A Russian answer is an English answer plus a translation

3–4B models reason and write in English noticeably better than in Russian. Two modes and two models
were compared on the front end's eight topics and the Saffire-IV trap (SMOKE-TEST, check 5). The
retrieved chunks are the same in all runs; only generation changes.

| model, mode | references without a report number | English words in the Russian text | time, s |
|---|---|---|---|
| Ministral 3B, in Russian, old prompt | 11 of 27 | 18 | 42.8 |
| Ministral 3B, in Russian, prompt without the reference template | 9 of 18 | 6 | 21.9 |
| **Ministral 3B, in English + translation** | 3 of 14 | **1** | **18.0** |
| Qwen3-VL-4B, in Russian | 1 of 11 | 6 | 44.1 |
| Qwen3-VL-4B, in English + translation | 1 of 13 | 2 | 36.2 |

Translation wins for both models and is even faster than a direct Russian answer: Cyrillic costs the
model more tokens per word. "References without a number" are mostly honest ones like
`[Olson 1988]`, taken from the text of the reports.

Every run passes the trap, but translation broke it at first: the honest refusal "No data provided
about Saffire-IV" was "translated" by the model into a list of five made-up items built from the
glossary. As with translating the question, an answer schema in JSON and feeding the text as
`Text: ...` helped.

**Ministral fills in, Qwen does not.** On the "pressure" and "helium" topics these words are absent
from the retrieved chunks altogether (see § 11, item 12). Qwen honestly says in both cases that the
context does not have it. Ministral substituted microgravity for reduced pressure, and for helium in
the old mode added "in general, helium may slow combustion": from general knowledge, not from the
context. The price of Qwen is about twice the answer time. The model is chosen in `.env`
(`LM_STUDIO_MODEL`).

Gemma 4 E2B could not be tested: on the 8 GB machine LM Studio does not load it (an AutoFit error
when choosing the context length).

The limit of small models in Russian text itself remains: "buoyancy-driven flows" came out as
nonsense in Russian. So buoyancy = плавучесть was added to the translation glossary.

Switched off with `ANSWER_RU_VIA_ENGLISH=false`.

#### A repeat measurement after hybrid search (§ 7.13)

Hybrid search started finding helium and pressure, and the model comparison had to be repeated:
Ministral filled in exactly where search found nothing. The modes are as in the product: an English
answer directly, a Russian one through translation.

| | Ministral 3B | Qwen3-VL-4B |
|---|---|---|
| English answer, mean time | 30.1 s | 25.1 s |
| Russian answer, mean time | 46.9 s | 34.4 s |
| mean English answer length | 398 chars | 788 chars |
| references without a report number (ru / en) | 1 / 2 | 0 / 0 |
| Saffire-IV trap | honest refusal | honest refusal |
| helium | from the methanol droplet report, with references | the same, without references |

Qwen is not slower any more: with a long context Ministral spends more time processing the prompt.
But Qwen had a defect specific to Russian mode: in the translation of the pressure answer it
inserted Chinese characters and English words. This reproduces at `temperature=0` and is not cured
by a request in the translation prompt. Ministral has its own defect: in one answer it attached a
made-up DOI to the [Olson 1988] reference.

Conclusion: Ministral 3B stays the default. Qwen3-VL-4B is a reasonable replacement for English
mode, but its Russian translation must be checked by eye.

A search of open sources (October 2026) gave no Russian-language measurements for 4B models. For an
8 GB machine the most common advice is Qwen3.5-4B and Qwen3-4B-Instruct-2507 (a text model without
the visual part of the VL version) and Gemma 3 4B. To try a replacement, start with them and this
same measurement: eight topics, the trap, Chinese characters in Russian text.

#### A third measurement: all models at context 8192

The two previous Ministral measurements ran at context 262 144, which LM Studio sets when loading on
demand; on 8 GB that means swapping (§ 11, item 1). Here each model was loaded alone, with context
8192. The same hybrid search.

| | Ministral 3B | Qwen3-4B-Instruct-2507 |
|---|---|---|
| English answer, mean time | **21.7 s** | 31.6 s |
| Russian answer, mean time | **37.8 s** | 50.5 s |
| mean Russian answer length | 444 chars | 689 chars |
| references without a report number (en / ru) | 10 of 22 / 2 of 14 | **0 of 13 / 0 of 17** |
| Chinese characters in Russian text | none | none |
| Saffire-IV trap | refusal, but in Russian to an English question | refusal, in the question language |

- Context 8192 sped Ministral up by about a quarter: 30.1 → 21.7 s in English, 46.9 → 37.8 s in
  Russian.
- Ministral's "references without a number" are mostly section titles instead of a report number:
  `[BASS-II Summary Report (p. 9)]`, `[Burning Rates]`.
- In Russian text Ministral leaves "buoyancy" untranslated; Qwen3-4B translates it wrongly
  although the glossary has the right term.
- Qwen3-4B-Instruct-2507, the text version, does not repeat the Qwen3-VL-4B defect: not a single
  Chinese character.

Conclusion: **Qwen3-4B-Instruct-2507 is more accurate** (references, language, completeness) but
**a third slower**. With a streamed answer (§ 7.14) the extra 10–13 seconds are less noticeable. It
became the default (§ 7.15).

Did not start in LM Studio on 8 GB: Gemma 4 E2B and Ternary-Bonsai-2-9B, both with an AutoFit error
when choosing the context. Bonsai is also not an ordinary MLX model (type
`prism_hadamard_qwen35`): it needs its own Python loader and cannot be plugged in through LM Studio.

#### The translation glossary: errors from real answers

Eight topics and the trap in Russian on Qwen3-4B, context 8192. The buoyancy error from the third
measurement did not repeat, neither in this run nor on six separate phrases with buoyancy: it
apparently depends on the text. No Chinese characters, Latin letters only in names (PMMA, BASS,
Halon), the trap is an honest refusal.

The counters do not see it, but reading the answers revealed gross errors in terms:

| in English | the Russian translation meant | glossary entry |
|---|---|---|
| helium-diluted | "disinfected with helium" | diluted |
| dilution | "dosage" | dilution |
| 380 torr | "380 cake" | torr |
| extinguishers | "detectors" | extinguisher |
| fires | "lights" | fires, with a ban on "lights" |
| buoyant convection | a literal "buoyancy convection" | natural convection |

A check on six phrases with these terms: 0 errors. The Saffire-IV refusal survived the glossary
additions; remember that the glossary broke it once already (above). Without the explicit "never
lights" ban, a plain `fire = пожар` was not enough for the model.

What remains: to the droplet size question the model honestly answers that there is no data,
although the reports cover the topic; in one phrase the reference label became "с. 10" instead of
"p. 10"; answers sometimes use a less precise Russian word for "extinction". Russian text should be
read by eye: the glossary fixes what was found, not the whole translation of a small model.

### 7.13. Hybrid search: vectors + keywords

MiniLM vector search missed chunks with a specific term. The corpus has 25 chunks about helium and
11 about reduced pressure, yet for questions on these the top 3 found none of them, in both
languages. The model then either honestly said "the context does not have it" or filled in
(§ 7.12).

BM25, classic keyword search, catches the term itself but gets confused on common words: for "why
does droplet size **matter**" it found the AMS-02 particle detector (dark matter). So it is not a
replacement but a fusion: 20 candidates from each method, then reciprocal rank fusion, where a chunk
gets the sum of `weight / (60 + rank)` over both lists. What both found rises to the top.

The metric: how many of the top 3 contain the key words of the question's topic. It is crude, so
the chunks about helium, pressure and the droplet were read by eye. 16 questions: the front end's
eight topics in two languages (Russian through translation, § 7.11); 16 new ones: questions not
used when choosing the weight: PMMA, blowoff, soot, SoFIE, cool flames, thin and thick fuel, CO₂,
MSG.

| search | 16 front-end questions | 16 new |
|---|---|---|
| MiniLM vectors (before) | 30 of 48 | 26 of 48 |
| BM25 only | 43 of 48 | 37 of 48 |
| hybrid, keyword weight 1.0 | 39 of 48 | 38 of 48 |
| **hybrid, keyword weight 1.5** | **46 of 48** | **41 of 48** |
| hybrid, keyword weight 2.0 | 46 of 48 | 41 of 48 |

Weight 1.5 was chosen on the front-end questions and held on the new ones. With weight 3.0 and weak
smoothing the AMS-02 noise crept into the top 3 again.

The cost: 3 ms per search (8 → 11 ms) and 72 ms to build the index at start. No new model and no
re-index: the keyword index is built from the same chunks and rebuilt if the number of chunks
changed after ingest.

Switched off with `HYBRID_SEARCH=false`; the weight is `KEYWORD_WEIGHT`.

### 7.14. Streamed answer `/query/stream`

The model answers for 10–60 seconds, and the screen is empty almost all that time. The model itself
cannot be made faster (§ 11, item 1), but the text can be shown as it is generated:
`POST /query/stream` returns NDJSON: the sources right after search, then pieces of text, and the
whole answer at the end. The event format is in `API.md`.

NDJSON, not SSE: the browser's `EventSource` only does GET, and the request is a POST with a body.
It has to be read through `fetch` anyway, and line-by-line JSON is simpler there.

A Russian answer is harder: it is written in English and translated (§ 7.12), and the translation
uses the JSON schema `{"russian": "..."}`. So the English draft is not shown (event `stage:
answering`), and the translation is pulled out of the JSON as it arrives (`JsonStringStream`),
without waiting for the closing quote. If the translation gave not a single word, the stream
honestly starts over with a direct Russian answer; if it broke off midway, what arrived is shown.

A runtime error mid-answer arrives as an `error` event: status 200 has already been sent by then.

Measured live, Ministral 3B: the sources arrive after 0.2 s (a Russian question after 7 s, after the
translation), the first word of an English answer after 5–28 s: fast if LM Studio reuses the cached
start of the prompt, slow on a new question. Russian text starts after the English draft and the
translation, about 50 s in, and the whole answer takes about 70 s. Streaming does not speed up the
model, but it removes half a minute of empty screen: you can see that search is done and at which
stage the model is.

### 7.15. Ministral 3B → Qwen3-4B-Instruct-2507

**Cancelled 2026-11-01:** the rules were rewritten and ban Chinese AI in any form, local models
included. The model is Ministral 3B again (§ 7.18). Below is the record of the earlier decision.

**Why:** the third measurement (§ 7.12). At the same context of 8192, Qwen3-4B gives references
with a report number in every answer (Ministral had 10 of 22 without a number in English), always
answers in the question language (Ministral answered the English trap in Russian) and writes more
fully. The price is about 10 s per answer: 31.6 versus 21.7 s in English, 50.5 versus 37.8 s in
Russian.

**How this fit with § 7.1.** The ban in the rules was on services affiliated with China. Here the
model is downloaded once and runs locally in LM Studio, not a single request leaves the machine,
nobody is paid for an API; the weights are licensed Apache 2.0. Decided after checking the rules on
2026-10-31.

Not to be confused with Qwen3-VL-4B: its Russian translation had Chinese characters (§ 7.12). The
text-only Qwen3-4B-Instruct-2507 had none in any answer.

Load with context 8192: `lms load qwen3-4b-instruct-2507 --context-length 8192` (§ 11, item 1).
Ministral stays as the fallback: `LM_STUDIO_MODEL` in `.env`.

### 7.16. The daemon and the `sfss` command

After the call with the organisers, the substance of the program is a service that runs in the
background and that others connect to. Hence `app/cli.py`: `sfss start`, `stop`, `status`, `logs`,
`predict`, `ask`, `help`.

The CLI computes nothing itself and goes to the daemon over the same API as a third-party program.
Hence the instant response: models and the index are not loaded into the command's process.

Three decisions that would otherwise have to be reopened:

- **`sfss predict` fills in nitrogen to one.** The daemon would put in the air value of 0.79, and at
  30 % oxygen it would calculate a 109 % mixture. `/predict` itself does not check this yet.
- **`sfss stop` checks that the pid is our uvicorn.** After a reboot the number from
  `data/run/sfss.json` could belong to someone else's process.
- **`--with-llm` loads the model with `lms load --context-length 8192`.** Otherwise LM Studio brings
  it up on the first question with context 262 144 (§ 11, item 1). `/health` now reports
  `model_loaded` and `model_context_length`: `lm_studio: true` does not mean the model is in memory.

At first this was checked only on macOS: `is_ours` called `ps`. Windows support came with the
installer (§ 7.24).

### 7.17. External API: `/v1`, import, access

The question "where do I enter data and where is the import?" was fair: `/predict` calculated one
point, and `/ingest` only rescanned `data/raw`. The guide for connecting is `INTEGRATION.md`.

**`/v1` next to the old paths.** The Playground and the fixtures live on unversioned paths, and
there is no reason to redo them: they are hidden from the schema but work and are guarded the same
way.

**`/predict/batch` calls the model once for the whole batch.** A forest on one row costs
milliseconds, and 10 000 rows would take minutes. Measured live: 10 000 CSV rows in 0.13 s. A bad
row gets `error`; the others are calculated.

**`warnings`, not a refusal.** Outside the training range, or when the gases do not add up to one,
the number is still calculated: the Playground and old clients rely on it, and an engineer often
needs to look at exactly the edge. The ranges come from `data/processed/flex.csv`; without the file
there are no range warnings.

**The API does not fill in nitrogen, although it could.** `{"oxygen_level": 0.30}` still means a
109 % mixture, now with a warning. Changing the meaning of a request was not part of this work;
`sfss predict` fills in nitrogen itself. The sample has a `pressure_mmhg` minimum of 0.00, so the
pressure warning barely limits it from below.

**PDF upload answers only when the document is already searchable.** A file that failed to index
and a scan without text are removed: otherwise it would sit in the folder while search could not
see it. The API cannot replace a document: 409, and that is deliberately simple. Neither `doc_id`
nor the page number goes into a path: `doc_id` is compared with names from the folder.

**Access.** From this machine without a key, from other addresses with `SFSS_API_KEY`. Without a key
the daemon does not start on an external address.

**Why CORS is no longer wide open.** A harmless `*` while the API only read and calculated. With file
upload, any page open in the browser could write into the corpus: the request comes from 127.0.0.1,
multipart needs no preflight, and CORS does not stop it. So a foreign `Origin` is checked in
`require_api_key` as well. A gap remains: `Origin: null` is allowed for the Playground opened as an
HTML file, and a sandboxed iframe on someone else's site has the same `null`.

Access from another address was checked only by tests, not live: opening the port to the local
network just for a check was not worth it.

### 7.18. Chinese models are banned: Ministral 3B again

**Why:** on 2026-11-01 the organisers rewrote the rules: Chinese AI is banned in any form. The
argument from § 7.15 that a local model is not a service no longer works. Everything Qwen made was
replaced: the default model and the Playground's eight recorded answers in two languages. There are
no other Chinese models in the project: Ministral 3B is by Mistral AI (France), MiniLM by
sentence-transformers. BGE embeddings are only mentioned as an untested option.

Going back exposed what § 7.15 held against Ministral: English answers had `[п. 9]` and
`[Нет данных]`, and references like `[3.1]` cannot be opened. The cause turned out to be our prompt,
not only the model:

- for an English answer the whole prompt is now English (`llm_system_prompt_en`);
- the end of the prompt lists the headers of the found chunks: the only allowed references.

A Russian answer goes through an English draft and gains from this the same way. Eight topics and
the Saffire-IV trap, Ministral 3B, context 8192:

| | old prompt | new prompt |
|---|---|---|
| references without a report number, en | 8 of 21 | **0 of 24** |
| references without a report number, ru | 3 of 23 | **0 of 22** |
| English answer with Russian inserts | 2 of 9 | **0 of 9** |
| mean English answer length | 429 chars | 605 chars |
| mean time, en / ru | 18.7 / 28.0 s | 31.7 / 51.3 s |

The new prompt's time is overstated: during this run the system was swapping 3 GB, and the safety
question took 112 and 160 s. When recording the ready answers on eight topics it came to 24.1 s in
English and 36.1 s in Russian on average, from 11 to 92 s. The prompt's cost was not measured
separately. On those eight topics there were again 0 references without a number out of 38.

The translation asks not to add notes of its own: one answer ended with the model musing that the
references did not match. buoyant forces was added to the glossary.

**What remains.** Ministral still makes mistakes with terms in Russian, one droplet answer came out
with no reference at all, and a refusal on the trap sometimes carries an extra reference or note.
There are no made-up Saffire-IV results in any run. So the pitch keeps saying: check the answer
against the reference.

---

### 7.19. The service manages the model

Roman opened Anti-Fire with the model unloaded: the program only suggested a command, and Bionic
(the LM Studio app on this machine) has no load button. Worse, the first question brought the model
up through LM Studio itself with context 262 144, and on 8 GB that means swapping (§ 11, item 1).

- **`needs_load` is checked before translating the question.** The translation is the first call to
  the model, so later would be too late. It works for every client: Anti-Fire, the Playground,
  `sfss ask`, third-party software. The stream reports `stage: loading`.
- **`POST /v1/llm/load`** loads in advance: the button in Anti-Fire, `sfss load`, the `load` command
  in the app terminal, `sfss start --with-llm`. One piece of code does the loading. The reverse:
  `POST /v1/llm/unload`, `sfss unload`.
- **A subprocess with fixed arguments.** The model name comes from the settings; nothing from the
  request goes into the command. Access is the same as for the rest of the API (§ 7.17).
- **A per-process lock.** A second model will not fit next to the first, so parallel requests wait
  for the first one. Meanwhile `/health` reports `model_loading`.
- **Broken formulas do not reach the model.** In the reports, font symbols are lost in extraction:
  in NTRS-20130014061 on p. 7 a formula became `a = ( Wavof K 8Wf f g o ) 1 xo;∞`, and in place of ρ
  there is an invisible `\x1a`, where the model drew `∧` or `⊞`. A request in the prompt did not
  help. Now `strip_formulas` cuts this out of the context; the index and the shown excerpts keep the
  original text. The rule touched 52 chunks of 1131.

Measured on 9 answers, 5 about density and 4 about the diameter ratio formula:

| | Answers with a formula | With a made-up symbol |
|---|---|---|
| before | 2 of 9 | 3 of 9 |
| a request in the prompt | 1 of 9 | 4 of 9 |
| cutting formulas | 1 of 9, the definition `Wav = average`, not a formula | 4 of 9 |
| cutting formulas and symbols | 0 of 9 | 0 of 9 |

The sample is small and the rule is heuristic: it may miss a rare formula. The page reference stays
the way to check the answer.

### 7.20. Anti-Fire starts and stops SFSS

Roman stopped the daemon through Activity Monitor. A stopped service cannot answer a request, so
starting cannot go through the API: the `sfss_start` and `sfss_stop` commands live in the Tauri
window (`apps/anti-fire/src-tauri/src/main.rs`) and simply call `sfss`.

- **There is no stop endpoint in the API.** Process control is available only to the app window:
  the service cannot be stopped by a network request, and no key is needed for it.
- **The address is not passed, only the port from the connection address.** A service on another
  machine is not controlled by the buttons. The command is looked for in `~/.local/bin`, Homebrew,
  `%LOCALAPPDATA%\sfss\bin` and `PATH`: an app started from Finder has its own short `PATH`.
- **Stopping unloads the model first.** Without the service the model cannot be unloaded from the
  app, and it holds memory. `sfss stop` in a terminal does not touch the model.
- **The daemon survives closing the app.** Stopping is always explicit.
- **A service not started by `sfss` is not stopped:** `sfss stop` knows only its own pid. The app
  writes this in its terminal.
- **`sfss` output goes to the app terminal line by line, as the command runs.** At first the window
  waited for the exit, and "Warming up..." appeared when the warm-up was already over. Now each line
  goes to the page as an `sfss-output` event; for that the window needs the `core:event:default`
  permission (`capabilities/default.json`). Python writes stdout into a pipe in blocks, so the
  command runs with `PYTHONUNBUFFERED=1`.

### 7.21. Runtime and model are set separately; Ollama is supported

The LM Studio address and the model name lived only in `.env` and changed with a restart. Now there
are `GET` and `PATCH /v1/llm/config`, and on top of them `sfss config`, the "AI settings" window in
Anti-Fire and the Playground, and `config` in the Anti-Fire terminal.

- **Settings live in `data/llm.json`, not in `.env`.** `.env` holds the defaults, and the service
  never writes into it. `sfss config reset` simply deletes the file. While the daemon is off, the
  command edits the file itself: the port can be set even before the first `sfss start`.
- **Applied on the fly.** The service swaps the OpenAI client and unloads the previous model: two
  will not fit side by side on 8 GB. While a model is loading, a setting is rejected with 409.
- **Both runtimes answer through `/v1`; the differences live in `llm_runtime.py`:** state, list,
  loading, starting the server. There is no universal "any OpenAI server": without state and loading
  it would give half the features, and the request was for LM Studio and Ollama.
- **Ollama's context is not set from here.** Ollama's documentation says plainly that the context
  cannot be passed through the OpenAI API. So the context field is hidden for Ollama, and the
  service does not reload a model with a large context.
- **Ollama may unload the model 5 minutes after an answer.** That is the documented default
  `keep_alive`, and requests through `/v1` do not pass it. How it combines with `keep_alive: -1` at
  loading needs a look on a real Ollama. A question after idling loads the model itself.
- **`lms server start --port` moves a running server to a new port,** checked live. Changing the
  port in the settings moves the server on the next load, not only the client address. If the server
  still does not answer after starting (the port is taken by another program), loading fails with
  the reason instead of loading the model where nobody will ask.
- **The `/health` check has a 1-second connection timeout.** It used to go through the OpenAI client
  with a 120 s timeout. While the address was only in `.env` that did not matter, but now a typo in
  the address would hold `/health` and the app would consider the whole service dead.
- **Banned models are hidden and not accepted** (§ 7.18): a runtime shows everything on disk. The
  name list is necessarily incomplete; it protects against an accidental choice, not against
  getting around it. `.env` and the settings file itself are not checked against it.
- **The address and port are accepted only from those who have API access** (`security.py`). The
  address is checked against a pattern, and the model name cannot start with a hyphen: it goes as
  an argument to `lms`.

Not checked against a real Ollama at the time: there was none on the machine. Checked with tests and
a live run of `sfss` and the windows against an imitation of its API built from the documentation.
LM Studio on another port was checked live, with a real answer. In November the installer found a
real Ollama on Fedora (§ 7.24), but answers through it were not checked.

### 7.22. One repository: SFSS-Dev

By the rules the project is submitted as one repository, and it lived in two: the back end
`PlazmaRoma/Anti-Fire_backend_MVP` and the front end `heyyAzamat/space-fire-security-software`,
cloned inside the back end. On 2026-11-14 both were brought into `PlazmaRoma/SFSS-Dev` with a clean
history: the back end from `main` 90a3334, the front end from `roman(main)` 1a04077. The old
repositories were not changed.

- **`sfss/` is the service, with the Playground inside it, in `sfss/playground/`.** The Playground
  is not a separate app: `sfss playground` opens it, and the built file is in
  `app/static/playground`. So the Tauri wrapper for the Playground was not carried over.
- **`apps/anti-fire/` is the app, a client of the service.** Its own page, its own Tauri window,
  built by `build.sh`. The code shared with the Playground (the API client, types, the "AI
  settings" window, report names) lives once, in `sfss/playground/src/shared`, and is imported as
  `@sfss`. No copies, so the code cannot drift apart.
- **One `node_modules` at the root, npm workspaces.** Otherwise the shared code would take React
  from one folder and Anti-Fire from another, and hooks would break on two copies of React.
- **The data is in git** (CODEMAP, the `data/` section). The NASA reports are open, and without them
  a clone answers nothing.
- **The Playground's recorded answers live in one place,** `playground/src/shared/fixtures`. They
  used to be kept in two folders and copied between them.

### 7.23. Light installation: search on ONNX, an own index, uv

The first installer (§ 7.22, PR #2) installed 115 packages, 1.7 GB on disk, and downloaded a 470 MB
search model. On GitHub's servers that took 2–4 minutes, at home over Wi-Fi tens of minutes, and pip
said nothing, so the installation looked hung. On Windows, Defender also scanned each of tens of
thousands of files. About a gigabyte of it was needed only to turn text into vectors.

- **The search model in ONNX instead of PyTorch.** The same `paraphrase-multilingual-MiniLM-L12-v2`,
  the Xenova int8 build, 113 MB instead of 470. It runs through onnxruntime and tokenizers, without
  torch, transformers and the scipy dependencies of sentence-transformers. The vectors match the
  previous ones to 99.65–99.9 % by cosine (26 questions, 200 chunks). The Hugging Face revision is
  pinned and the files are checked by sha256: the index was computed by exactly this model.
- **An own index instead of ChromaDB.** 1131 chunks of 384 numbers is 1.7 MB; an exact numpy scan is
  faster than the way to HNSW. ChromaDB pulled in kubernetes, grpc and opentelemetry. The index is
  two files in `data/index`, 3.5 MB, in git: installation no longer builds it. The store's API
  repeats the needed part of a Chroma collection, so the rest of the code did not change.
- **CSV instead of parquet.** pyarrow weighed 130 MB for four tables of hundreds of rows. Values and
  types were compared after the switch and matched.
- **uv instead of pip.** One file of about 20 MB: it installs Python 3.12 itself if needed, without
  admin rights, downloads packages in parallel and shows the progress. It goes into `.tools` inside
  the clone and does not touch shell startup files.
- **Anti-Fire as a ready build.** Building from source needs Rust, hundreds of Rust libraries, Node,
  and on Windows also Visual Studio Build Tools of several gigabytes and 10–20 minutes of
  compiling. GitHub Actions builds the ready files for three systems; they are in
  `apps/anti-fire/release`, and the installer installs them itself.

Result: 56 packages instead of 115, 330 MB on disk instead of 1.7 GB, about 400 MB of downloads
without a language model instead of 1.5 GB. The service warm-up is 2.8 s instead of 12.

**Search quality was compared on 25 questions** (the Playground topics in two languages, the
SMOKE-TEST questions): in 21 the final three chunks are the same, in four the third one changed. The
new third chunks are as borderline as the old ones: sometimes closer to the topic, sometimes just as
far. Of the 20 nearest by vectors, 94 % match on average. Part of the difference comes from an exact
scan instead of an approximate HNSW, part from int8.

### 7.24. Checked on three systems; English main

The installer was run live on all three systems, and each found something CI did not.

- **Windows 10.** Windows PowerShell 5 under `ErrorActionPreference = Stop` turns any stderr line of
  a native command into an error once stderr is redirected: LM Studio's `lms ls` prints "Waking up
  LM Studio service..." to stderr, and the installation broke off. Commands whose output is read
  now run without that rule. A parameter named `$exe` in the helper function caught the `-e` from
  `uv pip install -e`. A daemon started from an SSH session died with it: Windows OpenSSH kills the
  session's job, so `sfss start` now leaves the job where the job allows it. `install.ps1` must keep
  its BOM, otherwise PowerShell 5 reads it as ANSI and Cyrillic bytes become quotes (a test guards
  this). From scratch: 106 seconds.
- **Fedora 44, GNOME, Wayland, NVIDIA.** Under Wayland the window buttons are drawn by the app
  itself, and with WebKitGTK on NVIDIA they did not respond; the window also stayed white for a long
  time. Anti-Fire now opens through XWayland (`GDK_BACKEND=x11`) and without DMA-BUF rendering,
  unless the user set these variables. Under X11 our own centring computed before the window was
  shown missed: the window has no frame yet. GTK now centres it (`gtk_window_set_position`), the
  way macOS does with `NSWindow center`. In `install.sh`, `command | grep -q` under `pipefail`
  failed exactly when grep found the line and closed the pipe early: a false "WebKitGTK missing"
  and possibly an already downloaded model not being recognised. From scratch: 44 seconds.
- **macOS.** The window was created hidden and shown without focus, so its buttons were grey until
  hovered: it now takes focus when shown.

Installation and removal are documented per system in `docs/install/`.

In November `main` moved to English: documentation, logs, command output and installer messages.
The code comments were removed; the explanations they held are in `CODEMAP.md` and this document.
Russian stays where it is part of the product: the interface translations, the prompts for Russian
answers, the test questions. The Russian version of the repository is kept in the `dev(ru)` branch.

---

## 8. Environment

The checked working configuration:

| | |
|---|---|
| Python | 3.12, installed by uv (the specification allows 3.11+) |
| FastAPI | 0.16x |
| Search | onnxruntime, tokenizers, numpy; `paraphrase-multilingual-MiniLM-L12-v2` in ONNX int8, 384 dimensions |
| scikit-learn | 1.9 |
| pypdf | 7 |
| LLM | Ministral 3B, MLX 4bit on a Mac, GGUF elsewhere, context 8192, in LM Studio on `:1234` or Ollama on `:11434` |
| Front end | TypeScript, React 19, Vite, Tauri 2 |

Systems checked live: macOS on Apple Silicon (8 GB), Windows 10, Fedora 44. GitHub Actions also
checks installation, the service, the tests and removal on clean Ubuntu, macOS and Windows.

**`.claude/settings.json`** has `worktree.bgIsolation: none`: background Claude Code sessions work
right in this folder, not in an isolated worktree.

---

## 9. Data

### What is downloaded

16 PDFs, about 1000 pages, 137 MB in `data/raw/`. All from NTRS: no registration needed, served
over plain HTTP as `https://ntrs.nasa.gov/api/citations/<ID>/downloads/<file>.pdf`.

| Topic | Documents |
|---|---|
| **BASS / solid materials** | BASS-II Summary Report (144 pp.), Combustion of Solids BASS-II (21), Thickness & Preheating (58), PMMA Rods Concurrent Flow (10), PMMA Blowoff Limits (8), Solid Fuel Combustion Partial-g (11) |
| **SoFIE** | Solid Fuel Ignition and Extinction Project on ISS (21) |
| **ACME** | Gaseous Non-Premixed Flame Research for ISS (13) |
| **FLEX / droplets** | Detailed Results 2009–2011 (314), A Decisive Step Forward (44), Methanol Droplet Combustion (11) |
| **Overviews** | Microgravity Combustion Science 1995 (55), Overview of Microgravity Combustion (10), NASA/NEDO Cooperative Projects (210), MSG Overview (28), ISS Annual Highlights (40) |

The two main ACME reports were downloaded but removed: one-page image posters without a text
layer that would have given zero chunks.

### The BASS-II dataset

`data/processed/bass_ii.csv` is built by `scripts/build_bass_dataset.py` from two sources, both on
disk:

| Source | What it gives |
|---|---|
| `data/raw/PSI-25_BASS-II_test_matrix.csv` | numbers: O₂/CO₂/CO, the flow restrictor (129 rows) |
| Appendix A of report `NTRS-20210011385` | the test outcome, flow configuration, metric sizes |

Joined on the **(test number, sample number)** pair. The test number alone is not enough: the id
`O2` is indistinguishable from the oxygen formula in the text.

Result: **129 rows, 116 of them with a labelled outcome**.

| Outcome | Rows |
|---|---|
| extinction | 73 |
| sustained_burn | 21 |
| blowoff | 16 |
| no_ignition | 6 |
| unknown | 13 |

Features are only conditions **before** the experiment: `oxygen_level`, `co2_initial`,
`co_initial`, `flow_restrictor`, flow speeds (below), `thickness_mm`, `diameter_mm`, `width_cm`,
plus one-hot by material, shape and flow configuration. Materials: PMMA 84, SIBAL 24, Nomex 3,
wax 1.

#### Flow speed

The main controlled variable of the experiment. The matrix records it as instrument readings, not
in cm/s, so it is converted with `Fan calibration data.xlsx` (downloaded from PSI-25 Raw Data,
24 KB).

The formula is fixed in the calibration table itself: **U = 1.0066 × (Air Display)**, cm/s. The
coefficient was checked on all 15 control pairs of the sheet, with zero difference. The source is
given there too: the SPICE calibration, 56 mm downstream, 36 mm from the bottom.

The calibration was redone almost every day, so the Fan Display → cm/s curve is matched to the GMT
of the experiment: an own calibration was found for 109 tests of 129; the rest use a curve averaged
over all days for the same number of restrictors.

The `Fan display` and `Air display` columns are filled differently by different PIs: sometimes
potentiometer readings, sometimes Fan Display units, sometimes already cm/s. They are told apart by
a threshold: **the fan does not turn below 38 Fan Display units**, so a value under 38 is
unambiguously a speed in cm/s, and a sequence where all values are ≥ 38 is Fan Display units to be
converted.

Features: `flow_initial_cms`, `flow_final_cms`, `flow_min_cms`, `flow_max_cms`, `flow_decreasing`.
Filled in **123 rows of 129**.

The physics shows in the data: `blowoff` has a maximum speed of 11.3 cm/s versus 7.5 for the rest,
and in these experiments the flow was mostly **raised** (lowered in only 31 % of cases), while for
`extinction` it was lowered (61 %).

A cross-check with an independent source, Table 7.1 of the report, where the speeds are given
directly in cm/s: **23 of 27 matched** on the (GMT, test number) key.

**The `Final O2/CO2/CO` columns are deliberately not features**: they are experiment results, not
conditions. A high final CO₂ means "a lot burned", so the model would predict the outcome from the
outcome itself.

### Where to get data on PSI

**https://psi.nasa.gov/physci/repo/search**, filter Research Area → Combustion Science.
Registration is **not required** (the PSI guide never mentions an account or login), but the
browser goes through a check. The whole Combustion Science section has 26 studies; on topic:
BASS-II (PSI-25), BASS (PSI-26), FLEX (PSI-69), FLEX-2 (PSI-68), SAFFIRE I-III (PSI-98/99/100).
The ACME family and Ground Investigation are off topic.

The file list of a study without downloading:

```bash
curl -s -X POST https://psi.nasa.gov/geode-py/ws/files/v2 \
  -H 'Content-Type: application/json' \
  -d '{"studyId":"PSI-25","folder":"","fileType":"study","version":"3"}'
```

The `key` and `bytes_size` fields give the full tree with sizes. It is the only way to see what is
inside without pulling hundreds of gigabytes.

### The FLEX table

The downloaded FLEX report (`NTRS-20150023456.pdf`) has the full test matrix on **pages 26–34**,
276 rows, parsed with a regular expression:

```
FLEX–140 C14M101 11/4/10 16:52:39 Methanol 533.5 .15 .35 .5 0 3.98 3.95 .2 1.3 Extinction
```

Columns: test id, date, time, fuel, pressure (mmHg), mole fractions O₂/N₂/CO₂/He, initial droplet
diameter, extinction diameter, burning rate, burn time, **outcome**.

Outcomes: Extinction 186, Disruption 62, Completion 28. The O₂ mole fraction is the
`oxygen_level` of the specification. This table is what fiery is trained on (§ 7.7).

---

## 10. Running and checking

```bash
# 1. The service (the installer has already set up the environment and the index)
sfss start --with-llm                          # the daemon and the model with context 8192
sfss status

# 2. For development
.venv/bin/uvicorn app.main:app --reload        # http://localhost:8000/docs

# 3. Checks
curl localhost:8000/health
.venv/bin/python -m pytest -q                  # 242 passed
```

**Re-indexing after adding to the corpus** goes through `--force`: the index is rebuilt from
scratch, so old chunks do not remain under previous doc_ids:

```bash
.venv/bin/python scripts/ingest_documents.py --force
```

16 reports, 1131 chunks, about 40 seconds. Commit the new `data/index/`.

**Training fiery:**

```bash
.venv/bin/python scripts/train_model.py \
    --dataset data/processed/flex.csv \
    --target burn_rate_mm2s --group condition \
    --exclude d_extinction_mm burn_time_s
```

---

### How fiery's quality is measured

A naive "one random split + a metric" scheme lies on this data, so `scripts/train_model.py`
measures differently. The details below are from the first, BASS-II setup; the same machinery is
used for FLEX with `--group condition`.

* **Grouped cross-validation** by `--group`. One sample was burned in several tests (T28a and T28b
  are one piece of fabric); FLEX experiments with one condition code ran back to back in one
  atmosphere. With a random split such rows end up on both sides and the model "guesses" from
  memory. Checked: the overlap of groups between folds is zero.
* **Stratification** for classification: classes are skewed 73 to 6. All four classes are present in
  each of the 5 test folds.
* **A baseline** is printed next to the metric: for classification the most frequent class, which
  gives **62.9 %** on BASS-II; for regression a constant mean. Anything at or below it means "no
  better than a stub".
* **Per-class precision/recall/F1 and a confusion matrix** instead of overall accuracy: catching rare
  outcomes matters.
* **Missing values** are filled with the median inside the pipeline. A film has no diameter, a rod
  has no thickness: that is normal, but KMeans without an imputer fails on such data.
* `class_weight="balanced"` and `min_samples_leaf=2`: against class skew and overfitting with few
  rows per feature.

---

## 11. Known limitations

None of this is broken: these are deliberate MVP simplifications or measured properties to be
aware of.

1. **`/query` takes 25–50 s on an 8 GB Mac.** It was 66–70 s; sped up by lowering `top_k` from 5 to
   3 and capping `llm_max_tokens`. A Russian question costs about two more seconds of translation
   for search (§ 7.11), while the answer itself through translation is faster than a direct Russian
   one (§ 7.12).

   **Context length in LM Studio.** When loading on demand (JIT), LM Studio brought Ministral up with
   a context of 262 144 tokens. On an 8 GB machine that pushed the system into swap: 3.6 GB of 4
   used, and a long Russian answer did not fit into 240 s. After reloading the model with context
   8192 swap fell to 2.3 GB; 8192 is plenty for the `/query` prompt. The service now always loads
   the model with 8192 itself (§ 7.19).

   Measurement showed that **the limit is prompt processing, not generation**: with `max_tokens` 512
   and 256 the time is the same (45.8 and 39.1 s, within the noise), and answers never reach the cap.
   The whole gain came from the two removed context chunks. The cap stays as insurance against a
   growing answer, but it is not the binding limit now.

   Further levers if needed: a smaller `chunk_size` (now about 500 words, about 650 tokens per
   chunk) or a smaller model. Streaming (§ 7.14) is the real answer to the delay for a UI.

2. **For a classifier, `risk_score` is `predict_proba[0][-1]`**, the probability of the last class
   in sklearn's alphabetical order. The current `fiery` is a regression, and its `risk_score` is
   computed differently: the prediction is scaled over `target_range` (§ 5). The classification
   branch stays in `MLService._score()` in case of retraining. For a binary task (0/1) it is
   correct. For FLEX's three classes (Completion/Disruption/Extinction) the last one would be
   `Extinction`, which makes sense, but **this must not be relied on silently**: when training on
   multi-class labels, revisit it explicitly.

3. **Chunking by words, not tokens**: see section 6.

4. **The source reference is the report number**, not a human-readable title: in the answer text
   `[NTRS-20000030678, p. 97]`, in `sources` the full file name. The titles of all 16 reports are in
   the front end (`sfss/playground/src/shared/data/reports.ts`).

5. **`/predict` defaults are standard air, not sample medians.** A per-coordinate median would give
   a gas sum of 0.86, a physically impossible mixture: FLEX deliberately went through unusual
   atmospheres. So the defaults are an explicit `FEATURE_DEFAULTS` constant, and if the model is
   retrained on other features they must be updated by hand: a feature without a default stays
   required.

6. **LM Studio mixes in its own system prompt**: a "Say OK" request takes 537 prompt tokens. If it
   starts conflicting with our "answer only from the context" instruction, remove it in the model
   settings in LM Studio.

7. **PDF text may be unavailable or garbled.**

   *Without a text layer* (a scan) a PDF silently gives 0 chunks. A warning goes to the log, but
   ingest does not fail. There is no OCR.

   *A shifted encoding*: that is how the FLEX report `NTRS-20120015928` was broken. Its fonts are
   Type0/Identity-H without a ToUnicode table, and the embedded TrueType subsets have neither a
   `cmap` nor glyph names. pypdf returns glyph numbers instead of letters: "FLEX" reads as `*0)<`.
   The numbers went in ASCII order, so the shift is the same, −28, on all 38 pages with text and in
   all 11 fonts. The index held 39 unreadable chunks: search in the document did not work, and the
   chunks themselves cluttered the results.

   The fix is a reverse shift with automatic detection (§ 6), without new dependencies. Another
   extractor (pdfminer, PyMuPDF) would not help: there is nothing to restore the mapping from. OCR
   would also give the special characters, but that is Tesseract plus rasterisation for one
   document. Now the document has 52 readable chunks and is first for "FLEX decisive step combustion
   research".

   The price: 11 glyphs outside ASCII (the fi/fl ligatures, typographic quotes and apostrophe, °,
   dashes, footnote marks; about 120 occurrences on 44 pages) are replaced with a space. For
   example, "ﬂame" becomes "ame". They can be guessed from context but not derived, and a table
   tuned to one file would be misleading in shared code. "<" and "&" are lost too: their numbers
   coincide with the space and newline that pypdf inserts itself.

   The other 15 PDFs were checked with the same heuristic page by page. None is shifted. A low share
   of stop words appears only on tables (the FLEX test matrix in `NTRS-20150023456`) and in OCR noise
   of chart captions.

8. **The BASS-II `outcome` target partly reflects the experiment protocol, not the material
   properties.** In BASS-II the standard procedure was to lower the flow until blowoff, so 73 of 116
   records got `extinction`: that is "how the test was ended", not "the material turned out to be a
   fire hazard". The data shows it: the mean O₂ for `no_ignition` is 17.3 % versus 18.9 % for
   `sustained_burn`, a weak separation; oxygen alone is not enough. A physically meaningful target
   would be the limiting flow speed or limiting oxygen at blowoff, but that requires parsing the
   speed sequences inside a record. This is why fiery is trained on FLEX instead (§ 7.7).

9. **`flow_final_cms` is the last setpoint, not the speed at extinction.** The `Air display` column
   holds the discrete values the crew set, while the report gives the measured speed at blowoff.
   Hence differences like "report 2.2, ours 1" in four tests of 27. An exact limiting speed needs
   Table 7.1, but it covers only T'ien's tests.

10. **Values in parentheses were lost when moving the PSI table into CSV.** The original paste had
    pairs like `1.7 (52)`, the same value in different units; when preparing the CSV the parentheses
    were removed so as not to break parsing. In most rows it is a duplicate and nothing is lost, but
    in T21 (`11 max(47)`) the parenthesis held the only number; restored by hand. If differences
    with the report appear, look here first.

11. **The outcome is extracted from free text by keywords** (`scripts/build_bass_dataset.py`,
    `OUTCOME_RULES`). 13 records of 129 stayed `unknown`, and three tests (O20-O22) are missing from
    the report. The rules are ordered: no ignition is checked before blowoff and extinction.

12. **Search still misses rare wordings.** Hybrid search (§ 7.13) covered helium and pressure, but,
    for example, "cold flames" instead of "cool flames" finds nothing: the question translation picks
    a word that is not in the reports. On 16 new questions, 41 of 48 chunks are on topic.

---

### 7.7. BASS-II outcome classification → FLEX burning rate regression

The first setup, predicting the experiment outcome (`extinction` / `blowoff` / `no_ignition` /
`sustained_burn`) on BASS-II, **failed an honest evaluation**:

| | accuracy | baseline | result |
|---|---|---|---|
| 4 classes, as is | 50.0 % | 62.9 % | −12.9 pp |
| extinction+sustained → `burned` | 81.9 % | 81.0 % | +0.9 pp |
| binary blowoff / other | 82.8 % | 86.2 % | −3.4 pp |

None gives a meaningful gain. **34 errors of 58** are `extinction` ↔ `sustained_burn` confusion,
exactly the pair that differs not by material properties but by how the crew ended the experiment.

Switching to regression on the BASS-II data itself did not work either: the only continuous value,
`flow_final_cms`, is quantised by the crew's setpoints: 32 % of the values are exactly 5.0 cm/s,
four values cover 65 % of the sample, and the correlation with oxygen has the **physically wrong
sign** (+0.24 instead of negative). The measured extinction speed could not be pulled from the
observation text: a number before the word about extinction exists in only 20 records of 126, and
half of them are fine potentiometer values that do not map onto the calibration scale.

Solution: take FLEX, where the values are **measured by an instrument**. The burning rate has 60
unique values over 259 rows (the most frequent is 6 %), and its correlation with oxygen is +0.55,
which is physically right.

A check that the model does not reduce to guessing the fuel: the fuel type gives only 3.4 % of the
importance (oxygen 34.9 %), and the model works within each fuel separately: R² 0.53 for heptane
and 0.80 for methanol.

The only real signal found in BASS-II is `blowoff` (recall 75 %, the model catches it by the high
flow speed). The dataset and its builder stay in the repository: useful if measured limits appear.

---

## 12. Dead ends: what was tried and why it did not work

A list so as not to redo what failed. Every item cost time.

| What was tried | How it ended |
|---|---|
| **The GGUF build of Ministral on a Mac** | ~120 s per request on Apple Silicon, hit the client timeout. Moved to MLX: 3-7 s |
| **Downloading PSI-25 Raw Data whole** | 274.6 GB, 99.94 % of it 266 archives and 296 videos. What was needed weighed 150 KB. The browser ate the memory building the tree |
| **Direct S3 links from the PSI API** | `NoSuchKey` on 14 files of 14: the catalogue has the entries, the storage has no objects |
| **BASS-II outcome classification** | Accuracy 50.0 % versus a 62.9 % baseline, worse than a constant. 34 errors of 58 confuse a pair that the protocol distinguishes, not the material |
| **Regression on `flow_final_cms`** | The target is quantised by the crew's setpoints: 32 % of values exactly 5.0 cm/s, correlation with oxygen of the wrong sign |
| **The measured extinction speed from the Appendix A text** | A number before the word about extinction exists in 20 records of 126, half of them fine potentiometer values outside the calibration scale |
| **`max_tokens` as a latency lever** | Not the binding limit: the time is the same at 512 and 256, answers never reach the cap. The limit is prompt processing |
| **gemma-3-1b as the working model** | Breaks the rules: invents facts with fake references (§ 7.8) |
| **PyTorch, ChromaDB and pip in the installer** | 1.7 GB and tens of minutes at home, looked hung on Windows. Replaced with ONNX, an own index and uv (§ 7.23) |
| **Building Anti-Fire from source on the user's machine** | Rust, Node, on Windows Visual Studio Build Tools, 10–20 minutes of compiling. Ready builds instead (§ 7.23) |

The general lesson: **measure first, then build.** Several items on this list were built and thrown
away because checking the goal was postponed.

---

## 13. What next

1. **A model comparison script** for the presentation: latency and the share of answers where the
   cited source really was in the search results.
2. **A second target, `d_extinction_mm`** (198 rows): the droplet diameter at extinction, physically
   a combustion limit.
3. **Carry the approach over to solid materials**: SAFFIRE (PSI-98/99/100) is closer to fire safety
   than droplet combustion.
4. **Answers through a real Ollama**: the installer finds it, but answers through it were not
   checked (§ 7.21).
5. **Signed builds** of Anti-Fire for macOS and Windows, so that Gatekeeper and SmartScreen do not
   warn.

Done since the MVP: streamed answers (§ 7.14), Anti-Fire starting and stopping the service
(§ 7.20), installation with Python and the libraries for three systems (§ 7.23, § 7.24).

Out of scope: fine-tuning the model.
