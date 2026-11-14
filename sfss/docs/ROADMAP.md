# Requirements after the call with the organisers

The call was not recorded, so the source here is Roman's voice notes made right after it. Statuses
as of 2026-11-15. Pull request numbers before 14 November refer to the two earlier repositories:
back end PlazmaRoma/Anti-Fire_backend_MVP, front end heyyAzamat/space-fire-security-software.
From 14 November everything is in PlazmaRoma/SFSS-Dev.

## Sources

| Voice note | About | Text |
|---|---|---|
| 1 | the app is a playground, the substance is in the background | Roman's transcript, below |
| 2 | the back end as the main program, a daemon, the Russian language | Roman's transcript, below |
| 3 | a separate laconic program, third-party software, delivery | Roman's transcript, below |
| 4 | repeating old points | not transcribed: according to Roman, nothing useful |
| Presentation | submission rules, criteria, deadlines | Roman's screenshots, below; no other material |

There are no recordings of Igor's panel.

## Organisers' rules

New as of 2026-11-01. Source: six screenshots of the organisers' presentation and Roman's words
about the ban.

**Deadlines.** The hackathon runs 14–15 November 2026. Pitch and local judging on 15 November:
3 minutes of pitch, 2 minutes of questions. **The project must be submitted on the website by
15 November, 23:59 local time**, even after a local award: otherwise there is no global judging.
A global prize needs at least one NASA challenge: ours is Flame in Freefall.

**Ban on Chinese AI.** The rules were rewritten on the fly and ban them in any form. The earlier
decision "a local model does not count" (`ARCHITECTURE.md` § 7.15) is cancelled, see § 7.18.

| Rule | How we meet it | Status |
|---|---|---|
| No Chinese AI | answers by Ministral 3B, the Playground's recorded answers redone | done |
| AI-made content contains no NASA branding: logos, flags, mission insignia | the emblem was removed from the landing footer; Anti-Fire and `sfss` never had it | done |
| State where and how AI was used | `SUBMISSION.md`, the AI section | draft, Roman to complete |
| List all data, resources and tools, including code, text and images | `SUBMISSION.md` | draft |
| Submission page: what it does, how it works, advantages, goals, tools | `SUBMISSION.md` | draft |
| Slides: team, member names, challenge, project image, user experience, how open data makes the solution possible | slide plan in `DEMO.md` | no slides yet, the team makes them |
| A 3-minute pitch | `DEMO.md`, a script with slides | one run-through, not from a clean reboot |

**Criteria: the same at every stage.**

| Criterion | Our answer | Weak spot |
|---|---|---|
| Impact | any station software can ask whether the atmosphere is more dangerous and get an answer from the reports | the model covers fuel droplets only, not materials |
| Creativity | a service to connect to instead of yet another panel; a monitor that raises the alarm itself | the monitor runs on made-up telemetry |
| Validity | cross-validation by condition, R² 0.65, a page reference on every answer | no test with a real user |
| Relevance | NASA data underneath: the model on 259 FLEX experiments, answers only from 16 reports | |
| Presentation | a 3-minute script, one sentence, limitations stated up front | last time the delivery was weak |

**An interpretation worth checking with the organisers.** The slide bans "mission insignia" in
created content. We take it to mean emblems and patches, so the text names of experiments (FLEX,
BASS-II) stay: sources must be named. The Space Apps logo stays in the landing footer as a mark
of participation, next to a note that the project is not affiliated with NASA.

## Requirements

| # | Requirement | From | Where done | Status |
|---|---|---|---|---|
| 1 | Do not present the app as finished: make it a playground | 1, 2 | icon and labels: front #6 | labels in place |
| 2 | Rename the app itself | 1 | SFSS Playground: front #6 | done |
| 3 | Show what the final program could look like, not pretend to be it | 2 | Playground label: front #6 | done |
| 4 | The substance is in the back end: it runs in the background and computes everything | 1, 2 | `sfss`: back end #11 | done |
| 5 | A full daemon with commands | 2 | `sfss start`, `stop`, `status`, `logs`: #11 | done; no launchd autostart |
| 6 | Work not only over the API but from a terminal too | 2 | `sfss predict`, `ask`, `import`: #11, #12 | done |
| 7 | Connection over an external API; your own modules plug into the back end | 1, 2 | `/v1`, access key: #12 | done; from another machine tested only by tests |
| 8 | An answer to "where do I enter data, how do I import?" | 1 | batch calculation, PDF upload: #12 | done |
| 9 | Proper instructions | 2 | `INTEGRATION.md`, `DEMO.md`, install guides per system | done |
| 10 | Finish the Russian language: the main task at the time | 2 | back end #4–#6, #10, #13 | done, limitations below |
| 11 | A separate full program "like NASA's": very laconic, utilitarian, no over-design. Enter data, get an answer, ask the AI | 3 | Anti-Fire: front #5 | done; no test with a real user |
| 12 | Show third-party software working through the API, as an extra | 3 | `examples/telemetry_monitor.py`: #13 | done |
| 13 | Confident delivery without over-engineering; do not present the playground as the real program | 3 | `DEMO.md`: #13 | script ready |
| 14 | The Playground ships with the main program | 3 | `sfss playground`: #13 | done |

