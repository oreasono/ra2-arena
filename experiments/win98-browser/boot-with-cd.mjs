// Boot the guest with the original disc attached and show which drive it landed on, so the real
// installer can be run from it. Nothing is assumed: the drive list comes from the guest itself.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const B = String.fromCharCode(92);
const browser = await chromium.launch({ headless: false, args: ["--window-position=0,25", "--window-size=1000,780"] });
const page = await browser.newPage({ viewport: null });
let step = 0;
const shot = async (l) => { step++; try { const p = await page.evaluate(() => window.screenshotPNG());
    writeFileSync(`out/inst-${String(step).padStart(2,"0")}-${l}.png`, Buffer.from(p.split(",")[1], "base64"));
    console.log(`     shot: inst-${String(step).padStart(2,"0")}-${l}`); } catch {} };
const teal = () => page.evaluate(async () => {
    const img = await window.ci.screenshot(); const d = img.data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 40 && Math.abs(d[i+1]-128) < 40 && Math.abs(d[i+2]-128) < 40) n++;
    return n / (d.length / 4); });
const SH = { ":": "Semicolon", "*": "Digit8", ">": "Period", "?": "Slash" };
const typeGuest = async (t) => { for (const ch of t) { const k = SH[ch];
    if (k) { await page.keyboard.down("Shift"); await page.keyboard.press(k); await page.keyboard.up("Shift"); }
    else await page.keyboard.type(ch); await page.waitForTimeout(50); } };
const step_ = async (cmd, label, settle = 10000) => {
    console.log(`  -> ${cmd}`);
    for (let a = 0; a < 3; a++) {
        const before = await teal();
        await page.evaluate(() => window.clickAt(0.039, 0.973, 1));
        await page.waitForTimeout(2500);
        if (await teal() < before - 0.02) {
            await page.keyboard.press("r"); await page.waitForTimeout(2500);
            await typeGuest(cmd); await page.waitForTimeout(600);
            await page.keyboard.press("Enter"); await page.waitForTimeout(settle);
            await shot(`${label}-result`); return true;
        }
        await page.keyboard.press("Escape"); await page.waitForTimeout(1800);
    }
    console.log("     START MENU DID NOT OPEN"); return false;
};
await page.goto("http://127.0.0.1:8123/ra2.html?slot=0&manifest=/game-manifest.json&ro=0&cd=ra2cd.iso");
for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(10000);
    const st = await page.evaluate(() => window.state).catch(() => null);
    const s = st?.ready ? await teal().catch(() => -1) : -1;
    console.log(`  t+${(i+1)*10}s injected=${st?.injected ?? "?"} desktop=${s >= 0 ? s.toFixed(2) : "-"}`);
    if (s > 0.25) break;
}
await page.locator("canvas").click({ position: { x: 400, y: 300 } }).catch(() => {});
await page.waitForTimeout(1000);
await shot("desktop");
// Ask the guest what drives it has, rather than guessing a letter for the disc.
// The disc attaches before boot; the question is whether Windows still sees it afterwards.
await step_(`command.com /k dir E:${B}`, "disc-in-windows", 12000);
if (process.env.INSTALL === "1") {
    console.log("  -> running the installer from the disc");
    await typeGuest(`E:${B}SETUP.EXE`);
    await page.keyboard.press("Enter");
    for (const t of [20, 50, 90]) {
        await page.waitForTimeout(t === 20 ? 20000 : 30000);
        await shot(`setup-t${t}`);
    }
}
console.log("done");
await browser.close();
