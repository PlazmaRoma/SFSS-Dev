# Manual check

Five requests to make sure the system is alive and **the model has not gone off the rails**. Copy
the commands whole. Next to each one is what should come back.

This does not replace or duplicate the automated tests (`pytest`): they exercise the HTTP contract
on stubs, while this checks the live chain with the real model and data.

The answers quoted below were recorded from the running service on 19 September 2026. Those runs
used Russian questions; the quotes are translated.

---

## Preparation

**1. Start LM Studio** (needed only for `/query`): the Developer tab → load
`mlx-community/Ministral-3-3B-Instruct-2512-4bit` with context 8192 → Start Server. Or simply
`sfss load`. Not on a Mac with Apple Silicon: GGUF `Q4_K_M` from
`mistralai/Ministral-3-3B-Instruct-2512-GGUF` or `lmstudio-community`; it passed these checks on
15 November 2026 ([`TEST-RUN-2026-11-15-GGUF.md`](TEST-RUN-2026-11-15-GGUF.md)).

**2. Warm up the model.** LM Studio unloads it on a timeout, and the first request would otherwise
take 12-20 seconds longer:

```bash
curl -s -m 300 localhost:1234/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"ministral-3-3b-instruct-2512","messages":[{"role":"user","content":"ok"}],"max_tokens":3}' \
  -o /dev/null -w "warm-up: %{time_total} s\n"
```

**3. Start the server** in a separate terminal tab:

```bash
cd ~/SFSS-Dev/sfss
.venv/bin/uvicorn app.main:app --port 8000
```

It starts in a few seconds: that is the search model warming up, on purpose. Until the port is
open the service is not ready; once it is open, it is fully ready.

---

## Check 1. The service and its dependencies

```bash
curl -s http://localhost:8000/health
```

**Expected:**

```json
{
  "status": "ok",
  "chroma": true,
  "lm_studio": true,
  "model": "ministral-3-3b-instruct-2512",
  "indexed_documents": 1131
}
```

| What you see | What it means |
|---|---|
| `"status": "ok"` | all is well |
| `"lm_studio": false` | Start Server was not pressed. `/predict` works, `/query` does not |
| `"chroma": false` | the `data/index` folder is gone: `git checkout sfss/data/index` |
| `"indexed_documents": 0` | the index is empty, run `scripts/ingest_documents.py` |
| the answer takes more than a second | LM Studio is most likely off: the client retries the failed connection |

---

## Check 1b. Dashboard data

```bash
curl -s http://localhost:8000/dashboard | head -c 400
```

Three sections should come back. A quick check of the key numbers:

| Field | Expected |
|---|---|
| `model.trained` | `true` |
| `model.metrics.r2` | `0.6524` |
| `dataset.rows` | `273` |
| `corpus.chunks` | `1131` |
| `model.units` | `mm^2/s`, in ASCII |

`trained: false`: the model is not trained. `rows: 0`: the dataset was not built
(`scripts/build_flex_dataset.py`). `chunks: 0`: the index is empty.

---

## Check 2. The fiery model: the numbers must match exactly

```bash
curl -s -X POST http://localhost:8000/predict \
  -H 'Content-Type: application/json' \
  -d '{"parameters": {
        "pressure_mmhg": 760.0, "oxygen_level": 0.21,
        "n2": 0.75, "co2": 0.0, "he": 0.0,
        "d_initial_mm": 3.0,
        "fuel_heptane": 1.0, "fuel_methanol": 0.0
      }}'
```

**Exactly this should come back:**

```
risk_score      = 0.491539
predicted_value = 0.546454
cluster         = 1
target          = burn_rate_mm2s
is_heuristic    = false
```

**This is the most reliable check on the list.** The model is deterministic (`random_state=42`),
so the numbers must match to the sixth decimal on any number of repeats. If they differ, the model
was retrained or the data was replaced, and that needs an explanation, not a shrug.

`is_heuristic: true` means a **stub, not the model**, is answering. Such a result must not be
shown as a prediction.

Look at `predicted_value`: the burning rate in mm²/s. `risk_score` is the same number stretched to
a 0..1 scale.

---

## Check 3. A question to the documents

```bash
curl -s -X POST http://localhost:8000/query \
  -H 'Content-Type: application/json' \
  -d '{"question": "How does oxygen concentration affect the burning rate?", "language": "en"}'
```

It takes **25-50 seconds**. That is normal, not a hang.

**A real answer looked like this** (translated):

> The burning rate depends on the regime:
> - **Thermally thick regime**: the rate does not depend on the fuel surface density [NTRS-20000030678, p. 91].
> - **Thermally thin regime**: the rate is inversely proportional to the fuel density [NTRS-20000030678, p. 91].
>
> Oxygen concentration affects the transitional regime, where a curved flame front increases the
> contact area with oxygen and speeds the process up.
>
> At 21% O₂ in a He-diluted atmosphere the flame goes out [NTRS-20000030678, p. 97].

Sources:

