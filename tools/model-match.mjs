// Play a match with one side driven by a language model and the other by the scripted bot.
//
// The engine only moves when this loop calls update(), so between turns the game simply stands
// still while the model is asked what to do. Latency therefore does not affect the outcome.
//
//   MIX_DIR=~/ra2-mix MODEL_BASE_URL=... MODEL_API_KEY=... MODEL_NAME=... node tools/model-match.mjs
//
// Optional: MAP, CADENCE (ticks between decisions, 15 = one game second), MAX_CALLS, MAX_TICKS,
// REPLAY_DIR, LOG_DIR.
import { cdapi } from "@chronodivide/game-api";
import { SupalosaBot } from "@supalosa/chronodivide-bot/dist/bot/bot.js";
import { Countries } from "@supalosa/chronodivide-bot/dist/bot/logic/common/utils.js";
import { ModelClient } from "../packages/model-bot/model-client.mjs";
import { ModelBot } from "../packages/model-bot/model-bot.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

// The engine ships as one minified bundle, so an uncaught throw prints megabytes of source and
// buries the message. Print the message and a short stack instead.
const die = (where, e) => {
    console.error(`\n${where} failed: ${e?.name}: ${String(e?.message).slice(0, 500)}`);
    for (const line of String(e?.stack ?? "").split("\n").filter((l) => l.trim().startsWith("at")).slice(0, 5)) {
        console.error("  " + line.trim().slice(0, 160));
    }
    process.exit(1);
};
process.on("unhandledRejection", (e) => die("promise", e));

const mapName = process.env.MAP ?? "mp06t2.map";
const cadence = Number(process.env.CADENCE ?? 150);
const maxCalls = Number(process.env.MAX_CALLS ?? 120);
const maxTicks = Number(process.env.MAX_TICKS ?? 60000);
const logDir = process.env.LOG_DIR ?? "./data/logs";
if (!process.env.MIX_DIR) { console.error("set MIX_DIR (see tools/make-mix-dir.sh)"); process.exit(1); }
mkdirSync(logDir, { recursive: true });

const client = new ModelClient();
const transcript = [];
const log = (m) => { console.log(`  ${m}`); transcript.push({ at: Date.now(), text: m }); };

await cdapi.init(process.env.MIX_DIR);
const modelBot = new ModelBot("Model", Countries.USA, { client, cadence, maxCalls, log });
const game = await cdapi.createGame({
    online: false,
    agents: [modelBot, new SupalosaBot("Scripted", Countries.RUSSIA, [], false)],
    mapName,
    gameMode: cdapi.getAvailableGameModes(mapName)[0],
    gameSpeed: 6, credits: 10000, unitCount: 0, shortGame: true,
    superWeapons: false, mcvRepacks: true, cratesAppear: false, buildOffAlly: false,
});
console.log(`${client.name} vs scripted bot on ${mapName}, a decision every ${cadence} ticks (${cadence / 15}s of game time)`);

const t0 = Date.now();
let lastThink = 0, thinkMs = 0, reported = 0;
while (!game.isFinished() && game.getCurrentTick() < maxTicks) {
    try { await game.update(); } catch (e) { die(`engine update at tick ${game.getCurrentTick()}`, e); }
    const tick = game.getCurrentTick();
    if (tick - lastThink >= cadence) {
        lastThink = tick;
        const s = Date.now();
        try { await modelBot.think(game.gameApi); } catch (e) { die(`decision at tick ${tick}`, e); }
        thinkMs += Date.now() - s;
        const plan = modelBot.lastPlan;
        if (plan) transcript.push({ tick, minute: +(tick / 15 / 60).toFixed(1), plan });
    }
    if (tick - reported >= 4500) {
        reported = tick;
        const alive = game.getPlayerStats().filter((p) => !p.defeated).map((p) => `${p.name}(${p.credits})`);
        console.log(`  ${String(Math.floor(tick / 15 / 60)).padStart(2)}m alive ${alive.join(" ")} | decisions ${modelBot.decisions}`);
    }
}

const wall = (Date.now() - t0) / 1000, ticks = game.getCurrentTick();
const standing = game.getPlayerStats().filter((p) => !p.defeated).map((p) => p.name);
const result = {
    map: mapName, cadence, finished: game.isFinished(),
    gameMinutes: +(ticks / 15 / 60).toFixed(1),
    wallSeconds: +wall.toFixed(1), thinkSeconds: +(thinkMs / 1000).toFixed(1),
    winner: standing.length === 1 ? standing[0] : null,
    standing, model: client.stats(),
    decisions: modelBot.decisions, unusableReplies: modelBot.invalidPlans,
    players: game.getPlayerStats().map((p) => ({ name: p.name, country: p.country.name, defeated: p.defeated, credits: p.credits })),
};
console.log(JSON.stringify(result, null, 2));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`${logDir}/match-${stamp}.json`, JSON.stringify({ result, transcript }, null, 2));
console.log("replay:", game.saveReplay(process.env.REPLAY_DIR ?? "."));
console.log("log:", `${logDir}/match-${stamp}.json`);
game.dispose();
