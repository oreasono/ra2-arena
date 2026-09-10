// Smoke test for a MIX_DIR: initialise the engine, list maps, run a capped headless match and
// write a replay. This is the acceptance check for game assets -- a checksum proves nothing about
// whether the engine can actually read them.
//
//   MIX_DIR=~/ra2-mix node tools/engine-smoke.mjs
//
// Needs @chronodivide/game-api (Node 20+). The engine is proprietary; see the README.
import { cdapi, Bot } from "@chronodivide/game-api";

class IdleBot extends Bot {}

const dir = process.env.MIX_DIR;
if (!dir) { console.error("set MIX_DIR (see tools/make-mix-dir.sh)"); process.exit(1); }
const mapName = process.env.MAP ?? "mp06t2.map";
const cap = Number(process.env.TICKS ?? 3000);

try {
    await cdapi.init(dir);
} catch (e) {
    // Print the message only: the bundle is minified and a raw throw buries it in megabytes of source.
    console.error(`init failed: ${e?.name}: ${e?.message}`);
    process.exit(1);
}

const maps = cdapi.getAvailableMaps();
console.log(`engine initialised, ${maps.length} maps available`);
if (!maps.includes(mapName)) { console.error(`map ${mapName} not found`); process.exit(1); }

const game = await cdapi.createGame({
    online: false,
    agents: [new IdleBot("Red", "Americans"), new IdleBot("Blue", "Russians")],
    mapName,
    gameMode: cdapi.getAvailableGameModes(mapName)[0],
    gameSpeed: 6, credits: 10000, unitCount: 10, shortGame: true,
    superWeapons: false, mcvRepacks: true, cratesAppear: false, buildOffAlly: false,
});
console.log(`game on ${mapName}: ${game.gameApi.getPlayers().join(" vs ")}; ${game.gameApi.getBaseTickRate()} ticks per in-game second`);

const t0 = Date.now();
while (!game.isFinished() && game.getCurrentTick() < cap) await game.update();
const wall = (Date.now() - t0) / 1000;
const ticks = game.getCurrentTick();
console.log(`simulated ${ticks} ticks in ${wall.toFixed(1)}s = ${(ticks / wall).toFixed(0)} ticks/s (${(ticks / 15 / wall).toFixed(0)}x real time)`);
console.log("NOTE: idle agents issue no orders; a real bot with pathfinding and combat is far slower.");
console.log("replay:", game.saveReplay(process.env.REPLAY_DIR ?? "."));
game.dispose();