In voice note 2 the phrase about Russian was transcribed as "finish at home"; it is probably
"finish properly".

## Decided later, different from the voice notes

Voice note 2 says "SFSS becomes a playground". When agreeing on the plan Roman decided otherwise:

- **`sfss`** is the main program: daemon, API, commands. The Playground ships with it.
- **Anti-Fire** is a separate program "like NASA's".
- **The Playground** is the old program, now SFSS Playground.
- **AI is not a separate mode.** Voice note 3 says "switch to AI mode"; after looking at Igor's
  panel we decided the AI is always open and not hidden behind buttons.

Details: `ARCHITECTURE.md` § 7.16, § 7.17.

## Done after review

Roman looked at the programs himself and sent comments by voice.

| Date | Comment | What was done | PR | Status |
|---|---|---|---|---|
| 11-01 | Anti-Fire cannot bring up the model, and Bionic has no "load" button | the service starts LM Studio itself and loads the model with context 8192; a button and `sfss load` | back end #14, front #7 | merged |
| 11-01 | No command to unload the model | `sfss unload`, `unload` in the terminal, `POST /v1/llm/unload` | back end #14, front #7 | merged |
| 11-01 | The terminal covers the program and is awkward to drag | the terminal is dragged with the mouse and stops at the table header | front #7 | merged |
| 11-01 | Collapsing chats is not obvious, chats cannot be deleted, the "Data" table breaks | "← Back to calculation" and Esc, deleting chats, each column scrolls on its own | front #7 | merged |
| 11-01 | The program notices an unloaded model late | polling every 2 s and on returning to the window | front #7 | merged |
| 11-01 | Program language from the system or a switch | RU/EN at the top left | front #7 | merged |
| 11-01 | A broken formula in a Russian answer | formulas lost in PDF extraction no longer reach the model | back end #14 | merged; measured on 9 answers |
| 11-02 | SFSS has to be found in Activity Monitor | Anti-Fire starts and stops SFSS on this machine | back end #15, front #8 | merged |
| 11-02 | Configure the model connection, the LM Studio or Ollama port | `sfss config`, the "AI settings" window in Anti-Fire and the Playground, `config` in the terminal | back end #16, front #9 | merged |
| 11-04 | On the Playground the AI question is hidden in a tab | the question is always on screen, on the right; the tabs moved under the room | back end #17, front #10 | merged |
| 11-04 | The Playground does not scroll to the end, and not at all in a narrow window | one screen only in a window from 1241 × 700, otherwise normal scrolling | back end #17, front #10 | merged |
| 11-05 | Design suggestions for the Playground; Roman chose all three | the "this is a playground" note in the header; modules in one strip; short slider hints on the name line | back end #17, front #10 | merged |
| 11-09 | Anti-Fire's interface scrolls although everything fits in the window | page scrolling and the macOS bounce are off; only parts scroll | back end #18, front #11 | merged |
| 11-09 | The "Load" button is unclear | "Load model", "Unload model", "Reload model" | back end #18, front #11 | merged |
| 11-09 | After "Start SFSS" the warm-up is printed only after the warm-up | `sfss` output in the terminal line by line, as the command runs | back end #18, front #11 | merged |
| 11-14 | The Playground header note gets cut off and looks odd | the note is removed: the name already says "SFSS Playground" | back end #20, front #13 | merged |
| 11-14 | One repository is needed for the submission | SFSS-Dev: `sfss/` with the Playground, `apps/anti-fire/` | SFSS-Dev, first commit | merged |
| 11-14 | Anti-Fire opens left of centre; the O₂ field is selected at start | the window fits the work area and is centred by the system; no autofocus | SFSS-Dev #1 | merged |
| 11-14 | An installer for `sfss` and the programs | `install.sh`, `install.ps1`, builds for three systems in GitHub Actions | SFSS-Dev #2 | merged |
| 11-14 | Installation is painfully slow, on Windows it seems to hang | search on ONNX and an own index instead of PyTorch and ChromaDB, uv instead of pip, ready Anti-Fire builds: 330 MB instead of 1.7 GB | SFSS-Dev #3 | merged |
| 11-15 | Everything English by default; the chosen language is remembered | installers, `sfss`, Anti-Fire and the Playground in English by default | SFSS-Dev #3 | merged |
| 11-15 | On Windows the installation breaks off at LM Studio | `lms ls` without turning stderr into an error; checked live on Windows 10 | SFSS-Dev #3, #4 | in PR #4 |
| 11-15 | On Fedora the window buttons do not work, the window is white for a long time, not centred | XWayland and no DMA-BUF under Wayland; GTK centres the window; checked live on Fedora 44 | SFSS-Dev #4 | in PR #4 |
| 11-15 | Install and removal instructions per system | `README.md` and `docs/install/` | SFSS-Dev #4 | in PR #4 |
| 11-15 | `main` in English, a Russian version kept | the `dev(ru)` branch; documentation in English, no comments in the code | SFSS-Dev #5 | in progress |

