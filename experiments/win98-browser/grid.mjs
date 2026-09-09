// Launch N headed Chromium windows tiled on the main display, one js-dos instance each,
// wait for the emulator, capture per-instance screenshots straight from the emulator,
// inject input, and sample CPU. This is the M0 spike for the "Windows 98 in the browser" track.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const N = Number(process.env.N ?? 4);
const COLS = Number(process.env.COLS ?? 2);
const SCREEN_W = Number(process.env.SCREEN_W ?? 1920), SCREEN_H = Number(process.env.SCREEN_H ?? 1080), TOP = 25;
const HOLD = Number(process.env.HOLD_SECONDS ?? 240);
const READY_TIMEOUT = Number(process.env.READY_TIMEOUT ?? 240);
const BASE = process.env.BASE ?? "http://127.0.0.1:8123/index.html";
const DRIVE_C = process.env.DRIVE_C ?? "";   // e.g. a js-dos public Windows image
const DRIVE_D = process.env.DRIVE_D ?? "";
const OWNER = process.env.OWNER ?? "";   // sockdrive owner token, e.g. "system" for js-dos public images
const IPX = process.env.IPX === "1";        // slot 0 hosts, others connect to its peerId
mkdirSync("out", { recursive: true });

const rows = Math.ceil(N / COLS);
const W = Math.floor(SCREEN_W / COLS), H = Math.floor((SCREEN_H - TOP) / rows);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function cpuSample() {
    // Sum CPU% and RSS of all Chromium processes (renderers included).
    const out = execSync("ps -A -o %cpu=,rss=,comm=", { encoding: "utf8" });
    let cpu = 0, rss = 0, n = 0;
    for (const line of out.split("\n")) {
        if (!/chromium|Chrome/i.test(line) || /playwright.*node/.test(line)) continue;
        const [c, r] = line.trim().split(/\s+/); cpu += Number(c); rss += Number(r); n++;
    }
    return { cpuPct: Math.round(cpu), rssMB: Math.round(rss / 1024), procs: n };
}

const slots = [];
async function openSlot(i, extra = "") {
    const x = (i % COLS) * W, y = TOP + Math.floor(i / COLS) * H;
    const browser = await chromium.launch({ headless: false, args: [`--window-position=${x},${y}`, `--window-size=${W},${H}`] });
    const page = await browser.newPage({ viewport: null });
    page.on("console", (m) => { if (/error|fail|exception/i.test(m.text())) log(`slot ${i} console:`, m.text().slice(0, 200)); });
    const params = new URLSearchParams({ slot: String(i) });
    if (DRIVE_C) params.set("c", DRIVE_C);
    if (DRIVE_D) params.set("d", DRIVE_D);
    if (OWNER) params.set("owner", OWNER);
    await page.goto(`${BASE}?${params}${extra}`);
    slots.push({ i, browser, page });
    return { browser, page };
}
async function waitReady(page, i) {
    const t0 = Date.now();
    while (Date.now() - t0 < READY_TIMEOUT * 1000) {
        const st = await page.evaluate(() => window.state).catch(() => null);
        if (st?.ready) return st;
        await page.waitForTimeout(1000);
    }
    throw new Error(`slot ${i}: emulator not ready after ${READY_TIMEOUT}s`);
}

log(`grid ${COLS}x${rows}, window ${W}x${H}, N=${N}, owner=${OWNER || "dos.zone"} driveC=${DRIVE_C || "(none: DOS prompt)"}, ipx=${IPX}`);
let hostPeer = null;
for (let i = 0; i < N; i++) {
    const extra = IPX ? (i === 0 ? "&server=1" : `&connect=${encodeURIComponent(hostPeer)}`) : "";
    const { page } = await openSlot(i, extra);
    if (IPX && i === 0) {
        const st = await waitReady(page, i);
        hostPeer = st.peerId; log(`slot 0 ready, ipx host peerId=${hostPeer}`);
    }
}
const readyStates = await Promise.all(slots.map((s) => waitReady(s.page, s.i)));
readyStates.forEach((st, i) => log(`slot ${i} ready in ${((st.readyAt - st.startedAt) / 1000).toFixed(1)}s peerId=${st.peerId ?? "-"} ${st.netError ? "netError=" + st.netError : ""}`));

