// A guest I can drive one step at a time.
//
// A fixed script cannot install a game: every wizard page needs a look before the next click. So
// this process boots the guest once, keeps it alive, and takes commands over HTTP. Screenshots go
// to out/ numbered in the order they were taken, so the record of the session is the record of what
// was actually on screen.
//
// GET /shot?label=x        screenshot now
// GET /click?x=&y=&n=      click at emulator-normalised coordinates
// GET /type?t=            type a string into the guest
// GET /key?k=&n=           press a key n times
// GET /wait?ms=
// GET /run?cmd=            Start -> Run -> command -> Enter
// GET /state /stdout /quit
import { chromium } from "playwright";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const URL_ = process.env.GUEST_URL
    ?? "http://127.0.0.1:8123/ra2.html?slot=0&manifest=/game-manifest.json&ro=0&cd=ra2cd.iso";
const PROFILE = process.env.PROFILE ?? "/private/tmp/claude-501/win98-profile";

const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    args: ["--window-position=0,25", "--window-size=1000,780"],
    viewport: null,
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

let step = 0;
const shot = async (label) => {
    step++;
    const name = `drv-${String(step).padStart(3, "0")}-${label}.png`;
    const p = await page.evaluate(() => window.screenshotPNG());
    writeFileSync(`out/${name}`, Buffer.from(p.split(",")[1], "base64"));
    return name;
};
const teal = () => page.evaluate(async () => {
    const img = await window.ci.screenshot(); const d = img.data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 40 && Math.abs(d[i + 1] - 128) < 40 && Math.abs(d[i + 2] - 128) < 40) n++;
    return n / (d.length / 4);
});
// Shift state does not cross into the guest on its own: a typed ':' arrives as ';'.
const SH = { ":": "Semicolon", "*": "Digit8", ">": "Period", "?": "Slash", "_": "Minus", "+": "Equal" };
const typeGuest = async (t) => {
    for (const ch of t) {
        const k = SH[ch];
        if (k) { await page.keyboard.down("Shift"); await page.keyboard.press(k); await page.keyboard.up("Shift"); }
        else await page.keyboard.type(ch);
        await page.waitForTimeout(50);
    }
};
// Ctrl+Esc never reaches the guest, the browser keeps it. Click the Start button and verify the
// menu actually opened by watching the desktop colour disappear behind it.
const runCmd = async (cmd, settle = 8000) => {
    for (let a = 0; a < 3; a++) {
        const before = await teal();
        await page.evaluate(() => window.clickAt(0.039, 0.973, 1));
        await page.waitForTimeout(2500);
        if (await teal() < before - 0.02) {
            await page.keyboard.press("r"); await page.waitForTimeout(2500);
            await typeGuest(cmd); await page.waitForTimeout(600);
            await page.keyboard.press("Enter"); await page.waitForTimeout(settle);
            return true;
        }
        await page.keyboard.press("Escape"); await page.waitForTimeout(1800);
    }
    return false;
};

console.log(`booting ${URL_}`);
await page.goto(URL_);
let booted = false;
for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(10000);
    const st = await page.evaluate(() => window.state).catch(() => null);
    const s = st?.ready ? await teal().catch(() => -1) : -1;
    console.log(`  t+${(i + 1) * 10}s injected=${st?.injected ?? "?"} desktop=${s >= 0 ? s.toFixed(2) : "-"}`);
    if (s > 0.25) { booted = true; break; }
}
await page.locator("canvas").click({ position: { x: 400, y: 300 } }).catch(() => {});
await page.waitForTimeout(1000);
console.log(`booted=${booted}, first shot: ${await shot("desktop")}`);
console.log("control server on http://127.0.0.1:8199");

const num = (v, d) => (v === null || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const q = u.searchParams;
    const send = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    try {
        switch (u.pathname) {
            case "/shot": return send({ file: await shot(q.get("label") ?? "shot") });
            case "/click": {
                await page.evaluate(([x, y, n]) => window.clickAt(x, y, n),
                    [num(q.get("x"), 0.5), num(q.get("y"), 0.5), num(q.get("n"), 1)]);
                await page.waitForTimeout(num(q.get("settle"), 1200));
                return send({ ok: true, file: await shot(q.get("label") ?? "click") });
            }
            case "/type": {
                await typeGuest(q.get("t") ?? "");
                await page.waitForTimeout(num(q.get("settle"), 800));
                return send({ ok: true, file: await shot(q.get("label") ?? "type") });
            }
            case "/key": {
                const k = q.get("k") ?? "Enter";
                for (let i = 0; i < num(q.get("n"), 1); i++) { await page.keyboard.press(k); await page.waitForTimeout(200); }
                await page.waitForTimeout(num(q.get("settle"), 1500));
                return send({ ok: true, file: await shot(q.get("label") ?? `key-${k}`) });
            }
            case "/wait": {
                await page.waitForTimeout(num(q.get("ms"), 5000));
                return send({ ok: true, file: await shot(q.get("label") ?? "wait") });
            }
            case "/run": {
                const ok = await runCmd(q.get("cmd") ?? "", num(q.get("settle"), 8000));
                return send({ ok, file: await shot(q.get("label") ?? "run") });
            }
            case "/state": return send(await page.evaluate(() => window.state));
            case "/stdout": return send({ out: await page.evaluate(() => window.stdoutText()) });
            case "/quit": send({ ok: true }); await ctx.close(); process.exit(0); break;
            default: return send({ error: "unknown" });
        }
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e?.message ?? e) })); }
}).listen(8199, "127.0.0.1");