## What is left

**Russian.** The whole pipeline was run on eight topics and a trap with Ministral 3B and the final
glossary. What remains is in `ARCHITECTURE.md` § 7.18: imprecise terms, a rare answer without a
reference, an extra note in a refusal. The reference label is sometimes "с." or "p.".

**Not tested:** answers through a real Ollama (ARCHITECTURE § 7.21: translation with a JSON schema
and how long the model stays in memory). On Fedora the installer found Ollama, but no model was
downloaded: the machine's video card cannot run it.

**For Roman:**

- give Anti-Fire to someone who has not seen it;
- run the pitch twice from a clean reboot;
- make the slides and complete `SUBMISSION.md`: names, AI used by the other members.

**An idea without a decision.** Voice note 3 names OpenCode as an example: chats, and then an IDE
opens. Anti-Fire has chats, and a terminal instead of an IDE. No separate IDE was made.

## Voice note transcripts

Roman's transcripts, translated, without timestamps. A digression about a past project is
shortened.

**Voice note 1.** "We should probably also rename the app itself and make it a playground. That
is, not present it as something finished, but make it a playground. Because if we present it as
an app, they will ask: where do I enter data, where is this, where is that, how do I import
something. And we say: here is a program that runs in the background, you can call it. You plug
your own modules into the program, into the back end. I will probably redo this ten more times,
and that is fine."

**Voice note 2.** "Yes, it should probably be a playground, because making a finished program
that does things by ready-made standards is rather bad: we need our program to be just a thing
that shows what the final program could look like. Ours is just a playground. Literally SFSS
becomes a playground, because the substance of the program is in the back end. That is where the
main program lives, the one to call, the one that computes everything. And we need proper
instructions. We need a connection over an external API. Probably a full daemon with commands
you can call. Not only over the API, apparently, also from a terminal. It is complicated. But the
main task now is to solve the Russian language problem, because I had not even thought about it
before. I use English as my default. It did not occur to me that people would talk to the model in
Russian too. So I need to finish the Russian language properly."

**Voice note 3.** "And look, besides the playground, the examples to play with, we probably need a
full program that looks like a real scientific thing: without this endless front end, without
this super redesign, just a program where you enter data and get an answer. Then switch, say, to
AI mode and ask a question, so it is very laconic. I could make something like OpenCode, where you
have chats and then an IDE opens. Same idea: if everything here is ready to play with, we can make
one more example, to show how it could work in a real NASA program, how we think about it at all.
So the Playground ships with the main program, and separately we can come up with a thing that
shows how third-party software really works with the API. That needs showing too, as an extra.
[…] Another problem was positioning […], it was not confident and quite sluggish. Also because we
over-designed, everything was too complicated; again, we should look at what Igor had. If we show
our huge inconvenient playground and say it is a real program, they will say: this is
inconvenient, why not this, why not that. Better to make it a playground, where you can play, and
then this full software, which we think is how NASA would do it, very laconic, very utilitarian,
and it will be liked straight away, nothing extra needed."
