# Installing on Linux

Two things get installed: **SFSS**, the service that calculates and answers, and **Anti-Fire**,
the app with a window. One script installs both, without sudo: everything goes into your home
folder.

Tested on Fedora 44 Workstation (GNOME, Wayland, NVIDIA): 44 seconds from scratch. GitHub
Actions tests installation and removal on a clean Ubuntu. The ready Anti-Fire build is for
x86_64.

## Prerequisites

- **git** and **curl** (or wget):

  ```bash
  sudo dnf install git curl                # Fedora
  ```

  ```bash
  sudo apt install git curl                # Ubuntu, Debian
  ```

- **WebKitGTK 4.1** for the Anti-Fire window. Fedora Workstation and Ubuntu Desktop usually have
  it already; the installer checks and tells you what to run:

  ```bash
  sudo dnf install webkit2gtk4.1           # Fedora
  ```

  ```bash
  sudo apt install libwebkit2gtk-4.1-0     # Ubuntu, Debian
  ```

You do not need to install Python: the installer downloads Python 3.12 if it is missing. The
system Python is neither used nor touched.

## What gets downloaded

| What | Size |
|---|---|
| The repository: code, 16 NASA reports, ready index, prediction model, Anti-Fire | about 150 MB |
| uv, the package installer, if not present yet | about 20 MB |
| Python 3.12, if not present | about 35 MB |
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

1. **Install Anti-Fire into `~/.local/share/anti-fire`?** You get the `anti-fire` command and an
   entry in the applications menu.
2. **Download Ministral 3B?** Asked only when LM Studio or Ollama is installed.

At the end the installer starts the service and runs one calculation. If the connection drops,
run `./install.sh` again: downloads are kept and finished steps are skipped.

If the installer says `~/.local/bin` is not in `PATH`, add the line it prints to `~/.bashrc` (or
`~/.zshrc`) and open a new terminal.

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

**Anti-Fire** is in the applications menu or the `anti-fire` command. It finds the `sfss` command
by itself, so the "Start SFSS" and "Stop SFSS" buttons work right away.

Under Wayland the window opens through XWayland: otherwise, with WebKitGTK on NVIDIA cards, the
window buttons did not respond and the window stayed white for a long time. To use native
Wayland: `GDK_BACKEND=wayland anti-fire`. The window may flash white for an instant at start;
that is WebKitGTK and does not affect anything.

## Language model

Answers are written by a language model on the same machine, in Ollama or LM Studio. Everything
else works without it: calculations, CSV, the Playground. The model needs about 3 GB of video
memory or RAM.

**Ollama.** Install it from [ollama.com](https://ollama.com). If the installer found it, it has
already switched SFSS to Ollama; what is left is the model:

```bash
ollama pull ministral-3:3b
sfss config model ministral-3:3b
```

**LM Studio.** Install it from [lmstudio.ai](https://lmstudio.ai) and open it once.

```bash
lms get https://huggingface.co/lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF
sfss load
```

The simplest way is to run `./install.sh` again: it finds Ollama or LM Studio and offers to
download the model. Check: `sfss ask "How does helium in the atmosphere affect combustion?"`.

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
- Anti-Fire: the app, the `anti-fire` command, the menu entry and its data.

What stays: the clone with the NASA reports and the index, `sfss/.env` and the model settings.
You can then delete the clone: `rm -rf ~/SFSS-Dev`. The language model in Ollama or LM Studio is
not touched; remove it there.

The GNOME applications menu has no "Uninstall" button for Anti-Fire. That button exists only for
what a package manager installed (dnf, apt, Flatpak), and Anti-Fire is just files in your home
folder. So the same command that installed it removes it.

## Updating

```bash
cd ~/SFSS-Dev && git pull && ./install.sh
```

## Troubleshooting

| What you see | What to do |
|---|---|
| "Could not download uv" | check the network; behind a proxy install uv by hand: https://docs.astral.sh/uv/ |
| `sfss: command not found` | open a new terminal; check `PATH`, see "Installation" |
| "Port 8000 is taken" | `sfss start --port 8010` |
| "Could not download the search model" | check the network and run `./install.sh` again |
| "The window needs the WebKitGTK 4.1 library" | install WebKitGTK, see "Prerequisites" |
| Ollama "not answering" | `ollama serve` or `systemctl start ollama`, then `sfss load` |
| Anti-Fire: "The sfss command was not found" | install SFSS first |
| No ready build for your architecture (ARM) | build from source, see below |

Service log: `sfss logs`.

## Building Anti-Fire from source

For ARM or for those who change the app. You need Node 22+; the script installs Rust itself,
into `~/.cargo`, without sudo. First the build libraries:

```bash
sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel libappindicator-gtk3-devel   # Fedora
```

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev   # Ubuntu
```

```bash
npm ci
bash apps/anti-fire/build.sh
```

The result is `apps/anti-fire/src-tauri/target/release/anti-fire`.
