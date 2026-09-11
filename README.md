# ra2-arena

An arena where large language models play *Command & Conquer: Red Alert 2* against each other:
round-robin seasons across many maps, Bradley-Terry / Elo rankings, and the whole thing produced as
livestream content. It is a content project, not a hosted service.

## Status

Started 2026-09-09. Feasibility study done, framework set. The headless engine runs on our own
game files, and a spike shows several Windows 98 instances driven side by side in one browser.
Read [docs/research/2026-09-09-feasibility.md](docs/research/2026-09-09-feasibility.md) first.

## Decisions so far

| # | Decision | Meaning |
|---|---|---|
| 1 | **Content, not a platform** | We stream matches and publish results. We do not host a service for third parties: no accounts, no multi-tenancy, no asset hosting. |
| 2 | **Two match modes, built together** | Mode A: API turn-based (headless engine, game paused while models think). Mode B: real computer use (each model drives a real browser client, in real time). Both share one tournament core. |
| 3 | **Engine: Chrono Divide + `@chronodivide/game-api`** | Rationale in the feasibility study. |
| 4 | **Windows 98 track = candidate backend for Mode B** | Original RA2 binaries in a farm of QEMU/KVM Windows 98 VMs on one Linux host; IPX over a multicast virtual LAN; QMP for pause, screenshots and input. Time-boxed validation in M0; dropped if it does not work. |
| 5 | **Public repository, English only** | Nothing that cannot be public goes in here. |

Hard rules:

- Game assets (`*.mix`), Windows 98 images and any Chrono Divide client files are **never committed**. Bring your own retail copy of Red Alert 2.
- Model API keys live only in `.env` (gitignored).

## Architecture (planned)

```
packages/
  core/            match and season model, model adapters (Anthropic/OpenAI-compatible endpoints),
                   decision logs (prompt, response, latency, cost), Bradley-Terry and Elo, replay statistics
  driver-api/      Mode A: game-api headless driver. Every K ticks: pause -> serialize the player's
                   fog-of-war view -> model returns a batch of orders -> validate -> issue -> resume
  driver-browser/  Mode B: Playwright, one Chrome per model. Asset import, login, private lobby,
                   screenshot -> action loop, end-of-game detection
  broadcast/       Mode A "compute first, air later" (replay in the real client plus tick-synced model
                   reasoning captions); Mode B live overlay (OBS browser source)
apps/
  runner/          scheduling: round robin x maps x side swaps, budgets, resume, results.jsonl
data/              results.jsonl (tracked); replays/ logs/ screens/ (ignored)
docs/              research, decisions, tournament rules
```

### How each mode goes on air

- **Mode A, compute first, air later.** Matches are simulated offline with the game paused while the
  models think. The output is a `.rpl` replay plus a per-tick decision log. On stream, the replay plays
  at normal speed in the real client with both models' reasoning and economy/army curves overlaid.
  Viewers do not know the result; it is a premiere.
- **Mode B, live.** Two Chrome instances, one model each. The observer's full-map view is the main
  picture; each model's screenshots and reasoning stream are side panels. Latency counts, so Mode B has
  its own leaderboard and is never mixed with Mode A.

## Milestones

| Milestone | Scope | Done when |
|---|---|---|
| M0 | Engine bring-up | **done:** engine initialises from our own game files (273 maps); scripted bots play full matches to a winner, 2 to 8 players in one process (`tools/scripted-match.mjs`). **left:** a browser client driven end to end into a private lobby; Windows 98 track validated or dropped (checklist below) |
| M1 | Mode A, one model | One model vs the built-in scripted bot, full match, decision log, replay, cost report |
| M2 | Mode A, model vs model | Runner plays a round robin; Bradley-Terry/Elo table; premiere overlay works |
| M3 | Mode B | Two models in two Chrome instances finish a match; live overlay; first stream |
| M4 | Season 1 | 5-6 models; at least 30 Mode A games per pair; weekly Mode B showcase |

Windows 98 track checklist (M0, two days max):

1. Windows 98 SE + RA2 in QEMU/KVM (pentium3 CPU model, Cirrus VGA, PCnet/RTL8139 NIC, `-rtc clock=vm`); RA2 runs at 800x600.
2. Two VMs on one shared L2 segment (`-netdev socket,mcast=...`), IPX/SPX installed; an RA2 LAN game completes.
3. QMP `screendump` and `input-send-event` drive one screenshot -> model -> click cycle.
4. Both VMs `stop` for 30 s, then `cont`; RA2 must not drop the connection. If this holds, the track can also run turn-based.
5. Measured CPU/RAM per VM, giving games per host.

## Running a match

With `MIX_DIR` in place, scripted bots play each other headless. This is the multiplayer substrate:
2 to 8 players in one process, no LLM involved. Model-driven agents replace the scripted ones later.

```
MIX_DIR=~/ra2-mix node tools/scripted-match.mjs
MAP=mp03t4.map PLAYERS=4 MIX_DIR=~/ra2-mix node tools/scripted-match.mjs
```

Each run prints a five-minute progress line, the final standings and a `.rpl` replay path. The
replay imports into the real game client.

Measured on an Apple M4:

| Match | Result | Wall clock | Speed |
|---|---|---|---|
| 1v1, mp06t2 | winner after 29 in-game minutes | 2.7 s | 649x real time |
| 4-player FFA, mp03t4 | two bots left, no winner at the 66-minute cap | 14.3 s | 280x real time |

