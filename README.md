# SFSS Dev

Combustion in microgravity from NASA data: NASA Space Apps 2026, challenge "Flame in Freefall",
team TwinByte.

- **SFSS** is a service that runs in the background. It predicts the burning rate of a fuel
  droplet from the atmosphere composition and answers questions using only NASA reports, with a
  page reference. Any program can use it: over the HTTP API or with the `sfss` command.
- **Anti-Fire** is a working app built on SFSS. One screen: calculations, CSV import, questions
  to the reports and a terminal.
- **SFSS Playground** is a place to explore the idea and play with it. It ships with the
  service: `sfss playground`.

Everything runs on one computer and needs no network after installation.

## Installation

All you need is git. The installer brings Python, the libraries, the search model and Anti-Fire
by itself, without admin rights. Without a language model that is about 400 MB of downloads.

### macOS

```bash
git clone --depth 1 https://github.com/PlazmaRoma/SFSS-Dev.git ~/SFSS-Dev
cd ~/SFSS-Dev && ./install.sh
```

Anti-Fire is in Applications. Remove everything: `cd ~/SFSS-Dev && ./install.sh --uninstall`.
Details: [`docs/install/macos.md`](docs/install/macos.md).

### Linux

```bash
git clone --depth 1 https://github.com/PlazmaRoma/SFSS-Dev.git ~/SFSS-Dev
cd ~/SFSS-Dev && ./install.sh
```

Anti-Fire is in the applications menu or the `anti-fire` command; it needs WebKitGTK 4.1. Remove
everything: `cd ~/SFSS-Dev && ./install.sh --uninstall`. Details: [`docs/install/linux.md`](docs/install/linux.md).

### Windows

In PowerShell:

```powershell
git clone --depth 1 https://github.com/PlazmaRoma/SFSS-Dev.git $HOME\SFSS-Dev
cd $HOME\SFSS-Dev; powershell -ExecutionPolicy Bypass -File install.ps1
```

Anti-Fire is in the Start menu; the `sfss` command works in a new PowerShell window. Remove
everything: `powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall`.
Details: [`docs/install/windows.md`](docs/install/windows.md).

### Language model

Answers are written by Ministral 3B in [LM Studio](https://lmstudio.ai) or
[Ollama](https://ollama.com) on the same computer. The installer finds them and offers to
download the model, about 3 GB. Everything else works without a model: calculations, CSV, the
Playground.

## Usage

```bash
sfss status                                   # what is running
sfss predict --o2 0.30 --psi 8.2              # burning rate at 30 % oxygen and 8.2 psi
sfss predict --csv sfss/examples/runs.csv     # a whole table of conditions
sfss ask "How does helium in the atmosphere affect combustion?"
sfss playground                               # the Playground in a browser
sfss stop                                     # stop the service
sfss help                                     # all commands
```

Your own program connects to SFSS over HTTP: [`sfss/docs/INTEGRATION.md`](sfss/docs/INTEGRATION.md),
reference: [`sfss/docs/API.md`](sfss/docs/API.md), a third-party example:
[`sfss/examples/telemetry_monitor.py`](sfss/examples/telemetry_monitor.py).

## Repository layout

| Folder | Contents |
|---|---|
| [`sfss/`](sfss/) | the service: code, tests, NASA data, prediction model, ready index, docs in `sfss/docs` |
| [`sfss/playground/`](sfss/playground/) | Playground sources; the built page is in `sfss/app/static/playground` |
| [`apps/anti-fire/`](apps/anti-fire/) | Anti-Fire: the page, the Tauri window, ready builds in `release/` |
| [`docs/install/`](docs/install/) | installation and removal per system |
| `install.sh`, `install.ps1` | installers: macOS and Linux, Windows |

The Playground and Anti-Fire share code in `sfss/playground/src/shared`; Anti-Fire imports it as
`@sfss`. Both use one set of Node dependencies (npm workspaces).

## For developers

```bash
cd sfss && ../.tools/uv pip install --python .venv/bin/python pytest && .venv/bin/python -m pytest -q   # service
npm ci && npm test && npm run typecheck                                    # Playground and Anti-Fire
npm run page -w anti-fire && cd apps/anti-fire/src-tauri && cargo test     # Anti-Fire window
```

If uv is already in `PATH`, use `uv` instead of `../.tools/uv`.

- The Playground is built into a single HTML file inside the service:
  `bash sfss/scripts/update_playground.sh`. The built file is in git, so the service needs no Node.
- Anti-Fire from source: `bash apps/anti-fire/build.sh`. Ready builds for the three systems come
  from GitHub Actions, workflow `release`.
- How the service works: [`sfss/README.md`](sfss/README.md), code map
  [`sfss/docs/CODEMAP.md`](sfss/docs/CODEMAP.md), design decisions
  [`sfss/docs/ARCHITECTURE.md`](sfss/docs/ARCHITECTURE.md).

A Russian version of the repository lives in the `dev(ru)` branch.

The project used to live in two repositories: `PlazmaRoma/Anti-Fire_backend_MVP` (service) and
`heyyAzamat/space-fire-security-software` (interface). Their history stays there.

This project is not affiliated with or endorsed by NASA. The data comes from open NASA sources:
NTRS and PSI.
