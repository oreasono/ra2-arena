# Feasibility study: LLMs playing Red Alert 2 (2026-09-09)

Questions this study answers:

1. Does "Windows 98 in the browser, with Red Alert 2 installed inside it" exist?
2. Can that architecture do multiplayer?
3. How should an arena be built where different LLMs play RA2 against each other, in round-robin
   seasons over many maps, with statistically meaningful rankings?

Short answers: (1) yes, DOS.Zone; (2) yes, but it is not a platform; (3) build on the Chrono Divide
engine and its headless game API, which steps the simulation one tick at a time under the caller's
control. Real computer-use matches come second and reuse the same tournament core.

---

## 1. "Windows 98 in the browser with RA2" exists: DOS.Zone

### 1.1 DOS.Zone, "Red Alert 2: PvP (Multiplayer)"

- Page: https://dos.zone/redalert2/ , by the author of js-dos. The page says "no installation, no
  downloads", "online matchmaking, and low-latency multiplayer", "Powered by js-dos".
- Stack: **js-dos, which is DOSBox-X compiled to WebAssembly**. js-dos ships prebuilt Windows 95/98
  system images with DirectX; the DOSBox-X backend runs operating systems up to Windows 98/ME. RA2 runs
  inside such a Windows 9x image, in the browser. DOS.Zone lists 73 Windows 95 titles and 4 Windows 98
  titles.
- Multiplayer: **js-dos has its own IPX network stack** (IPX packets over WebRTC data channels, with a
  WebSocket signaling server). A free public server is provided and the server
  (`caiiiycuk/dosbox-ipx-server` / peer-server) can be self-hosted. RA2 uses its original IPX LAN mode;
  both ends must be js-dos instances.
- Business model: free, ad-free, optional subscription for cloud saves. The site hosts the game files
  itself.

### 1.2 v86 (copy.sh/v86)

- A full x86 PC emulator in the browser (x86-to-wasm JIT) with a public Windows 98 demo image.
- It has NE2000 emulation plus a WebSocket relay, so two instances can share a virtual network.
  **No demonstration of RA2 running on v86 was found.**
- Performance is the blocker: full-system emulation without a dynamic core. The wasm build of DOSBox-X
  has the same limitation (Windows 98 is documented to be much slower without the dynamic core), which
  is why DOS.Zone offers a native "DOS Browser" app to "boost performance".

### 1.3 Comparison

| | DOS.Zone (js-dos / DOSBox-X + Win9x) | v86 + Windows 98 | Chrono Divide (section 2) |
|---|---|---|---|
| RA2 runs | Yes, in production | Unverified, expected unplayable | Yes, engine rewritten from scratch |
| Multiplayer | Yes (IPX over WebRTC/WebSocket) | In theory (NE2000 relay), no precedent | Yes, client-server, 8 players + observer |
| Compute per player | A whole emulated PC | Heavier | One browser tab or one Node process |
| Programmatic interface | None (pixels, mouse, keyboard) | None | **Game API** (state queries + orders) |
| Pause / single-step | Single instance only; not in a network game | Same | **Headless mode is stepped by the caller** |
| Replays | None | None | `.rpl`, viewable in the real client |
| Verdict | A museum piece, not a platform | Not viable | **The platform** |

Building "models playing RA2 through computer use" on a Windows 98 emulator means every model stares
at screenshots of an emulated PC that cannot be paused, exposes no state and records no replay. It is
not the foundation. Section 8 revisits the Windows 98 idea in a form that does make sense.

---

## 2. The real foundation: Chrono Divide (and RA2WEB)

### 2.1 Where it stands (as of 2026-09-09)

