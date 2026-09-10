// Run a match between scripted bots on your own game assets. No LLM is involved: this is the
// multiplayer substrate that model-driven agents will later plug into, and the baseline opponent
// that model results get measured against.
//
//   MIX_DIR=~/ra2-mix node tools/scripted-match.mjs
//   MAP=mp03t4.map PLAYERS=4 MIX_DIR=~/ra2-mix node tools/scripted-match.mjs
//
// The bot is Supalosa's, the same implementation the game client ships as its single-player
// opponent. See https://github.com/Supalosa/supalosa-chronodivide-bot
import { cdapi } from "@chronodivide/game-api";
import { SupalosaBot } from "@supalosa/chronodivide-bot/dist/bot/bot.js";
import { Countries } from "@supalosa/chronodivide-bot/dist/bot/logic/common/utils.js";

const mapName = process.env.MAP ?? "mp06t2.map";
const players = Number(process.env.PLAYERS ?? 2);
const maxTicks = Number(process.env.MAX_TICKS ?? 60000);   // 15 ticks = 1 in-game second
const names = ["Red", "Blue", "Green", "Yellow", "Orange", "Pink", "Purple", "Cyan"].slice(0, players);
const countries = [Countries.USA, Countries.RUSSIA, Countries.FRANCE, Countries.IRAQ,
                   Countries.GERMANY, Countries.LIBYA, Countries.KOREA, Countries.CUBA];

if (!process.env.MIX_DIR) { console.error("set MIX_DIR (see tools/make-mix-dir.sh)"); process.exit(1); }
await cdapi.init(process.env.MIX_DIR);

const game = await cdapi.createGame({
    online: false,
    agents: names.map((n, i) => new SupalosaBot(n, countries[i % countries.length], [], false)),
    mapName,
    gameMode: cdapi.getAvailableGameModes(mapName)[0],
    gameSpeed: 6, credits: 10000, unitCount: 0, shortGame: true,
    superWeapons: false, mcvRepacks: true, cratesAppear: false, buildOffAlly: false,
});
console.log(`${players}-player free-for-all on ${mapName}: ` +
    game.getPlayerStats().map((p) => `${p.name}/${p.country.name}`).join(" vs "));

const t0 = Date.now();
let reported = 0;
while (!game.isFinished() && game.getCurrentTick() < maxTicks) {
    await game.update();
    const tick = game.getCurrentTick();
    if (tick - reported >= 4500) {                       // every 5 in-game minutes
        reported = tick;
        const alive = game.getPlayerStats().filter((p) => !p.defeated).map((p) => `${p.name}(${p.credits})`);
        console.log(`  ${String(Math.floor(tick / 15 / 60)).padStart(2)}m: alive ${alive.join(" ")}`);
    }
}

const wall = (Date.now() - t0) / 1000, ticks = game.getCurrentTick();
console.log(`finished=${game.isFinished()} after ${(ticks / 15 / 60).toFixed(1)} in-game minutes`);
console.log(`wall clock ${wall.toFixed(1)}s = ${(ticks / wall).toFixed(0)} ticks/s, ${(ticks / 15 / wall).toFixed(0)}x real time`);
for (const p of game.getPlayerStats()) {
    console.log(`  ${p.name.padEnd(7)} ${p.country.name.padEnd(11)} defeated=${p.defeated} credits=${p.credits}`);
}
const standing = game.getPlayerStats().filter((p) => !p.defeated).map((p) => p.name);
console.log("winner:", standing.length === 1 ? standing[0] : `undecided (${standing.join(", ") || "none"})`);
console.log("replay:", game.saveReplay(process.env.REPLAY_DIR ?? "."));
game.dispose();