The second line is the important one. Scripted bots already stalemate, so the tournament rules need
a draw verdict and a tie-break on economy and army value rather than assuming every match resolves.

Install note: the published bot declares a peer dependency on an older engine API, so `npm install`
needs `--legacy-peer-deps`. The combination above was tested and plays through.

## A model playing

`tools/model-match.mjs` puts a language model on one side and the scripted bot on the other. The
engine only advances when the runner calls it, so between turns the game stands still while the
model is asked what to do: a slow model and a fast one face the same game, and results compare on
play rather than on response time.

```
MIX_DIR=~/ra2-mix MODEL_BASE_URL=... MODEL_API_KEY=... MODEL_NAME=... node tools/model-match.mjs
```

The model decides what to produce and whether to push or hold. Mechanics that are not decisions --
unpacking at the start, keeping harvesters working, finding somewhere legal to put a finished
building -- are handled identically for every model, so comparisons are not dominated by who emits
better coordinates. Every decision is written to a log with its reasoning, token counts and latency.

### First decisive match

A frontier model against the scripted bot, on a two-player map:

| | |
|---|---|
| Result | **The scripted bot won**; the model was defeated after 9.3 minutes of game time |
| Decisions | 18, every one parsed cleanly, none unusable |
| Thinking | about 6.6 s each, two minutes in total, none of it affecting the game |
| Attack orders issued | **zero** |
| Credits unspent at death | 5,500 |

The opening is sound: power, refinery, barracks, war factory, then infantry. Then it stops. The last
four decisions ask for nothing at all while five thousand credits sit idle and the enemy walks in.
Telling it about the clock, showing it its own repeated intentions, and stating that a stalemate
wins nothing did not change this.

That matches the only comparable published result, where a model kept a sound economy and scored
zero on combat across every game. It is a finding about models rather than a bug. Two things follow:
the tournament rules need a draw verdict and a tie-break on economy and army value rather than
assuming matches resolve; and passivity needs measuring as its own axis, since a model can lose
without ever being outplayed in a fight.

The most likely lever is intelligence about the opponent. The model is told where the enemy base is
but sees no enemy units for most of a match, because nothing scouts. A commander who never sees a
threat and never sees an opening has little reason to commit.

## Open questions

- Model roster for season 1.
- Mode A decision cadence K (starting point: 75 ticks = 5 game seconds) and scaffolding tiers (raw vs assisted).
- Mode B game speed (leaning slowest, to shrink the latency penalty).
- Streaming platform and format; whether to add an LLM commentator.
- Whether to publish a read-only results page.
- License for this repository.

## Game files

You need a retail copy of Red Alert 2; nothing here ships game assets. On Steam the game is app
2229850, and its Windows depots can be downloaded on macOS or Linux too, from the client console
(`steam://open/console`, or launch Steam with `-console`):

```
download_depot 2229850 2229851 4928885831751969588
download_depot 2229850 2229852 2191822715159570153
```

The first is the base game (~1.9 GB), the second English (~1.2 GB). Other language depots: 2229853
German, 2229854 French, 2229855 Traditional Chinese, 2229856 Korean. There is no Simplified Chinese
depot, and the Traditional Chinese pack is subtitles only, so the voice-over stays English.

Then assemble a `MIX_DIR` and check that the engine can actually read it:

```
tools/make-mix-dir.sh
MIX_DIR=~/ra2-mix node tools/engine-smoke.mjs
```

Three things that cost time the first time round:

- **The engine rejects symlinks.** A `MIX_DIR` of symlinks fails with
  `IOError: File "language.mix" could not be read (TypeMismatchError)`. Use hard links, which cost
  no extra space but need the same filesystem.
- **On macOS the Steam client writes depots under its own app bundle**, not the Steam library
  (`.../Steam.AppBundle/Steam/Contents/MacOS/steamapps/content/app_2229850`), and the path it
  prints mixes forward and back slashes. The directories on disk use forward slashes.
- **Verify by running the engine, not by checksumming.** Files can hash fine and still be in a
  layout the engine will not open.

Measured on an Apple M4 with the base depot plus English: 273 maps, and a 3000-tick match with idle
agents simulates at roughly 35k ticks per second. That figure is an upper bound with no orders and
no combat; a real bot with pathfinding is far slower.

## Requirements

- A retail copy of Red Alert 2 (see above) for the `*.mix` files.
- Node.js 20 or newer for the headless engine; Chrome for Mode B.
- One Linux box with 8-16 cores for parallel matches; a streaming machine with OBS.
- Chrono Divide player accounts for Mode B.

## Licensing notes

- Chrono Divide is a proprietary, non-profit fan re-implementation. Its game API is published for bot
  development but carries no open-source license. This project only consumes it; nothing from it is
  redistributed.
- Red Alert 2 assets belong to Electronic Arts. Nothing here ships assets.
- We credit Chrono Divide on stream and intend to coordinate with its author.
- AI-generated commentary is labeled where platform rules require it.

## References

- Feasibility study: [docs/research/2026-09-09-feasibility.md](docs/research/2026-09-09-feasibility.md)
- Chrono Divide: https://chronodivide.com/ ; Game API: https://www.npmjs.com/package/@chronodivide/game-api
- Prior art: OpenRA-RL, TextStarCraft2, SC2Arena, VideoGameBench, Kaggle Game Arena (links in the study)
