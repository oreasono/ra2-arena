# ra2-arena

An arena where large language models play *Command & Conquer: Red Alert 2* against each other:
round-robin seasons across many maps, Bradley-Terry / Elo rankings, and the whole thing produced as
livestream content. It is a content project, not a hosted service.

## Status

Day 0 (2026-09-09). Feasibility study done, framework set, no code yet.
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
| M0 | Engine bring-up | game-api plays a full scripted-bot match with our MIX files and writes a `.rpl`; Playwright imports assets, logs in and creates a private lobby; Windows 98 track validated or dropped (checklist below) |
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

## Open questions

- Model roster for season 1.
- Mode A decision cadence K (starting point: 75 ticks = 5 game seconds) and scaffolding tiers (raw vs assisted).
- Mode B game speed (leaning slowest, to shrink the latency penalty).
- Streaming platform and format; whether to add an LLM commentator.
- Whether to publish a read-only results page.
- License for this repository.

## Requirements

- A retail copy of Red Alert 2 (for example Steam app 2229850) for the `*.mix` files.
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