| Item | Fact |
|---|---|
| What it is | A **from-scratch rewrite** of the RA2 engine in TypeScript/WebGL, playable in the browser, aiming for feature parity with the original engine. Non-profit fan project, essentially a single author. |
| Client version | **0.84.0, released 2026-09-03** (patch notes are updated continuously) |
| Multiplayer | Official client-server model; up to **8 combatants + 1 observer** (v0.34); surrender-to-observer (v0.36); observers can join full rooms (v0.38) |
| Maps and modes | All original multiplayer maps plus many community and ladder maps |
| Game speed | Lobby setting, default 6 (v0.28) |
| Replays | `.rpl`; the client can load replays straight from the server (v0.78) |
| Ladder | Multi-tier ladder with divisions of 100 players (v0.72), ranked (v0.82) |
| Built-in AI | Supalosa's single-player bot is integrated into the client (since v0.57, improved in v0.79) |
| Chinese-language version | **RA2WEB** (www.ra2web.com), an authorized Chinese-language operation: translation, mobile controls, AI fixes. Its GitHub organization open-sources its own parts plus a one-click static client deployment package; terms are non-commercial. |
| Assets | **You must supply the RA2 `*.mix` files.** The client imports them from a local install folder, an archive, or a URL. Clean source: Steam, "Red Alert 2 and Yuri's Revenge", app 2229850, list price $19.99. |

### 2.2 The Game API (what makes this project possible)

npm package `@chronodivide/game-api`: **0.79.0, released 2026-09-03, tracking engine 0.84**; 52
releases since 2023-04, steady cadence. Requires Node 20 or newer. The notes below were checked
against the package's TypeScript definitions.

- **Headless.** The engine runs inside Node; no browser, no official server needed.
- **The caller advances the simulation** (from the README):

  ```ts
  await cdapi.init(process.env.MIX_DIR);          // points at an RA2 installation
  const game = await cdapi.createGame({
      agents: [new BotA("Red", "Americans"), new BotB("Blue", "French")],
      mapName: "mp03t4.map", gameMode: cdapi.getAvailableGameModes("mp03t4.map")[0],
      gameSpeed: 5, credits: 10000, unitCount: 10, shortGame: true,
      superWeapons: false, mcvRepacks: true, cratesAppear: false, buildOffAlly: false,
  });
  while (!game.isFinished()) { await game.update(); }   // nothing moves until we call update()
  game.saveReplay(); game.dispose();
  ```

  The type definitions describe `update()` as "Advances the game turn in offline mode or waits for the
  next turn in online mode", and offline games run "programatically at the fastest possible speed".
  **A model can think as long as it likes; the game waits.** This is exactly the "Lite" (pause) mode
  VideoGameBench introduced to cope with LLM latency, and here the engine supports it natively.
