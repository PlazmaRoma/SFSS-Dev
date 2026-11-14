# Pitch script: 3 minutes plus 2 minutes of questions

Pitch and judging on 15 November 2026. The project must be submitted on the website by 23:59
the same day.

**One sentence:** SFSS is a service that calculates combustion in microgravity from NASA data and
answers from NASA reports, and any software can connect to it. Anti-Fire is a working app on top
of it: this is how, in our view, it could look in real work. The Playground is for playing with
the idea.

We show three things in exactly this order: the service, the working app, the Playground. Last
time we lost on delivery and complexity, so not a single extra screen.

## Slides

The required content is set by the organisers. No NASA logos, flags or insignia on the slides,
large font, few words.

| Slide | Content |
|---|---|
| 1 | TwinByte, team members, the Flame in Freefall challenge, the one sentence |
| 2 | an Anti-Fire screenshot and the user experience: enter conditions, get an answer, ask, open the report page |
| 3 | how the data makes the solution possible: 259 FLEX experiments train the model, 16 NASA reports give the answers and references |

## Five minutes before going on

```bash
sfss start --with-llm
sfss status      # model loaded, context 8192
```

On a new machine the `sfss` command is installed once:

```bash
./install.sh      # from the repository root, details in docs/install
```

- Close everything heavy: on 8 GB the model and swapping do not get along.
- Ask one question in Anti-Fire: the first answer after loading the model is the slowest.
- Open Anti-Fire and a terminal side by side. Clear the app terminal: `clear`.
- Start screen recording: it is also the fallback.

## Script

| Time | What we do | What we say |
|---|---|---|
| 0:00 | Slide 1 | Who we are, the challenge, the one sentence |
| 0:15 | In a regular terminal: `sfss status` | The program is a service running in the background. Everything is calculated here |
| 0:25 | Anti-Fire: O₂ 30, pressure 8.2 psi | Enter conditions, get the answer at once: 1.33 times faster than normal air |
| 0:40 | O₂ 40 | The model honestly says there are no experiments here and it has plateaued |
| 0:50 | "Load CSV": `examples/runs.csv`, 20 rows; "Save CSV" | That is the import. The bad row is flagged, the others are calculated |
| 1:05 | Question: "How does helium in the atmosphere affect combustion?" | No need to look for the AI, it is always open. It answers only from the reports |
| 1:10 | While the model writes, show the terminal at the bottom and the `curl` button | Every request is visible. The app is just an API client; yours can be too |
| 1:40 | Click a reference in the answer | Here is the report page it came from |
| 2:00 | In the terminal: `python examples/telemetry_monitor.py --delay 1 --no-ask` | Third-party software: a station monitor connected over the API and raised an alarm |
| 2:20 | `sfss playground` | And this is the Playground: see the idea and play with it |
| 2:30 | Slide 2, slide 3 | What the user gets and why it would not exist without NASA data |

An answer in English takes about 26 s, a Russian one about 36 s, and up to a minute and a half
when swapping: the honest price of a local model on 8 GB. Step 1:10 fills the pause.

## Judges' questions, 2 minutes

Questions follow the criteria: impact, creativity, validity, relevance, presentation. Prepared
answers are in the criteria table in `ROADMAP.md`.

## What to say up front, without waiting for a question

- The model predicts the **burning rate of fuel droplets** from the FLEX experiments. Materials
  (fabric, plastic, cables) are not in it. It compares atmospheres; it does not forecast a fire
  on a station.
- Quality: mean error 0.055 mm²/s versus 0.106 for a constant, R² 0.65 in cross-validation by
  condition, 259 experiments.
- Answers are written by a small local model. That is why each has a page reference, and that is
  what to check against.
- The telemetry and the threshold in the monitor are made up.

## If something goes wrong

| What happened | What to do |
|---|---|
| `sfss start`: port taken | another server holds 8000: `lsof -nP -iTCP:8000 -sTCP:LISTEN` |
| Anti-Fire: "SFSS is not running" | the "Start SFSS" button in the app itself; the reason is in its terminal and in `sfss logs`; click the indicators to change the address |
| The model is not loaded | the "Load model" button in Anti-Fire or `sfss load`; otherwise it loads on the first question |
| A question takes more than two minutes | "Stop", close extra apps, show the screen recording |
| The model runtime crashed | calculations, CSV and the monitor with `--no-ask` work without it |
| The app does not open | right-click → Open: the build is not signed by Apple |

## Run-through before the show

Last run: 2026-11-14, an 8 GB MacBook, without a reboot.

| Step | Result |
|---|---|
| `sfss start --with-llm` | 38 s including loading the model |
| O₂ 30, 8.2 psi | 0.676 mm²/s, ×1.33 |
| O₂ 40 | ×1.38 and a warning that there are no experiments above 34 % |
| `examples/runs.csv` | 19 of 20 calculated, the `0.3x` row flagged |
| Helium question in Russian | 35 s, two references; a reference opens page 5 of report NTRS-20130014061 |
| The same question in English | 26 s |
| Monitor `--delay 1 --no-ask` | 6 s, alarm at minute 20 in the airlock, ×1.33 |
| `sfss playground` | opens, the AI question is in view |

Go through it twice from a clean reboot, with a stopwatch. Before that, remove Chinese models from
LM Studio: the rules ban them, and they must not appear in the list on screen.
