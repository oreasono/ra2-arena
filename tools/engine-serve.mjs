// Run exactly one model-v-model match, validate its evidence, and publish immutable artifacts.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ActionType, Replay, ReplayEventType } from "@chronodivide/game-api";
import { isValidPlan } from "../packages/model-bot/model-client.mjs";

const dir = process.env.RESULT_DIR ?? "/run/engine-results";
const model = process.env.MODEL_NAME ?? "";
if (model !== "gpt-6-astra") throw new Error("E1 requires MODEL_NAME=gpt-6-astra");
mkdirSync(dir, { recursive: true });
let state = { state: "running", model, sides: ["ModelA", "ModelB"] };
let resultBody, decisionsBody, replayPath;

const json = (res, code, value) => {
    const body = Buffer.from(JSON.stringify(value, null, 2) + "\n");
    res.writeHead(code, { "content-type": "application/json", "content-length": body.length,
        "cache-control": "no-store" });
    res.end(body);
};
const artifact = (res, path, type) => {
    if (!path || !existsSync(path)) return json(res, 425, state);
    const body = readFileSync(path);
    res.writeHead(200, { "content-type": type, "content-length": body.length,
        "cache-control": "no-store" });
    res.end(body);
};
const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method not allowed" });
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/" || path === "/status") return json(res, 200, state);
    if (path === "/result.json") return resultBody ? artifact(res, resultBody, "application/json") : json(res, 425, state);
    if (path === "/decisions.jsonl") return decisionsBody ? artifact(res, decisionsBody, "application/x-ndjson") : json(res, 425, state);
    if (path === "/match.rpl") return artifact(res, replayPath, "application/octet-stream");
    return json(res, 404, { error: "not found" });
});
server.listen(Number(process.env.PORT ?? 80), "0.0.0.0");

const matchScript = fileURLToPath(new URL("./model-match.mjs", import.meta.url));
const child = spawn(process.execPath, [matchScript], {
    stdio: "inherit", env: { ...process.env, OPPONENT: "model", LOG_DIR: dir, REPLAY_DIR: dir },
});
child.on("error", (error) => { state = { state: "failed", error: error.message }; });
child.on("exit", (code) => {
    try {
        if (code !== 0) throw new Error(`match exited ${code}`);
        const log = readdirSync(dir).filter((x) => /^match-.*\.json$/.test(x)).sort().at(-1);
        if (!log) throw new Error("match log missing");
        const evidence = JSON.parse(readFileSync(join(dir, log), "utf8"));
        const decisions = evidence.transcript.filter((x) => x.type === "decision");
        const sides = evidence.result?.sides ?? [];
        if (!evidence.result?.matchId || evidence.result.status !== "completed" ||
            !evidence.result.startedAt || !evidence.result.completedAt ||
            sides.length !== 2 || sides.some((x) => x.model !== model || x.decisions < 2 ||
                x.validDecisions < 2 || x.calls < 2))
            throw new Error("result does not prove two configured model sides");
        if (new Set(decisions.map((x) => x.side)).size !== 2 ||
            decisions.some((x) => x.matchId !== evidence.result.matchId || x.model !== model ||
                !x.at || !x.prompt || !x.intent || x.latencyMs < 0 || x.valid !== isValidPlan(x.plan)))
            throw new Error("decision evidence incomplete");
        if (sides.some((side) => decisions.filter((x) => x.side === side.name).length !== side.decisions ||
            decisions.filter((x) => x.side === side.name && x.valid).length !== side.validDecisions))
            throw new Error("decision counts or valid plans incomplete");
        if (sides.some((side) => decisions.filter((x) => x.side === side.name)
            .some((x, i, rows) => x.tick > evidence.result.endTick || (i && x.tick <= rows[i - 1].tick))))
            throw new Error("decision ticks do not match result");
        if (evidence.result.endReason === "time-limit") {
            const scores = evidence.result.tieBreak?.scores ?? [];
            const ranked = [...scores].sort((a, b) => b.total - a.total || b.armyValue - a.armyValue);
            const exactTie = scores.length === 2 && ranked[0].total === ranked[1].total &&
                ranked[0].armyValue === ranked[1].armyValue;
            const winner = exactTie ? null : ranked[0]?.side;
            const decidedBy = exactTie ? "draw" : "tie-break";
            if (scores.length !== 2 || scores.some((x) => x.total !== x.credits + x.armyValue) ||
                (!exactTie && !winner) || evidence.result.tieBreak.winner !== winner ||
                evidence.result.tieBreak.decidedBy !== decidedBy || evidence.result.winner !== winner ||
                evidence.result.decidedBy !== decidedBy) throw new Error("tie-break is not reproducible");
        }
        const nextResult = join(dir, "result.json"), nextDecisions = join(dir, "decisions.jsonl");
        const nextReplay = join(dir, "match.rpl");
        copyFileSync(join(dir, evidence.result.replay.file), nextReplay);
        writeFileSync(nextResult, JSON.stringify(evidence.result, null, 2) + "\n");
        writeFileSync(nextDecisions, decisions.map((x) => JSON.stringify(x)).join("\n") + "\n");
        const replayBody = readFileSync(nextReplay);
        const replayBytes = statSync(nextReplay).size;
        const replay = Replay.parse(replayBody.toString("utf8"));
        const replaySha256 = createHash("sha256").update(replayBody).digest("hex");
        const actionPlayers = new Set(replay.events.filter((x) => x.type === ReplayEventType.TurnActions)
            .flatMap((x) => x.payload.playerActions)
            .filter((x) => x.actions.some((a) => a.type !== ActionType.NoAction))
            .map((x) => replay.gameOpts.humanPlayers[x.playerId]?.name).filter(Boolean));
        if (replay.gameId !== evidence.result.matchId || replay.endTick !== evidence.result.endTick ||
            replay.gameOpts.humanPlayers.map((x) => x.name).sort().join() !== sides.map((x) => x.name).sort().join() ||
            [...actionPlayers].sort().join() !== sides.map((x) => x.name).sort().join() ||
            [...actionPlayers].sort().join() !== evidence.result.replay.actionPlayers.sort().join() ||
            replayBytes !== evidence.result.replay.bytes || replaySha256 !== evidence.result.replay.sha256)
            throw new Error("replay does not match result");
        resultBody = nextResult; decisionsBody = nextDecisions; replayPath = nextReplay;
        state = { state: "complete", model, sides: sides.map((x) => x.name),
            matchId: evidence.result.matchId,
            artifacts: { result: "/result.json", replay: "/match.rpl", decisions: "/decisions.jsonl" },
            decisionCounts: Object.fromEntries(sides.map((x) => [x.name, x.decisions])), replayBytes, replaySha256 };
    } catch (error) { state = { state: "failed", error: error.message }; }
});
process.on("SIGTERM", () => { child.kill("SIGTERM"); server.close(() => process.exit(0)); });
