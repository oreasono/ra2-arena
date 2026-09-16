// Play a match with one side driven by a language model and the other by the scripted bot.
//
// The engine only moves when this loop calls update(), so between turns the game simply stands
// still while the model is asked what to do. Latency therefore does not affect the outcome.
//
//   MIX_DIR=~/ra2-mix MODEL_BASE_URL=... MODEL_API_KEY=... MODEL_NAME=... node tools/model-match.mjs
//
// Optional: MAP, CADENCE (ticks between decisions, 15 = one game second), MAX_CALLS, MAX_TICKS,
// REPLAY_DIR, LOG_DIR.
import { ActionType, cdapi, Replay, ReplayEventType } from "@chronodivide/game-api";
import { SupalosaBot } from "@supalosa/chronodivide-bot/dist/bot/bot.js";
import { Countries } from "@supalosa/chronodivide-bot/dist/bot/logic/common/utils.js";
import { ModelClient } from "../packages/model-bot/model-client.mjs";
import { ModelBot } from "../packages/model-bot/model-bot.mjs";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";

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
const maxTicks = Number(process.env.MAX_TICKS ?? 60000);
// Derive the budget from the length of match it has to cover. Setting the two independently let a
// match run out of decisions half way through and coast to the tick limit with nobody giving orders,
// which reads as a draw but is really a configuration error.
const needed = Math.ceil(maxTicks / cadence) + 2;
const maxCalls = Number(process.env.MAX_CALLS ?? needed);
if (maxCalls < needed) {
    console.warn(`note: a budget of ${maxCalls} decisions covers ${Math.round(maxCalls * cadence / 15 / 60)} of ` +
                 `${Math.round(maxTicks / 15 / 60)} game minutes; the rest will be played without orders`);
}
const logDir = process.env.LOG_DIR ?? "./data/logs";
if (!process.env.MIX_DIR) { console.error("set MIX_DIR (see tools/make-mix-dir.sh)"); process.exit(1); }
mkdirSync(logDir, { recursive: true });

// OPPONENT=model puts a second model-driven player on the other side, which is the arrangement the
// project is actually for: one agent per player.
const opponent = process.env.OPPONENT ?? "scripted";
const client = new ModelClient();
const transcript = [];
const log = (m) => { console.log(`  ${m}`); transcript.push({ at: Date.now(), text: m }); };
const startedAt = new Date().toISOString();

await cdapi.init(process.env.MIX_DIR);
const limitMinutes = Math.round(maxTicks / 15 / 60);
const modelBot = new ModelBot("ModelA", Countries.USA, { client, cadence, maxCalls, limitMinutes, log });
const secondBot = opponent === "model"
    ? new ModelBot("ModelB", Countries.RUSSIA, { client: new ModelClient(), cadence, maxCalls, limitMinutes, log })
    : new SupalosaBot("Scripted", Countries.RUSSIA, [], false);
const thinkers = [modelBot, ...(opponent === "model" ? [secondBot] : [])];
const game = await cdapi.createGame({
    online: false,
    agents: [modelBot, secondBot],
    mapName,
    gameMode: cdapi.getAvailableGameModes(mapName)[0],
    gameSpeed: 6, credits: 10000, unitCount: 0, shortGame: true,
    superWeapons: false, mcvRepacks: true, cratesAppear: false, buildOffAlly: false,
});
console.log(`${client.name} vs ${opponent} on ${mapName}, a decision every ${cadence} ticks (${cadence / 15}s of game time)`);

const t0 = Date.now();
let lastThink = 0, thinkMs = 0, reported = 0;
while (!game.isFinished() && game.getCurrentTick() < maxTicks) {
    try { await game.update(); } catch (e) { die(`engine update at tick ${game.getCurrentTick()}`, e); }
    const tick = game.getCurrentTick();
    if (tick - lastThink >= cadence) {
        lastThink = tick;
        const s = Date.now();
        // Both sides decide against the same standing-still game, so neither gains from being faster.
        for (const who of thinkers) {
            const before = who.decisions;
            try { await who.think(game.gameApi); } catch (e) { die(`decision at tick ${tick} for ${who.name}`, e); }
            if (who.decisions > before) transcript.push({
                type: "decision", at: new Date().toISOString(), tick,
                minute: +(tick / 15 / 60).toFixed(1),
                side: who.name, ...who.lastDecision,
            });
        }
        thinkMs += Date.now() - s;
    }
    if (tick - reported >= 4500) {
        reported = tick;
        const alive = game.getPlayerStats().filter((p) => !p.defeated).map((p) => `${p.name}(${p.credits})`);
        console.log(`  ${String(Math.floor(tick / 15 / 60)).padStart(2)}m alive ${alive.join(" ")} | decisions ${modelBot.decisions}`);
    }
}

