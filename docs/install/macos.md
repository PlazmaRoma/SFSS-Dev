# Installing on macOS

Two things get installed: **SFSS**, the service that calculates and answers, and **Anti-Fire**,
the app with a window. One script installs both, without admin rights.

Tested on a MacBook with Apple Silicon: about 5 minutes from scratch over Wi-Fi.

## Prerequisites

Only **git**. If it is missing, macOS offers to install the developer tools the first time you
run `git`, or run `xcode-select --install`.

You do not need to install Python: the installer downloads Python 3.12 if it is missing. The
system Python 3.9 is neither used nor touched.

## What gets downloaded

| What | Size |
|---|---|
| The repository: code, 16 NASA reports, ready index, prediction model, Anti-Fire | about 150 MB |
| uv, the package installer, if not present yet | about 20 MB |
| Python 3.12, if not present | about 20 MB |
| SFSS libraries, 56 packages | about 100 MB, 330 MB on disk |
| Search model for the reports | 130 MB |
| Ministral 3B language model, optional | about 3 GB |

No network is needed after installation.

## Installation

```bash
git clone --depth 1 https://github.com/PlazmaRoma/SFSS-Dev.git ~/SFSS-Dev
```

```bash
cd ~/SFSS-Dev && ./install.sh
```

Steps are numbered, and every download shows its progress. The installer asks two questions;
pressing Enter answers yes to both:

1. **Install Anti-Fire into Applications?** If Anti-Fire is already there, the previous version
   goes to the Trash; the new one is never copied over it.
2. **Download Ministral 3B?** Asked only when LM Studio or Ollama is installed.

At the end the installer starts the service and runs one calculation. If the connection drops,
run `./install.sh` again: downloads are kept and finished steps are skipped.

If the installer says `~/.local/bin` is not in `PATH`, add the line it prints to `~/.zshrc` and
open a new terminal window.

| Option | What it does |
|---|---|
| `--yes` | answers yes to every question |
| `--no-llm` | leaves the language model alone |
| `--no-app` | skips Anti-Fire |
| `--uninstall` | removes everything it installed |

## Checking

```bash
sfss status
sfss predict --o2 0.30 --psi 8.2
sfss playground
```

Expected: 1131 chunks in the index, a burning rate of 0.676 mm²/s, 1.33 times faster than
normal air; the Playground opens in a browser.

**Anti-Fire** is in Applications or Spotlight. It finds the `sfss` command by itself, so the
"Start SFSS" and "Stop SFSS" buttons work right away. The window opens centred on the screen,
taking the Dock into account.

## Language model

Answers are written by a language model on the same Mac, in LM Studio or Ollama. Everything
else works without it: calculations, CSV, the Playground.

**LM Studio.** Install it from [lmstudio.ai](https://lmstudio.ai) and open it once. After that
there is no need to open it: SFSS starts its server and loads the model itself.

```bash
lms get https://huggingface.co/mlx-community/Ministral-3-3B-Instruct-2512-4bit
sfss load
```

That is the MLX build, 4 bit, 2.75 GB: on a Mac with Apple Silicon it is the fastest. On an
Intel Mac MLX does not run; take the GGUF `Q4_K_M` build, the closest to it:

```bash
lms get https://huggingface.co/lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF   # choose Q4_K_M
sfss load
```

The original from Mistral is
[mistralai/Ministral-3-3B-Instruct-2512-GGUF](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF);
how to download it by hand and what was checked: [TEST-RUN-2026-11-15-GGUF](../../sfss/docs/TEST-RUN-2026-11-15-GGUF.md).
On Apple Silicon GGUF works too, about a quarter slower than MLX.

Both builds can sit in LM Studio side by side: SFSS takes the one already loaded, otherwise MLX
on Apple Silicon and GGUF on Intel. To pin a build, give its full name, for example
`sfss config model mlx-community/ministral-3-3b-instruct-2512`; all names are in
`sfss config models`.

**Ollama.** Install it from [ollama.com](https://ollama.com).

```bash
ollama pull ministral-3:3b
sfss config runtime ollama
sfss config model ministral-3:3b
```

The simplest way is to run `./install.sh` again: it finds LM Studio or Ollama and offers to
download the model. Check: `sfss ask "How does helium in the atmosphere affect combustion?"`.
The first answer after loading the model takes up to a minute. With 8 GB of memory, close heavy
apps first.

## Removal

```bash
cd ~/SFSS-Dev && ./install.sh --uninstall
```

It removes:

- the service: stops it;
- the `sfss` command;
- Python with its libraries and the search model;
- uv from `.tools`, together with its cache and the Python it downloaded, if the installer put
  uv there;
- Anti-Fire from Applications together with its cache, into the Trash.

What stays: the clone with the NASA reports and the index, `sfss/.env` and the model settings.
You can then delete the clone: `rm -rf ~/SFSS-Dev`. The language model in LM Studio or Ollama is
not touched; remove it there. If a search model from an earlier SFSS version is left over
(470 MB in `~/.cache/huggingface`), the installer offers to remove it too.

You can also drag Anti-Fire to the Trash, but then the service stays.

## Updating

```bash
cd ~/SFSS-Dev && git pull && ./install.sh
```

The installer installs what changed and replaces Anti-Fire with the new build.

## Troubleshooting

| What you see | What to do |
|---|---|
| "Could not download uv" | check the network; behind a proxy install uv by hand: https://docs.astral.sh/uv/ |
| `sfss: command not found` | open a new terminal window; check `PATH`, see "Installation" |
| "Port 8000 is taken" | `sfss start --port 8010` |
| "Could not download the search model" | check the network and run `./install.sh` again |
| LM Studio "not answering" | open LM Studio once, then `sfss load` |
| Anti-Fire does not open: "unidentified developer" | right-click the app → Open. This only happens when the `.dmg` was downloaded with a browser |
| Anti-Fire: "The sfss command was not found" | install SFSS first |

Service log: `sfss logs`.

## Building Anti-Fire from source

Only for those who change the app. You need Node 22+; the script installs Rust itself, into
`~/.cargo`, without sudo.

```bash
npm ci
bash apps/anti-fire/build.sh --install
```

It builds the app and puts it into Applications; the previous version goes to the Trash.
`--universal` builds for Intel and Apple Silicon at once.