```
NTRS-20000030678-Cooperative-Research-Projects-in-the-Microgra, p. 91
NTRS-20000030678-Cooperative-Research-Projects-in-the-Microgra, p. 97
NTRS-20210011385-Burning-and-Suppression-of-Solids-II-BASS-II-, p. 138
```

Do not expect a word-for-word match: the model words it differently every time. Check the
features, not the text:

**A good answer:**
- is about combustion, oxygen, regimes: on topic for the corpus;
- has references like `[NTRS-20000030678, p. N]` inside the text, with a real report number;
- has plausible page numbers (the reports have 8-314 pages);
- has 3 sources in the `sources` field.

**Cosmetics you can ignore**: the model has only 3 billion parameters, and in Russian answers
there can be odd words, Latin letters inside Russian ones, literal translations of terms, uneven
list formatting.

**Alarming:**
- numbers that are in none of the sources;
- a `doc_id` that is not in `data/raw/`;
- a page number larger than the document;
- an answer not about combustion at all.

---

## Check 4. Control: does the model lie?

The main sanity check. Ask something obviously unrelated:

```bash
curl -s -X POST http://localhost:8000/query \
  -H 'Content-Type: application/json' \
  -d '{"question": "Who won the 2022 FIFA World Cup?", "language": "en"}'
```

**The model must refuse.** A real answer (translated):

> The context contains no information about combustion in microgravity or experiments on the ISS.
> The 2022 World Cup is not mentioned in any of the documents.
>
> [No source for an answer]

**If it names Argentina, the system is broken.** It means the model answers from its own knowledge,
not from the documents, and nothing else it says can be trusted. Fix the system prompt in
`app/config.py` (`llm_system_prompt`) or change the model.

### An important subtlety

`sources` returned **3 sources** here too. That is not an error and not a sign that the answer is
grounded: search always returns the three nearest chunks, even when they are off topic. It is the
model that refuses after reading them.

**Conclusion: non-empty `sources` does not mean the answer is based on anything.** A front end
should show the sources as "what the model looked at", not as "what proves it".

---

## Check 5. The trap: the main test when changing the model

The football question is too easy: it is obviously off topic and easy to refuse. The real check is
a question **on topic, plausible, but absent from the corpus**. We have not downloaded the Saffire
experiment, and the model may have read about it during training:

```bash
curl -s -X POST http://localhost:8000/query \
  -H 'Content-Type: application/json' \
  -d '{"question": "What are the results of the Saffire-IV experiment aboard Cygnus?", "language": "en"}'
```

**Correct behaviour** (Ministral 3B, translated):

> The results of the microgravity combustion experiment aboard *Cygnus* (including Saffire-IV)
> are not in the provided context. Only a description of the hardware is available. Detailed data
> would need more context.

**Failure** (gemma-3-1b, translated):

> The results of the Saffire-IV experiment aboard Cygnus were successful.
> [NTRS-20000030678-Cooperative-Research-Projects-in-the-Microgra, p. 209]

The model made up a result and **attached a reference to a document that does not contain it**. The
answer looks grounded, but there is no grounding. This is the most dangerous kind of failure: you
cannot spot it without knowing the corpus.

### What the model comparison showed

The same three questions, the same prompt and corpus:

| | gemma-3-1b | Ministral 3B |
|---|---|---|
| question from the corpus | **degenerated**: returned one reference without an answer, 73 characters | a coherent answer, 567 characters |
| football | returned a reference to an unrelated document, no refusal | refused correctly |
| **Saffire-IV trap** | **made up a result and a reference** | refused correctly |

**Conclusion: following the rules is a capability of the model, not a property of the prompt.**
The same instruction "answer only from the context" works on 3B and does not on 1B. Find the lower
size limit by measuring, not by eye.

Caveat: one run per model, not a full evaluation. But the difference is qualitative: not "words
it worse" but "makes up facts with a fake reference".

**Whenever you change the model, run this check first.**

---

## The whole run at once

```bash
curl -s http://localhost:8000/health
curl -s -X POST http://localhost:8000/predict -H 'Content-Type: application/json' \
  -d '{"parameters":{"pressure_mmhg":760.0,"oxygen_level":0.21,"n2":0.75,"co2":0.0,"he":0.0,"d_initial_mm":3.0,"fuel_heptane":1.0,"fuel_methanol":0.0}}'
curl -s -X POST http://localhost:8000/query -H 'Content-Type: application/json' \
  -d '{"question":"How does oxygen concentration affect the burning rate?","language":"en"}'
curl -s -X POST http://localhost:8000/query -H 'Content-Type: application/json' \
  -d '{"question":"Who won the 2022 FIFA World Cup?","language":"en"}'
curl -s -X POST http://localhost:8000/query -H 'Content-Type: application/json' \
  -d '{"question":"What are the results of the Saffire-IV experiment aboard Cygnus?","language":"en"}'
```

It takes about a minute and a half: the last requests wait for the model.

All fields and error codes: [`API.md`](API.md).
