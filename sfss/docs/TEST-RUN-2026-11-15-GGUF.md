# GGUF test run, 15 November 2026

The goal: find the GGUF build of Ministral 3 3B Instruct 2512 closest to the MLX build used on a
Mac (`mlx-community/Ministral-3-3B-Instruct-2512-4bit`) and check that SFSS works with it. GGUF is
the build for Windows, Linux and Intel Macs, where MLX does not run.

Result: **`mistralai/Ministral-3-3B-Instruct-2512-GGUF`, file `Q4_K_M`**, with the `BF16` vision
projector. It passes the same smoke test as MLX (`SMOKE-TEST.md`, checks 2-5). The old measurement
of ~120 s per request (ARCHITECTURE § 7.2) does not reproduce on the current LM Studio runtime.

## Environment

- MacBook with Apple A18 Pro, 8 GB of memory
- LM Studio engines: `llama.cpp-mac-arm64-apple-metal-advsimd@2.73.0` (GGUF),
  `mlx-llm-mac-arm64-apple-metal-advsimd@1.13.1` (MLX)
- context 8192 for both builds, loaded with `lms load <id> --context-length 8192`
- SFSS from this repository, a separate instance on port 8765 with `LM_STUDIO_MODEL=<full id>`

## Which GGUF matches the MLX build

The MLX build quantizes the language model, embeddings included, to 4 bits: affine (scale and
offset), groups of 64, bf16 scales, which gives about 4.5 bits per weight. The 0.4B vision encoder
stays in bf16. A bit-for-bit copy in GGUF does not exist: the formats store weights differently.
The closest equivalent:

