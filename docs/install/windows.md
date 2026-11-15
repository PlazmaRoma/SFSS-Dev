# Installing on Windows

Two things get installed: **SFSS**, the service that calculates and answers, and **Anti-Fire**,
the app with a window. One PowerShell script installs both, without admin rights.

Tested on Windows 10: 106 seconds from scratch. GitHub Actions tests installation and removal on
a clean Windows. The ready Anti-Fire build is for x64.

## Prerequisites

- **Git for Windows**: [git-scm.com](https://git-scm.com/download/win).
- **WebView2** for the Anti-Fire window. Windows 10 and 11 already have it.

You do not need to install Python: the installer downloads Python 3.12 if it is missing. Any
Python you already have is neither used nor touched.

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

Open **PowerShell** (no need to run it as administrator) and run, one after the other:

```powershell
git clone --depth 1 https://github.com/PlazmaRoma/SFSS-Dev.git $HOME\SFSS-Dev
```

```powershell
cd $HOME\SFSS-Dev; powershell -ExecutionPolicy Bypass -File install.ps1
```

`-ExecutionPolicy Bypass` allows this one script to run and does not change Windows settings.

Steps are numbered, and downloads show their progress. The installer asks two questions;
pressing Enter answers yes to both:

1. **Install Anti-Fire into `%LOCALAPPDATA%\Programs\Anti-Fire`?** It adds a Start menu entry.
2. **Download Ministral 3B?** Asked only when LM Studio or Ollama is installed. With a weak video
   card, answer "n".

At the end the installer starts the service and runs one calculation. If the connection drops,
run `install.ps1` again: downloads are kept and finished steps are skipped.

**The `sfss` command appears only in a new PowerShell window:** the installer adds its folder to
`PATH`, and windows that are already open do not see that.

| Option | What it does |
|---|---|
| `-Yes` | answers yes to every question |
| `-NoLlm` | leaves the language model alone |
| `-NoApp` | skips Anti-Fire |
| `-Uninstall` | removes everything it installed |

## Checking

In a new PowerShell window:

```powershell
sfss status
sfss predict --o2 0.30 --psi 8.2
sfss playground
```

Expected: 1131 chunks in the index, a burning rate of 0.676 mm²/s, 1.33 times faster than
normal air; the Playground opens in a browser.

**Anti-Fire** is in the Start menu. On first start SmartScreen may warn about an unknown
publisher: "More info" → "Run anyway"; the build is unsigned. Anti-Fire finds the `sfss` command
by itself, so the "Start SFSS" and "Stop SFSS" buttons work right away.

## Language model

Answers are written by a language model on the same computer, in LM Studio or Ollama.
Everything else works without it: calculations, CSV, the Playground. The model needs about 3 GB
of video memory or RAM.

**LM Studio.** Install it from [lmstudio.ai](https://lmstudio.ai) and open it once.

```powershell
lms get https://huggingface.co/lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF   # choose Q4_K_M
sfss load
```

Take the `Q4_K_M` variant, 2.15 GB: it is the closest to the MLX 4bit build used on a Mac, and the
one that was tested. `Q6_K` and `Q8_0` are more accurate but need more memory. The original from
Mistral, with the same quant, is
[mistralai/Ministral-3-3B-Instruct-2512-GGUF](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF);
how to download it by hand and what was checked: [TEST-RUN-2026-11-15-GGUF](../../sfss/docs/TEST-RUN-2026-11-15-GGUF.md).
Ollama's `ministral-3:3b` is the same `Q4_K_M` too.

If LM Studio has several builds of the model, SFSS takes the one already loaded, otherwise the
GGUF. To pin a build, give its full name, for example
`sfss config model lmstudio-community/ministral-3-3b-instruct-2512`; all names are in
`sfss config models`.

**Ollama.** Install it from [ollama.com](https://ollama.com).

```powershell
ollama pull ministral-3:3b
sfss config runtime ollama
sfss config model ministral-3:3b
```

The simplest way is to run `install.ps1` again: it finds LM Studio or Ollama and offers to
download the model. Check: `sfss ask "How does helium in the atmosphere affect combustion?"`.

## Removal

```powershell
cd $HOME\SFSS-Dev; powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
```

It removes:

- the service: stops it;
- the `sfss` command and its folder in `PATH`;
- Python with its libraries and the search model;
- uv from `.tools`, together with its cache and the Python it downloaded, if the installer put
  uv there;
- Anti-Fire: the app, the Start menu entry and its data.

What stays: the clone with the NASA reports and the index, `sfss\.env` and the model settings.
You can then delete the clone: `Remove-Item -Recurse -Force $HOME\SFSS-Dev`. The language model
in LM Studio or Ollama is not touched; remove it there.

Anti-Fire is not listed in Windows "Apps & features". That list shows only what a Windows
installer (MSI or EXE) put there, and Anti-Fire is just files in your user folder. So the same
command that installed it removes it.

## Updating

```powershell
cd $HOME\SFSS-Dev; git pull; powershell -ExecutionPolicy Bypass -File install.ps1
```

## Troubleshooting

| What you see | What to do |
|---|---|
| "Could not download uv" | check the network; behind a proxy install uv by hand: https://docs.astral.sh/uv/ |
| `sfss` is not recognized as a command | open a new PowerShell window |
| "Port 8000 is taken" | `sfss start --port 8010` |
| "Could not download the search model" | check the network and run `install.ps1` again |
| LM Studio "not answering" | open LM Studio once, then `sfss load` |
| Anti-Fire is slow to open | normal on first start: WebView2 and the Defender scan |
| Anti-Fire: "The sfss command was not found" | install SFSS first |

Service log: `sfss logs`.

## Building Anti-Fire from source

Building on Windows needs Visual Studio Build Tools (several gigabytes), Rust and Node, and the
build script is bash. It is simpler to take the ready build: GitHub Actions makes it, Actions tab
→ `release` → Run workflow.
