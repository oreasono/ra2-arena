// A player driven by a language model.
//
// The engine only advances when the driver calls update(), so the driver can stop between turns and
// wait for a decision. That makes model latency free: a slow model and a fast one face the same
// game, and results compare on play rather than on response time.
//
// The model chooses what to produce and whether to push or hold. Mechanics that are not decisions --
// unpacking at the start, keeping harvesters working, finding somewhere legal to put a finished
// building -- are handled here, identically for every model, so comparisons are not dominated by
// who happens to emit better coordinates.
import { Bot, OrderType, QueueType, ObjectType, QueueStatus } from "@chronodivide/game-api";
import { extractJson } from "./model-client.mjs";

const QUEUE_OF = { [ObjectType.Building]: QueueType.Structures, [ObjectType.Infantry]: QueueType.Infantry,
                   [ObjectType.Vehicle]: QueueType.Vehicles, [ObjectType.Aircraft]: QueueType.Aircrafts };

const SYSTEM = `You are commanding one side in a Red Alert 2 skirmish. You will be given the state of
your base and whatever you can see of the enemy, then asked for your next orders.

Reply with JSON only, in this shape:
{"notes":"one short sentence of intent",
 "build":["STRUCTURE_ID", ...],
 "train":[{"unit":"UNIT_ID","count":N}, ...],
 "stance":"attack"|"defend"}

Unpacking at the start, harvesting, and where buildings go are handled for you: do not ask for them.
Use only identifiers that appear in the buildable lists you are given. Keep "build" and "train"
short: they are queued, not instant, and you will be asked again shortly. Choose "attack" only when
you have a force worth committing; it sends every combat unit at the enemy base and leaves home
uncovered. Economy first, then production buildings, then army.`;

export class ModelBot extends Bot {
    #client; #cadence; #maxCalls; #log;
    #baseTile = null; #enemyStart = null; #deployed = false;
    #lastPlan = null; #decisions = 0; #invalid = 0; #placementWarned = null;

    constructor(name, country, { client, cadence = 150, maxCalls = 120, log = () => {} } = {}) {
        super(name, country);
        this.#client = client;
        this.#cadence = cadence;          // ticks between decisions; 15 ticks is one game second
        this.#maxCalls = maxCalls;
        this.#log = log;
    }

    get cadence() { return this.#cadence; }
    get decisions() { return this.#decisions; }
    get invalidPlans() { return this.#invalid; }
    get lastPlan() { return this.#lastPlan; }

    onGameStart(game) {
        const me = this.player.getPlayerData();
        this.#baseTile = game.map.getTile(me.startLocation.x, me.startLocation.y) ?? null;
        const starts = game.map.getStartingLocations();
        let best = null, bestD = -1;
        for (const s of starts) {
            const d = Math.hypot(s.x - me.startLocation.x, s.y - me.startLocation.y);
            if (d > bestD) { bestD = d; best = s; }
        }
        this.#enemyStart = best;
        this.#log(`${this.name}: base at ${me.startLocation.x},${me.startLocation.y}`);
    }

    // Runs every tick. Only mechanics live here; nothing that counts as a decision.
    onGameTick(game) {
        if (!this.#deployed) this.#deployMcv(game);
        this.#keepHarvestersWorking(game);
        this.#placeFinishedBuildings(game);
    }

    #deployMcv(game) {
        // The vehicle to unpack is the one that turns into something, not the one flagged as a
        // construction yard: that flag belongs to the finished building, so filtering on it matches
        // nothing and the base is never founded.
        if (this.#hasConstructionYard()) { this.#deployed = true; return; }
        const mcvs = this.player.getVisibleUnits("self",
            (r) => r.type === ObjectType.Vehicle && !!r.deploysInto);
        if (!mcvs.length) return;
        // Deploy takes a target; DeploySelected unpacks where the unit stands, which is what is
        // wanted here. Passing the wrong one throws inside the engine on the very first tick.
        this.player.actions.orderUnits(mcvs, OrderType.DeploySelected);
    }

    #hasConstructionYard() {
        return this.player.getVisibleUnits("self",
            (r) => r.type === ObjectType.Building && r.constructionYard).length > 0;
    }

    #keepHarvestersWorking(game) {
        const idle = this.player.getVisibleUnits("self", (r) => r.harvester)
            .filter((id) => game.getUnitData(id)?.isIdle);
        if (!idle.length) return;
        const ore = game.map.getAllTilesResourceData();
        if (!ore.length) return;
        for (const id of idle) {
            const u = game.getUnitData(id);
            if (!u) continue;
            let best = null, bestD = Infinity;
            for (const t of ore) {
                const d = Math.hypot(t.tile.rx - u.tile.rx, t.tile.ry - u.tile.ry);
                if (d < bestD) { bestD = d; best = t; }
            }
            if (best) this.player.actions.orderUnits([id], OrderType.Gather, best.tile.rx, best.tile.ry);
        }
    }

    #placeFinishedBuildings(game) {
        const q = this.player.production.getQueueData(QueueType.Structures);
        if (q.status !== QueueStatus.Ready || !q.items.length) return;
        const name = q.items[0].rules.name;
        const spot = this.#findSpot(game, name);
        if (spot) {
            this.player.actions.placeBuilding(name, spot.rx, spot.ry);
        } else if (this.#placementWarned !== name) {
            // A finished building with nowhere legal to go stalls the whole queue silently.
            this.#placementWarned = name;
            this.#log(`${this.name}: nowhere to put ${name}; structure queue is stalled`);
        }
    }

    #queueSummary() {
        const parts = [];
        for (const [label, q] of [["structures", QueueType.Structures], ["infantry", QueueType.Infantry],
                                  ["vehicles", QueueType.Vehicles]]) {
            const d = this.player.production.getQueueData(q);
            if (d.items.length) {
                parts.push(`${label}: ` + d.items.map((i) => `${i.rules.name} x${i.quantity}`).join(", ") +
                    (d.status === QueueStatus.Ready ? " (ready)" : ""));
            }
        }
        return parts.join(" | ") || "nothing";
    }

    // Spiral outwards from the base until the engine accepts a position.
    #findSpot(game, name) {
        if (!this.#baseTile) return null;
        const { rx: cx, ry: cy } = this.#baseTile;
        for (let r = 2; r <= 18; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (const dy of [-r, r]) {
                    for (const [x, y] of [[cx + dx, cy + dy], [cx + dy, cy + dx]]) {
                        const tile = game.map.getTile(x, y);
                        if (tile && this.player.canPlaceBuilding(name, tile)) return tile;
                    }
                }
            }
        }
        return null;
    }