| | MLX (Mac) | GGUF (everything else) |
|---|---|---|
| Repository | [mlx-community/Ministral-3-3B-Instruct-2512-4bit](https://huggingface.co/mlx-community/Ministral-3-3B-Instruct-2512-4bit) | [mistralai/Ministral-3-3B-Instruct-2512-GGUF](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF), the official one from Mistral |
| Language model | 4 bit, affine, group 64 | `Q4_K_M`: 4 bit with scale and offset, blocks of 32, a few layers in 6 bit |
| Vision encoder | bf16, inside `model.safetensors` | bf16, a separate file `…-BF16-mmproj.gguf` |
| Download | 2.75 GB | 2.15 GB + 0.84 GB |
| Memory once loaded, context 8192 | 2.59 GiB | 2.78 GiB |

Why `Q4_K_M` and not the others:

- `Q4_0` is also 4.5 bits per weight, but has no offset, only a scale; the MLX build is affine.
  `Q4_K_M` is the same "scale plus offset" scheme, which is why it is closer in accuracy.
- `Q4_K_M` is the 4-bit build Mistral itself publishes. `lmstudio-community`, `unsloth` and
  `bartowski` have a `Q4_K_M` of the same size too, but their files are not byte-identical to
  Mistral's: the metadata and, for some, the calibration (imatrix) differ. Only Mistral's file was
  tested here.
- `Q5_K_M`, `Q6_K` and `Q8_0` are more accurate than the MLX build, not equal to it, and take
  more memory: that matters on 8 GB.

Checksums of the downloaded files match the ones on Hugging Face:

```
9ed150d4367e68df0ac8e1540f6ddc65b42d0ee26378329d1ecbca60f93fc5f8  Ministral-3-3B-Instruct-2512-Q4_K_M.gguf
70ca26e41ecea9da997e2887462ad68b848fbf64da011ff4107bbe7353519ee0  Ministral-3-3B-Instruct-2512-BF16-mmproj.gguf
```

## Summary

| Check | GGUF Q4_K_M | MLX 4bit |
|---|---|---|
| Loading in LM Studio | PASS | PASS |
| Generation speed, short prompts | 11-12 tokens/s | 15-20 tokens/s |
| Time to first token, short prompts | 0.34-0.69 s | 0.41-0.70 s |
| Check 2, `/predict` | PASS, 0.546454… exactly | PASS, the same number |
| Check 3, question from the corpus | PASS, 35.6 s | PASS, 35.8 s |
| Check 4, football | PASS, refused, 31.6 s | PASS, refused, 24.4 s |
| Check 5, the Saffire-IV trap | PASS, refused, 32.5 s | PASS, refused, 26.8 s |

GGUF generates about a quarter slower. On `/query` most of the time goes to reading the context of
several thousand tokens, not to writing the answer, so the difference shrinks to 0-7 seconds.

## Answers

Check 3, "How does oxygen concentration affect the burning rate?". Both builds found the same three
chunks (`NTRS-20000030678` p. 90 and 91, `NTRS-20160000593` p. 15) and gave the same three facts
with correct references: flame spread speeds up with more oxygen, the same holds for averaged
microgravity tests, ignition delay gets shorter. GGUF wrote them as a list, MLX as a paragraph.

Check 4, football. GGUF: "No relevant information provided in the context about the 2022 FIFA
World Cup." MLX: "No direct answer in the provided context." Neither named the winner.

Check 5, Saffire-IV. GGUF: "The provided context does not mention the Saffire-IV experiment aboard
Cygnus. (No applicable citation.)" MLX: "No direct mention of the Saffire-IV experiment in Cygnus."
Neither made up a result or a reference.

Short prompts directly to LM Studio, temperature 0: both builds explained correctly why a droplet
burns as a sphere and listed noble gases. Both got 17 × 23 wrong (MLX 401, GGUF 411; the answer is
391): the 3B model counts poorly in any build. In the Russian translation GGUF wrote the non-word
"Флама" instead of "Пламя". These are cosmetics typical of 3B (SMOKE-TEST, check 3).

## What came up along the way

**1. The old 120 s does not reproduce.** In September GGUF Q4_K_M answered in ~120 s on a Mac and
hit the timeout (ARCHITECTURE § 7.2). On the llama.cpp 2.73.0 runtime `/query` takes 32-36 s with
it, 0-7 s more than with MLX. MLX is still the better choice on a Mac: it is faster at generation and takes less
memory.

**2. LM Studio does not see the vision projector from the official repository.** Mistral names it
`Ministral-3-3B-Instruct-2512-BF16-mmproj.gguf`, while LM Studio recognises only files starting
with `mmproj-`. With the original name LM Studio showed two separate "models", `@q4_k_m` and
`@bf16`, and `lms load mistralai/ministral-3-3b-instruct-2512` answered "Model not found". After
renaming to `mmproj-Ministral-3-3B-Instruct-2512-BF16.gguf` it became one model with vision. SFSS
only needs text, so the projector can be skipped altogether. In `lmstudio-community` the file is
already named correctly.

**3. Two builds side by side break the short model name.** While only one build is downloaded,
LM Studio calls it `ministral-3-3b-instruct-2512`, which is the default in `.env`. When both are
downloaded, the names get a publisher prefix: `mlx-community/ministral-3-3b-instruct-2512` and
`mistralai/ministral-3-3b-instruct-2512`. Then `sfss load` with the short name loaded the GGUF,
not MLX, and SFSS kept reporting "not loaded"; `/query` answered "Not enough memory for the model"
because it tried to load the model a second time. The workaround was the full name,
`sfss config model mlx-community/ministral-3-3b-instruct-2512`: after that `sfss ask` answered in
32 s with references.

**Fixed the same day** in `app/services/llm_runtime.py`: a short name finds a build with any
publisher. If there are several, the loaded one wins, then the native format (MLX on Apple
Silicon, GGUF elsewhere). Loading, unloading and requests go to exactly that build. Checked live
with both builds downloaded and the default short name: `POST /v1/llm/load` loaded MLX, `/health`
reported it loaded, checks 2-5 passed (26.8, 21.6 and 25.7 s). With the GGUF loaded by hand, SFSS
used it and did not load a second copy. `GET /v1/llm/models` marks the chosen build with
`"selected": true`.

## How to repeat

```bash
D=~/.lmstudio/models/mistralai/Ministral-3-3B-Instruct-2512-GGUF
B=https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF/resolve/main
mkdir -p "$D"
curl -L -o "$D/Ministral-3-3B-Instruct-2512-Q4_K_M.gguf" "$B/Ministral-3-3B-Instruct-2512-Q4_K_M.gguf"
curl -L -o "$D/mmproj-Ministral-3-3B-Instruct-2512-BF16.gguf" "$B/Ministral-3-3B-Instruct-2512-BF16-mmproj.gguf"
lms load mistralai/ministral-3-3b-instruct-2512 --context-length 8192 --yes
sfss config model mistralai/ministral-3-3b-instruct-2512
```

Then go through `SMOKE-TEST.md`. To go back to MLX: `sfss config reset`. The short name from
`.env` then takes MLX on Apple Silicon.

Caveat: one run per build, not a full evaluation, the same as in SMOKE-TEST. The GGUF timings are
measured on a Mac; on Windows and Linux they depend on the video card.
