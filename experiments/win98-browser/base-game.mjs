// Two cheap discriminators in one run:
//   1. Start the base game rather than the expansion. If one works and the other does not, the
//      cause is expansion-specific and the search space halves.
//   2. Afterwards, list any text files the game left behind -- it writes a report on some failures.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const B = String.fromCharCode(92);
const GAME = `D:${B}RA2`;
const EXE = process.env.EXE ?? "GAME.EXE";

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
    else if (ch === "*") { await page.keyboard.down("Shift"); await page.keyboard.press("Digit8"); await page.keyboard.up("Shift"); }
    else await page.keyboard.type(ch);
    await page.waitForTimeout(50); } };
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

const cdQ = process.env.CD ? `&cd=${encodeURIComponent(process.env.CD)}` : "";
await page.goto(`http://127.0.0.1:8123/ra2.html?slot=0&manifest=/game-manifest.json&ro=0${cdQ}`);
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
await page.waitForTimeout(8000); await page.keyboard.press("Enter");
await page.waitForTimeout(6000); await page.keyboard.press("Enter");
await page.waitForTimeout(4000);
for (const dll of [`${GAME}${B}Blowfish.dll`, `${GAME}${B}Internet${B}WOLAPI.dll`, `${GAME}${B}Internet${B}WOLBrowser.dll`]) {
    await runCommand(`regsvr32 ${dll}`);
    await page.waitForTimeout(9000);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);
}
await shot("wol-registered");

console.log(`launching ${EXE}`);
await runCommand(`${GAME}${B}${EXE}`);
for (const t of [25, 60, 120]) { await page.waitForTimeout(t === 25 ? 25000 : 35000); await shot(`base-${EXE}-t${t}`); }
await page.keyboard.press("Enter");   // dismiss whatever dialog is up
await page.waitForTimeout(8000);

console.log("listing any text files the game left behind");
await runCommand(`command.com /k dir ${GAME}${B}*.txt`);
await page.waitForTimeout(20000);
await shot(`base-${EXE}-leftovers`);
console.log("screenshots written");
await browser.close();
