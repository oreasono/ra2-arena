// Run a series of matches and aggregate them. One match is an anecdote; a season is the point.
//
//   MATCHES=3 MIX_DIR=~/ra2-mix MODEL_BASE_URL=... MODEL_API_KEY=... MODEL_NAME=... node tools/season.mjs
//
// Each match runs in its own process so one crash does not take the series with it. Results land in
// data/logs and are summarised here.
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const matches = Number(process.env.MATCHES ?? 3);
const maps = (process.env.MAPS ?? "mp06t2.map,mp03t4.map").split(",");
const logDir = process.env.LOG_DIR ?? "./data/logs";
mkdirSync(logDir, { recursive: true });

const before = new Set(readdirSync(logDir));
const runOne = (map, i) => new Promise((resolve) => {
    console.log(`\n--- match ${i + 1}/${matches} on ${map} ---`);
    const child = spawn(process.execPath, ["tools/model-match.mjs"], {
        stdio: ["ignore", "inherit", "inherit"],
        env: { ...process.env, MAP: map, OPPONENT: process.env.OPPONENT ?? "model" },
    });
    child.on("exit", (code) => resolve(code));
});

for (let i = 0; i < matches; i++) {
    const code = await runOne(maps[i % maps.length], i);
    if (code !== 0) console.log(`  match ${i + 1} exited with ${code}`);
}

const results = readdirSync(logDir).filter((f) => !before.has(f) && f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(`${logDir}/${f}`, "utf-8")).result);

console.log(`\n=== season: ${results.length} matches ===`);
const rows = [];
for (const r of results) {
    const [a, b] = r.sides ?? [];
    // Nobody eliminated: fall back to economy and attrition, which is the planned tie-break.
    const surv = r.players.filter((p) => !p.defeated);
    const verdict = r.winner ? `${r.winner} eliminated the other`
        : surv.length === 2
            ? `draw, tie-break to ${r.players[0].credits >= r.players[1].credits ? r.players[0].name : r.players[1].name}`
            : "no result";
    rows.push({ map: r.map, minutes: r.gameMinutes, verdict,
                a: a && `${a.name} atk=${a.attackOrders} lost=${a.losses}`,
                b: b && `${b.name} atk=${b.attackOrders} lost=${b.losses}`,
                credits: r.players.map((p) => `${p.name}=${p.credits}`).join(" ") });
}
for (const row of rows) {
    console.log(`  ${row.map.padEnd(14)} ${String(row.minutes).padStart(5)}m  ${row.verdict}`);
    console.log(`      ${row.a ?? ""} | ${row.b ?? ""} | ${row.credits}`);
}
const decided = results.filter((r) => r.winner).length;
const unusable = results.reduce((n, r) => n + (r.sides ?? []).reduce((m, s) => m + s.unusable, 0), 0);
console.log(`\n  decided by elimination: ${decided}/${results.length}; unusable replies across the season: ${unusable}`);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`${logDir}/season-${stamp}.json`, JSON.stringify({ rows, results }, null, 2));
console.log(`  season summary: ${logDir}/season-${stamp}.json`);