    // Called by the driver between engine updates, with the game standing still.
    async think(game) {
        if (this.#client.calls >= this.#maxCalls) return;
        const view = this.#observe(game);
        const text = await this.#client.ask(SYSTEM, view, { maxTokens: 700 });
        const plan = extractJson(text);
        this.#decisions++;
        if (!plan) { this.#invalid++; this.#log(`${this.name}: unusable reply`); return; }
        this.#lastPlan = plan;
        this.#apply(game, plan);
    }

    #observe(game) {
        const me = this.player.getPlayerData();
        const tally = (ids) => {
            const m = new Map();
            for (const id of ids) {
                const d = game.getUnitData(id);
                if (d) m.set(d.rules.name, (m.get(d.rules.name) ?? 0) + 1);
            }
            return [...m].map(([n, c]) => `${n} x${c}`).join(", ") || "none";
        };
        const buildable = (queue) => this.player.production.getAvailableObjects(queue)
            .map((r) => `${r.name}(${r.cost})`).join(", ") || "none";

        const mine = this.player.getVisibleUnits("self");
        const buildings = mine.filter((id) => game.getUnitData(id)?.rules.type === ObjectType.Building);
        const army = mine.filter((id) => {
            const d = game.getUnitData(id);
            return d && d.rules.type !== ObjectType.Building && !d.rules.harvester && !d.rules.constructionYard;
        });
        const enemy = this.player.getVisibleUnits("enemy");

        return [
            `Game time: ${Math.floor(game.getCurrentTime() / 60)} minutes.`,
            `Credits: ${me.credits}. Power produced ${me.power.total}, consumed ${me.power.drain}${me.power.isLowPower ? " (BROWNOUT)" : ""}.`,
            `Base founded: ${this.#hasConstructionYard() ? "yes" : "no, the construction vehicle is still unpacking"}.`,
            `Your buildings: ${tally(buildings)}`,
            `Your army: ${tally(army)}`,
            `Harvesters: ${this.player.getVisibleUnits("self", (r) => r.harvester).length}`,
            `Enemy units you can see: ${tally(enemy)}`,
            `Enemy base is near ${this.#enemyStart?.x ?? "?"},${this.#enemyStart?.y ?? "?"}; yours is at ${this.#baseTile?.rx ?? "?"},${this.#baseTile?.ry ?? "?"}.`,
            ``,
            `In production: ${this.#queueSummary()}`,
            ``,
            `Buildable structures: ${buildable(QueueType.Structures)}`,
            `Buildable infantry: ${buildable(QueueType.Infantry)}`,
            `Buildable vehicles: ${buildable(QueueType.Vehicles)}`,
            ``,
            `Previous intent: ${this.#lastPlan?.notes ?? "none yet"}`,
            `Your orders?`,
        ].join("\n");
    }

    #apply(game, plan) {
        const byName = new Map();
        for (const q of [QueueType.Structures, QueueType.Infantry, QueueType.Vehicles, QueueType.Aircrafts]) {
            for (const r of this.player.production.getAvailableObjects(q)) byName.set(r.name.toUpperCase(), r);
        }
        const queue = (name, count) => {
            const rules = byName.get(String(name).toUpperCase());
            if (!rules) { this.#invalid++; return false; }
            const q = QUEUE_OF[rules.type];
            if (q === undefined) return false;
            // Decisions come round faster than production finishes, so without this the same order
            // is issued every turn and the queue fills with duplicates.
            const pending = this.player.production.getQueueData(q);
            if (pending.items.some((i) => i.rules.name === rules.name)) return true;
            this.player.actions.queueForProduction(q, rules.name, rules.type, Math.max(1, Math.min(10, count | 0)));
            return true;
        };

        for (const name of (Array.isArray(plan.build) ? plan.build : []).slice(0, 3)) queue(name, 1);
        for (const item of (Array.isArray(plan.train) ? plan.train : []).slice(0, 4)) queue(item?.unit, item?.count ?? 1);

        const army = this.player.getVisibleUnits("self", (r) =>
            r.type !== ObjectType.Building && !r.harvester && !r.constructionYard);
        if (!army.length) return;
        if (plan.stance === "attack" && this.#enemyStart) {
            this.player.actions.orderUnits(army, OrderType.AttackMove, this.#enemyStart.x, this.#enemyStart.y);
        } else if (plan.stance === "defend" && this.#baseTile) {
            this.player.actions.orderUnits(army, OrderType.Move, this.#baseTile.rx + 3, this.#baseTile.ry + 3);
        }
    }
}
