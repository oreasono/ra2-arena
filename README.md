# ra2-arena

**English** · [简体中文](README.zh-CN.md)

An arena where large language models play *Command & Conquer: Red Alert 2* against each other. Every
match produces a replay, a per-decision log, and a result.

Two ways to run a match:

- **Headless engine** — model vs model (or vs a built-in scripted bot) on the
  [`@chronodivide/game-api`](https://www.npmjs.com/package/@chronodivide/game-api) engine. The game
  only advances when the runner asks a model for orders, so a slow model and a fast one face the same
  game and are compared on how they play, not on response time.
- **Real Windows XP guests** — two QEMU/KVM guests play a LAN match while a vision model drives one
  side from screenshots. See [experiments/xp-vm](experiments/xp-vm/).

Nothing licensed is shipped here: **bring your own copy of Red Alert 2** (and, for the Windows path,
your own Windows XP media). Model API keys live only in `.env`.

## Game files

**You must own the games.** This project ships no game or OS assets, and nothing licensed is
committed here. The download links below are community-preservation mirrors, provided only as a
convenience for people who **already own a legitimate copy**. *Red Alert 2* is © Electronic Arts;
Windows XP is © Microsoft. Don't download them unless you own the corresponding license; if a rights
holder objects, the links come out.

### Red Alert 2 (both modes)

The engine reads Red Alert 2's `*.mix` archives — base game only; the assembler skips the Yuri's
Revenge / expansion archives, so an image that bundles RA2 + Yuri's Revenge is fine.

**From Steam** (app 2229850) — best for local development. Its Windows depots can be downloaded on
macOS or Linux too, from the client console (`steam://open/console`, or launch Steam with
`-console`), then assemble a `MIX_DIR`:

```
download_depot 2229850 2229851 4928885831751969588   # base game, ~1.9 GB
download_depot 2229850 2229852 2191822715159570153   # English,   ~1.2 GB
tools/make-mix-dir.sh
MIX_DIR=~/ra2-mix node tools/engine-smoke.mjs        # verify the engine can read it
```

Other language depots: 2229853 German, 2229854 French, 2229855 Traditional Chinese, 2229856 Korean.
There is no Simplified Chinese depot; the Traditional Chinese pack is subtitles only. Two gotchas:
the engine rejects symlinks (use hard links, same filesystem), and on macOS the Steam client writes
depots under its own app bundle, not the Steam library.

**From a disc image** — used by the containerised engine (`Dockerfile.engine`). A full-game ISO with
`.mix` files at the root works directly; the container's `tools/assemble-engine-mix.sh` extracts it
into `MIX_DIR` at start (base RA2 only). Preservation mirror (RA2 + Yuri's Revenge, USA/Europe):
<https://archive.org/details/command-conquer-red-alert-2-yuris-revenge-usa-europe>

### Windows XP (Mode B only)

Mode B installs Red Alert 2 inside two Windows XP guests, so it also needs XP install media and your
own product key.

- Windows XP Professional SP3 — preservation mirror:
  <https://archive.org/details/windows-xp-professional-sp-3-updated_202212> → save it as `winxp.iso`.
- Put **your own** product key in `winnt.sif` (copy `experiments/xp-vm/winnt.sif.example`).
- Full build-and-run steps: [experiments/xp-vm/README.md](experiments/xp-vm/README.md).

## Run a match

Headless, with a `MIX_DIR` in place (see above). Scripted bots first — no model, 2 to 8 players in
one process:

```
MIX_DIR=~/ra2-mix node tools/scripted-match.mjs
MAP=mp03t4.map PLAYERS=4 MIX_DIR=~/ra2-mix node tools/scripted-match.mjs
```

Put a language model on one or both sides:

```
MIX_DIR=~/ra2-mix MODEL_BASE_URL=... MODEL_API_KEY=... MODEL_NAME=... node tools/model-match.mjs
```

Each run prints progress and the final standings, and writes a `.rpl` replay (it imports into the
real game client) plus a per-decision log with each decision's prompt, response, latency and cost.

For the Windows XP / vision-model path, see [experiments/xp-vm](experiments/xp-vm/).

Install note: the bot declares a peer dependency on an older engine API, so `npm install` needs
`--legacy-peer-deps`.

## Requirements

- A retail copy of Red Alert 2 (see [Game files](#game-files)) for the `*.mix` files.
- Node.js 20 or newer for the headless engine.
- QEMU/KVM on Linux plus Windows XP media for Mode B.

## Licensing

- Red Alert 2 assets belong to Electronic Arts; Windows XP to Microsoft. This project ships neither,
  and commits no game or OS assets.
- Chrono Divide (`@chronodivide/game-api`) is a proprietary, non-profit fan re-implementation,
  published for bot development. This project only consumes it and redistributes nothing from it.

## References

- Chrono Divide: <https://chronodivide.com/> · Game API:
  <https://www.npmjs.com/package/@chronodivide/game-api>
