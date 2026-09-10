// Import the registry keys, confirm, register the component, then start the game.
//
// Paths are assembled with String.fromCharCode(92) on purpose. Writing them as escaped literals
// went through enough layers of quoting that they arrived in the guest doubled, as
// "d:\\ra2\\install.reg", and the registry import failed with a file-open error for several
// rounds while looking like it had been tested.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const B = String.fromCharCode(92);
const GAME = `D:${B}RA2`;

const browser = await chromium.launch({ headless: false, args: ["--window-position=0,25", "--window-size=1000,780"] });
const page = await browser.newPage({ viewport: null });
const shot = async (n) => { try { const p = await page.evaluate(() => window.screenshotPNG());
    writeFileSync(`out/${n}.png`, Buffer.from(p.split(",")[1], "base64")); } catch {} };
const teal = () => page.evaluate(async () => {
    const img = await window.ci.screenshot(); const d = img.data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 40 && Math.abs(d[i+1]-128) < 40 && Math.abs(d[i+2]-128) < 40) n++;
    return n / (d.length / 4); });
const typeGuest = async (t) => { for (const ch of t) {
    if (ch === ":") { await page.keyboard.down("Shift"); await page.keyboard.press("Semicolon"); await page.keyboard.up("Shift"); }
    else await page.keyboard.type(ch);
    await page.waitForTimeout(55); } };
const runCommand = async (cmd) => {
    console.log(`  run: ${cmd}`);
    for (let a = 0; a < 3; a++) {
        const before = await teal();
        await page.evaluate(() => window.clickAt(0.039, 0.973, 1));
        await page.waitForTimeout(2500);
        if (await teal() < before - 0.02) {
            await page.keyboard.press("r"); await page.waitForTimeout(2500);
            await typeGuest(cmd); await page.waitForTimeout(600);
            await page.keyboard.press("Enter"); return true;
        }
        await page.keyboard.press("Escape"); await page.waitForTimeout(1500);
    }
    console.log("  could not open the Start menu");
    return false;
};

await page.goto("http://127.0.0.1:8123/ra2.html?slot=0&manifest=/game-manifest.json&ro=0");
for (let i = 0; i < 48; i++) {
    await page.waitForTimeout(10000);
    const st = await page.evaluate(() => window.state).catch(() => null);
    const s = st?.ready ? await teal().catch(() => -1) : -1;
    console.log(`  t+${(i+1)*10}s injected=${st?.injected ?? "?"} desktop=${s >= 0 ? s.toFixed(2) : "-"}`);
    if (s > 0.25) break;
}
await page.locator("canvas").click({ position: { x: 400, y: 300 } }).catch(() => {});
await page.waitForTimeout(1000);

await runCommand(`regedit ${GAME}${B}install.reg`);
await page.waitForTimeout(8000);
await page.keyboard.press("Enter");     // confirm
await page.waitForTimeout(6000);
await shot("fix-import");
await page.keyboard.press("Enter");     // dismiss result
await page.waitForTimeout(4000);

await runCommand(`regsvr32 ${GAME}${B}Blowfish.dll`);
await page.waitForTimeout(10000);
await shot("fix-regsvr");
await page.keyboard.press("Enter");
await page.waitForTimeout(4000);

await runCommand(`${GAME}${B}GAMEMD.EXE`);
for (const t of [20, 50, 110]) { await page.waitForTimeout(t === 20 ? 20000 : 30000); await shot(`fix-game-t${t}`); }
console.log("screenshots written");
await browser.close();
