# Repeat integration run after the offline optimisation

Date: 21 September 2026.

This is a historical record of the ChromaDB and sentence-transformers stack, replaced in November
(ARCHITECTURE § 7.23). The questions were asked in Russian; the answers are quoted in translation.

The state of `main` at commit `503174e` was checked. Requests to Ministral ran strictly one after
another: one client, one request, wait for it to finish completely, then the next. Exactly three
`POST /query` calls in total.

## Summary

| Check | Result | Time |
|---|---:|---:|
| FastAPI warm-up | PASS | 4.8 s |
| Contract tests | PASS | 19 tests in 0.04 s |
| `GET /health` | PASS | 0.417 s |
| `POST /predict` | PASS | 0.288 s |
| Normal corpus question | WARNING | 43.848 s |
| Football trap | PASS | 16.552 s |
| Saffire-IV trap | PASS | 14.976 s |

There were no requests to Hugging Face during the cold start. The
`paraphrase-multilingual-MiniLM-L12-v2` model loaded from the local cache, ChromaDB opened the
existing index of 1118 chunks, and `fiery` warmed up successfully.

## Health

```json
{
  "status": "ok",
  "chroma": true,
  "lm_studio": true,
  "model": "mlx-community/ministral-3-3b-instruct-2512",
  "indexed_documents": 1118
}
```

## Fiery

The control request returned the reference values:

```json
{
  "risk_score": 0.49153910629158143,
  "cluster": 1,
  "predicted_value": 0.5464544973544972,
  "target": "burn_rate_mm2s",
  "defaults_applied": [],
  "is_heuristic": false
}
```

## Normal question

Question:

> How does oxygen concentration affect the burning rate?

The answer:

> The burning rate depends on the regime:
> - **Thermally dense regime**: the rate does not depend on the fuel density [doc_id, p. 91].
> - **Thermally cold transition**: the rate decreases as the fuel density increases [doc_id, p. 91].
>
> In microgravity at **21% O₂**:
> - With CO₂ dilution, stable combustion (no extinction in normal gravity) [doc_id, p. 97].
> - With He dilution, combustion extinction at the same % O₂ [doc_id, p. 97].

Retrieved sources:

1. `NTRS-20000030678-Cooperative-Research-Projects-in-the-Microgra`, page 91
2. `NTRS-20000030678-Cooperative-Research-Projects-in-the-Microgra`, page 97
3. `NTRS-20210011385-Burning-and-Suppression-of-Solids-II-BASS-II-`, page 138

Assessment: **WARNING**. The answer stayed within the retrieved context but is weaker than the
sources themselves. The model missed the direct findings that ignition delay decreases and flame
temperature rises as oxygen concentration grows. The Russian terms for "thermally dense",
"thermally cold" and "extinction" were poor. The `[doc_id]` template was printed instead of the
document id again.

## Off-topic trap

Question:

> Who won the 2022 FIFA World Cup?

The answer:

> The context contains no information about football World Cups or other events on Earth. The data [doc_id] concerns only ISS and microgravity research.

Retrieved sources:

1. `NTRS-20170008723-Annual-Highlights-of-Results-from-the-Interna`, page 2
2. `NTRS-20000030678-Cooperative-Research-Projects-in-the-Microgra`, page 99
3. `NTRS-20120015928-FLEX-A-Decisive-Step-Forward-in-NASA-s-Combus`, page 33

Assessment: **PASS**. Ministral refused and did not name Argentina.

## On-topic Saffire-IV trap

Question:

> What are the results of the Saffire-IV experiment aboard Cygnus?

The answer:

> The context contains no data about **Saffire-IV** or experiments aboard *Cygnus*. For combustion in microgravity I refer to the **cooperative research** on hardware [doc_id: NTRS-20000030678], but specific Saffire-IV results are not given [pp. 205–210]. In addition, figures (Fig. 3, Fig. 7) show **hardware** for modelling combustion in microgravity [pp. 25, 31].

Retrieved sources:

1. `NTRS-20000030678-Cooperative-Research-Projects-in-the-Microgra`, PDF page 209: the Figure 7 caption (printed page 31)
2. `NTRS-20000030678-Cooperative-Research-Projects-in-the-Microgra`, PDF page 61: the Figure 3 caption (printed page 25)
3. `NTRS-20000030678-Cooperative-Research-Projects-in-the-Microgra`, PDF page 205: the Figure 7 caption (printed page 27)

Assessment: **PASS**. The model did not invent Saffire-IV results and said plainly that they are
not in the context. It correctly recognised the chunks as hardware captions. A flaw: the answer
mixes PDF page numbers with the report's printed page numbers.

## Conclusion

The offline optimisation works: a cold start makes no requests to Hugging Face, and the index and
the prediction model are available. Ministral passed both hallucination checks again. The main
remaining defect concerns not trustworthiness but the quality of a normal answer and the way
references are formed.