const samples = [];
const BOOT_TIMEOUT = Number(process.env.BOOT_TIMEOUT ?? 170); // seconds from page load until we give up and reload
const MAX_RETRIES = Number(process.env.MAX_RETRIES ?? 3);
const DWELL = Number(process.env.DWELL ?? 60);                 // seconds to keep the grid up after everyone booted
const boot = slots.map((s) => ({ slot: s.i, attempts: 1, bootedAt: null, loadedAt: Date.now(), failures: [] }));
const t0 = Date.now();
let tick = 0, allBootedAt = null;
while (Date.now() - t0 < HOLD * 1000) {
    await new Promise((r) => setTimeout(r, 15000)); tick++;
    const cpu = cpuSample();
    const scores = [];
    for (const s of slots) {
        const b = boot[s.i];
        let score = -1;
        try { score = await s.page.evaluate(() => window.desktopScore()); } catch {}
        scores.push(Number(score.toFixed(2)));
        try {
            const dataUrl = await s.page.evaluate(() => window.screenshotPNG());
            writeFileSync(`out/slot${s.i}-t${tick}.png`, Buffer.from(dataUrl.split(",")[1], "base64"));
            writeFileSync(`out/slot${s.i}-latest.png`, Buffer.from(dataUrl.split(",")[1], "base64"));
        } catch (e) { log(`slot ${s.i} screenshot failed: ${String(e).slice(0, 120)}`); }
        if (!b.bootedAt && score > 0.25) { b.bootedAt = Date.now(); log(`slot ${s.i} desktop reached in ${((b.bootedAt - b.loadedAt) / 1000).toFixed(0)}s (attempt ${b.attempts})`); }
        if (!b.bootedAt && Date.now() - b.loadedAt > BOOT_TIMEOUT * 1000) {
            b.failures.push(`attempt ${b.attempts}: no desktop after ${BOOT_TIMEOUT}s (score ${score.toFixed(2)})`);
            if (b.attempts <= MAX_RETRIES) {
                log(`slot ${s.i} boot failed (attempt ${b.attempts}), reloading`);
                b.attempts++; b.loadedAt = Date.now();
                try { await s.page.reload(); await waitReady(s.page, s.i); } catch (e) { log(`slot ${s.i} reload failed: ${String(e).slice(0, 120)}`); }
            }
        }
        if (b.bootedAt) { try { await s.page.mouse.move(100 + tick * 7, 100 + tick * 5); } catch {} }
    }
    samples.push({ t: Math.round((Date.now() - t0) / 1000), ...cpu, scores });
    log(`t+${samples.at(-1).t}s chromium cpu=${cpu.cpuPct}% rss=${cpu.rssMB}MB desktop=[${scores.join(",")}] attempts=[${boot.map((b) => b.attempts).join(",")}]`);
    if (boot.every((b) => b.bootedAt) && !allBootedAt) { allBootedAt = Date.now(); log(`all ${N} desktops up; dwelling ${DWELL}s`); }
    if (allBootedAt && Date.now() - allBootedAt > DWELL * 1000) break;
}
writeFileSync("out/samples.json", JSON.stringify({ N, COLS, W, H, DRIVE_C, IPX, readyStates, boot, samples }, null, 2));
log("boot summary: " + JSON.stringify(boot.map((b) => ({ slot: b.slot, attempts: b.attempts, bootSeconds: b.bootedAt ? Math.round((b.bootedAt - b.loadedAt) / 1000) : null, failures: b.failures }))));
log("done; closing windows");
await Promise.all(slots.map((s) => s.browser.close()));