const wall = (Date.now() - t0) / 1000, ticks = game.getCurrentTick();
const standing = game.getPlayerStats().filter((p) => !p.defeated).map((p) => p.name);
const scores = thinkers.map((w) => ({ side: w.name, ...w.score(game.gameApi), total: 0 }))
    .map((s) => ({ ...s, total: s.credits + s.armyValue }));
const ranked = [...scores].sort((a, b) => b.total - a.total || b.armyValue - a.armyValue ||
    a.side.localeCompare(b.side));
const tieBreakWinner = ranked.length === 2 ? ranked[0].side : null;
const replayPath = game.saveReplay(process.env.REPLAY_DIR ?? ".");
const replayBody = readFileSync(replayPath);
const replay = Replay.parse(replayBody.toString("utf8"));
const actionPlayerIds = new Set(replay.events.filter((x) => x.type === ReplayEventType.TurnActions)
    .flatMap((x) => x.payload.playerActions)
    .filter((x) => x.actions.some((a) => a.type !== ActionType.NoAction)).map((x) => x.playerId));
const actionPlayers = [...actionPlayerIds].map((id) => replay.gameOpts.humanPlayers[id]?.name).filter(Boolean);
for (const row of transcript) if (row.type === "decision") row.matchId = replay.gameId;
const engineWinner = standing.length === 1 ? standing[0] : null;
const tieBreak = !engineWinner && opponent === "model" ? {
    rule: "highest credits + combat-unit build cost; then army value; then side id",
    winner: tieBreakWinner, scores,
} : null;
const result = {
    matchId: replay.gameId, status: "completed", startedAt, completedAt: new Date().toISOString(),
    map: mapName, cadence, finished: game.isFinished(), endTick: replay.endTick,
    endReason: game.isFinished() ? "elimination" : "time-limit",
    gameMinutes: +(ticks / 15 / 60).toFixed(1),
    wallSeconds: +wall.toFixed(1), thinkSeconds: +(thinkMs / 1000).toFixed(1),
    winner: engineWinner ?? tieBreakWinner,
    decidedBy: engineWinner ? "elimination" : tieBreak ? "tie-break" : "undecided",
    engineWinner, tieBreak,
    standing, model: client.stats(),
    opponent, decisionBudget: maxCalls,
    sides: thinkers.map((w) => ({ name: w.name, model: w.modelName, ...w.modelStats,
                                  decisions: w.decisions, validDecisions: w.decisions - w.invalidPlans,
                                  unusable: w.invalidPlans,
                                  attackOrders: w.attackOrders, scouts: w.scoutsSent, losses: w.losses })),
    players: game.getPlayerStats().map((p) => ({ name: p.name, country: p.country.name, defeated: p.defeated, credits: p.credits })),
    replay: { path: "/match.rpl", file: basename(replayPath), bytes: statSync(replayPath).size,
        sha256: createHash("sha256").update(replayBody).digest("hex"), gameId: replay.gameId,
        gameTimestamp: replay.gameTimestamp, engineVersion: replay.engineVersion,
        players: replay.gameOpts.humanPlayers.map((x) => x.name), actionPlayers, endTick: replay.endTick,
        turnActionEvents: replay.events.filter((x) => x.type === ReplayEventType.TurnActions).length },
};
console.log(JSON.stringify(result, null, 2));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`${logDir}/match-${stamp}.json`, JSON.stringify({ result, transcript }, null, 2));
console.log("replay:", replayPath);
console.log("log:", `${logDir}/match-${stamp}.json`);
game.dispose();