- Time base: 15 ticks = 1 game second (Supalosa's driver divides ticks by 15).
- **One process can host 1v1, 2v2, 4v4, up to 8 players** (Supalosa's driver has all three configs).
- **Observation surface**: `getPlayerData` (credits, power, radar); `getVisibleUnits(player,
  "self" | "allied" | "hostile" | "enemy")` **filtered by fog of war**; per-unit `UnitData` (HP, weapons,
  veterancy, facing, idle, cargo, ammo, mind control, bomb timer, ...); map terrain, bridges, resources,
  pathfinding, reachability, shroud checks; production queues and buildable objects; superweapon
  status; events for spawn, destroy and ownership change.
- **Action surface**: `orderUnits` (Move, ForceMove, Attack, ForceAttack, AttackMove, Guard, GuardArea,
  Capture, Occupy, Deploy, Stop, Dock, Gather, Repair, Scatter, EnterTransport, PlaceBomb, ...),
  `placeBuilding`, `queueForProduction` / `unqueue` / `pause`, `sellObject`, `toggleRepairWrench`,
  `activateSuperWeapon`, `toggleAlliance`, `sayAll` (chat; usable for a "trash talk" side metric).
- **Speed**: in Supalosa's full-match test a scripted 1v1 typically ends in about 3500 ticks with a
  6000-tick cap inside a 30 s test timeout, so the engine runs at least ~8x real time. **The only
  bottleneck will be model latency.**
- **Replays**: `saveReplay()` writes `.rpl`, importable into the real client; 0.79 adds
  `Replay.parse` and `cdapi.loadReplay` to re-simulate a replay turn by turn and read state, so
  post-match statistics (economy curves, time to first attack, losses) can be computed offline.
- **Online mode**: a bot can play humans on the official server (since 0.78 this needs an `apiKey`
  and `xwolApiUrl`, obtained from the Chrono Divide team); only one API bot per online game and it
  must be the host.
- The determinism rules (no `Math.random`, `Math.sin`, etc. in bot code; use the API's versions) are
  a hard constraint only for code integrated into the game loop. LLM decisions enter the replay as
  player orders, so replays reproduce regardless.

### 2.3 Licensing, stated plainly

- The engine is **proprietary and not open source** (a known iOS port describes itself as "used with
  the author's permission, non-commercial only"); the npm package is `license: UNLICENSED`. The README
  explicitly invites bot development, but **public leaderboards, sites, or any commercial use need
  the author's written permission**.
- RA2WEB derivatives: personal research and hobby use only.
- RA2 assets: Electronic Arts copyright. **EA has never open-sourced RA2** (the 2025-02 releases were
  Tiberian Dawn, Red Alert 1, Renegade and Generals). Internal research: buy a retail copy. Public
  sites: never host assets; users bring their own.

---

## 3. Prior art: how far "LLMs playing RTS" has come

| Project | Game / engine | Interface | Real-time handling | State of play |
|---|---|---|---|---|
| **OpenRA-RL** (GPL-3, ~150 stars) | **Red Alert 1** via OpenRA (modified C# engine in Docker, gRPC, Python/FastAPI) | Structured JSON observations + **48 MCP tools** (move, attack, build, train, deploy, groups, ...); OpenRouter / Ollama / LM Studio | **No pause**: engine runs at ~25 Hz, observation channel drops the oldest so the model always reads the latest state | Deterministic `.orarep` replays, an OpenRA-Bench leaderboard on Hugging Face Spaces. **Only published result: Qwen3-32B vs the built-in Beginner AI, five games, economy 0.58-0.80, combat 0.0, all draws** (it never built an attacking force). Roadmap lists "cross-LLM comparison". |
| TextStarCraft2 / SC2Arena / StarEvolve / StarCraft II Arena / DSGBench | StarCraft II | Text state + macro actions | Chain-of-summarization to reduce decision frequency | With scaffolding, LLMs beat the built-in Harder (Lv5) AI, "close to an average player with eight years of experience" |
| RTSGameBench (2026-06) | Beyond All Reason | **VLM** + FSM + agentic memory | - | VLMs degrade when matchups need multi-unit coordination and when scale grows |
| VideoGameBench (2025) | Doom II, Age of Empires, ... | Raw screenshots | **Lite mode: the emulator pauses while the agent thinks** | Exposes VLM perception errors (dead enemies mistaken for live ones) |
| Kaggle Game Arena (Google) | Chess, poker, werewolf | Text | Turn-based | Elo leaderboards; "games as benchmarks" is an accepted narrative |

**The gap**: nobody has built a model-vs-model RA2 arena. RA2 has an outsized following in China,
and "which model plays RA2 best" is a story on its own.

---

## 4. Match modes (one tournament core, three drivers)

| | **A. API turn-based** | **B. Real computer use** | **C. Synthetic vision** |
|---|---|---|---|
| The model sees | JSON/text situation, fog-of-war filtered | Screenshots of the real client | A top-down PNG rendered from state (Supalosa's `VisualisedBot` already does something similar) plus text |
| The model outputs | Tool calls (batches of structured orders) | Coordinate clicks / hotkeys | Same as A |
| Engine | game-api headless, one Node process | Real client + **official server** (or RA2WEB) | Same as A |
| Real time | **Paused while the model thinks**, latency-independent | Cannot pause; latency goes straight into the result | Same as A |
| Fairness | High: same tools, prompts, budgets | Low: latency, vision and click precision all mixed in | Medium |
| External dependencies | None (runs locally) | Official server availability, terms, API key | None |
| Cost per game | Medium (section 6) | High (a screenshot every few seconds) | Medium |
| Showcase value | Medium (replays are watchable) | **High** ("AI is really playing Red Alert") | Medium |
| Engineering | State serializer, order parser, tournament runner | Playwright orchestration of two Chromes: asset import, login, private lobby, start, end detection | A plus a renderer |

**Recommended path**: A first (the tournament framework and statistics all get built here), C as a
flag on A (same match with or without an image, to test whether vision helps), B last as the showcase
and stream format, reusing A's schedule, Elo, replays and site. **Do not start with B**: the latency
confound makes the statistics uninterpretable, and the whole pipeline would hang on someone else's
public server.

### Mode A design points

1. **Decision cadence**: pause every K ticks (starting point K=75, i.e. 5 game seconds; treat K as an
   experimental variable), serialize the player's view, get a batch of orders, validate, issue, run K
   more ticks.
2. **Scaffolding tiers must be explicit**: raw (atomic orders only) vs assisted (auto-harvest, auto
   building placement, control groups). Scaffolding is a confound; **every model gets the same set**,
   labeled as a track.
3. **Draw handling**: `shortGame: true` (losing all base structures ends the game), a time limit, and a
   tie-break on economy/army score at timeout. OpenRA-RL's lesson is that LLMs tend to build and never
   attack.
4. **Budgets**: per-game, per-side token/cost caps; exceeding them counts as a forfeit and is recorded.
5. **Reproducibility**: fixed maps, spawns, factions and seeds; keep the `.rpl` and every
   prompt/response; derive secondary metrics from replays offline.

---

## 5. Tournament format and statistics

- Format: **round robin**; every pair plays each map twice with spawns/factions swapped; rotate maps;
  optionally free-for-all (3-8 players).
- Ranking: **Bradley-Terry / Elo** (as used by Kaggle Game Arena) with bootstrap confidence intervals;
  separate tables per map, per faction, per scaffolding tier.
- Secondary metrics (from replays): time to first attack, economy curve, unit loss ratio, APM
  equivalent, timeout rate, invalid-order rate, token consumption.
- Sample size (95% CI half-width for a pairwise win rate is about 1.96 * sqrt(p(1-p)/n)):

| Games per pair, n | CI half-width |
|---|---|
| 20 | +/- 22 points |
| 50 | +/- 14 points |
| 100 | +/- 10 points |

A Bradley-Terry model pools information across pairs, so a global ranking needs fewer games per pair
than a pairwise comparison. Starting point: **at least 30 games per pair**; 6 models = 15 pairs x 30 =
450 games.

---

## 6. Cost and time (estimates; assumptions stated)

Assumptions: one decision every 5 game seconds; a 20-game-minute match, so 240 decisions per side;
~8k input tokens per decision (cacheable prefix) and ~400 output tokens.

| Item | Per side, per game | 450 games x 2 sides |
|---|---|---|
| Input tokens | ~2M | ~1.8B |
| Output tokens | ~0.1M | ~90M |
| Example at $3 / $15 per M tokens | ~$7.5 | ~$6.8k |

Prompt caching, a cheaper roster, or a 10-game-second cadence each cut this by 50-80%.
Wall clock: model latency dominates; roughly 20-30 minutes per game; with 8-10 games in parallel,
450 games take one to two days on a single 8-16 core Linux box.

---

## 7. Risks

| Risk | Detail | Mitigation |
|---|---|---|
| Licensing | Proprietary engine, UNLICENSED API, EA-owned assets, non-commercial RA2WEB | Fine for internal research; **get the author's written permission before anything public**; never host assets |
| Single-maintainer dependency | One author; 0.78 already changed online auth in a breaking way | Pin versions; modes A and C are fully offline |
| Models may be weak | Prior art shows LLMs that build and never fight, ending in draws | Draw rules, scaffolding tracks, the built-in scripted bot as a calibration opponent |
| Confounds | Tool-calling ability, context length, budgets, randomness | Same prompts, tools and budgets; side swaps; fixed seeds; full logs |
| Engine blind spots | Bot-side naval logic is unimplemented; some maps unsupported | Land maps only at first |
| Mode B on a public server | Terms, rate limits, being mistaken for cheating | Private rooms via API key, or a self-deployed RA2WEB client with a requested server |

---

## 8. The Windows 98 track, revisited: a VM farm on one host

The objection to section 1 was "but you could run one emulator per player and connect them". That is
correct, and the honest version of the verdict is: the Windows 98 route **can** work, but only for
Mode B, and it is a more expensive, more fragile and more blind Mode B. What it cannot do, regardless of
how many instances run: expose state (no API, so results come from OCR of the end screen), record
replays, or offer an observer view.

Running several emulators on one machine is fine, and the browser is not needed for that. js-dos's
`emulators` package (8.4.2) does expose `sendKeyEvent`, `sendMouseMotion`, `sendMouseButton`, `pause`,
`resume`, `screenshot` and `networkConnect` (IPX), so browser automation would work; but each wasm
instance pins one core with an interpreted CPU core, and background tabs freeze rendering. On our own
hardware the right container is **QEMU/KVM**:

| Form | Per instance | Per 16-core / 64 GB host (estimate) | Main issue |
|---|---|---|---|
| js-dos wasm (browser tab) | 1 core pinned + ~0.5 GB | ~12 instances = 6 1v1 games | No dynamic core; background-tab freezing |
| QEMU/KVM Windows 98 VM | 1 vCPU + 128-256 MB | 30+ instances | Windows 98 on KVM has known quirks to work through |

What KVM gives: near-native speed; `-netdev socket,mcast=...` puts several VMs on one L2 segment so
IPX frames flow (one multicast group per match isolates matches); QMP provides `stop`, `cont`,
`screendump` and `input-send-event`, so pause, screenshots and input injection are standard. If all VMs
in a match are stopped and resumed together, the guests' clocks stop with them and lockstep networking
should not notice; if that holds, the Windows 98 track can run turn-based too. This is an inference
and is on the M0 checklist.

---

## Sources

- DOS.Zone RA2 PvP: https://dos.zone/redalert2/ ; js-dos networking: https://js-dos.com/networking.html ; IPX server: https://github.com/caiiiycuk/dosbox-ipx-server ; DOSBox-X backend: https://js-dos.com/dosbox-x.html ; Lon.TV review (2026-03): https://blog.lon.tv/2026/03/01/dos-games-in-a-browser-dos-zone-review/
- v86: https://copy.sh/v86/ , https://github.com/copy/v86 , networking discussion https://github.com/copy/v86/discussions/994
- Chrono Divide: https://chronodivide.com/ ; patch notes https://chronodivide.com/patch-notes.html ; client https://game.chronodivide.com/ ; GitHub https://github.com/chronodivide ; Game API https://www.npmjs.com/package/@chronodivide/game-api ; playground https://github.com/chronodivide/game-api-playground ; Supalosa bot https://github.com/Supalosa/supalosa-chronodivide-bot ; iOS port (licensing note) https://github.com/ammaarreshi/RedAlert2-Mac-iOS-iPad
- RA2WEB: https://github.com/ra2web , https://github.com/ra2web/ra2web.github.io , https://github.com/ra2web/ra2web-chronodivide-bot
- EA open-source scope: https://www.techpowerup.com/333300/ea-makes-command-conquer-source-code-public ; Steam RA2: https://store.steampowered.com/app/2229850/
- OpenRA-RL: https://github.com/yxc20089/OpenRA-RL , https://huggingface.co/blog/jadetan/openra-rl , https://openra-rl.dev/docs/getting-started/
- Papers: TextStarCraft2 https://arxiv.org/abs/2312.11865 ; SC2Arena https://arxiv.org/pdf/2508.10428 ; DSGBench https://arxiv.org/pdf/2503.06047 ; RTSGameBench https://arxiv.org/abs/2606.18950 ; VideoGameBench https://www.alphaxiv.org/abs/2505.18134 , https://vgbench.com/blog.html ; Kaggle Game Arena https://www.kaggle.com/benchmarks/kaggle/game-arena
- EA content policy (video monetization): https://help.ea.com/en/articles/security-and-rules/ea-content-policy/
