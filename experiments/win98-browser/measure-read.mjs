// Measure how fast the converted disk serves a large archive. A small file copies instantly; the
// 200 MB+ archives were still running after a minute. Poll the DOS window until it reports a result.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const B = String.fromCharCode(92);
const GAME = `D:${B}RA2`;
const FILE = process.env.FILE ?? "ra2md.mix";
const SIZE_MB = Number(process.env.SIZE_MB ?? 195);
const LIMIT = Number(process.env.LIMIT ?? 900);

const browser = await chromium.launch({ headless: false, args: ["--window-position=0,25", "--window-size=1000,780"] });
const page = await browser.newPage({ viewport: null });
const shot = async (n) => { try { const p = await page.evaluate(() => window.screenshotPNG());
    writeFileSync(`out/${n}.png`, Buffer.from(p.split(",")[1], "base64")); } catch {} };
const teal = () => page.evaluate(async () => {
    const img = await window.ci.screenshot(); const d = img.data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 40 && Math.abs(d[i+1]-128) < 40 && Math.abs(d[i+2]-128) < 40) n++;
    return n / (d.length / 4); });
// The DOS window is black with light text; when the copy finishes, a line of text appears. Measure
// how many non-black pixels sit in the window area to detect that without reading the text.
const textPixels = () => page.evaluate(async () => {
    const img = await window.ci.screenshot(); const d = img.data; const w = img.width; let n = 0;
    for (let y = 60; y < 320; y++) for (let x = 40; x < 520; x++) {
        const i = (y * w + x) * 4;
        if (d[i] > 120 && d[i+1] > 120 && d[i+2] > 120) n++;
    }
    return n; });
const typeGuest = async (t) => { for (const ch of t) {
    if (ch === ":") { await page.keyboard.down("Shift"); await page.keyboard.press("Semicolon"); await page.keyboard.up("Shift"); }
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

await runCommand(`command.com /k copy ${GAME}${B}${FILE} NUL`);
await page.waitForTimeout(6000);
const base = await textPixels();
console.log(`  window opened, baseline text pixels = ${base}`);
const t0 = Date.now();
let done = false;
for (let i = 0; i < LIMIT / 15; i++) {
    await page.waitForTimeout(15000);
    const px = await textPixels();
    const el = Math.round((Date.now() - t0) / 1000);
    console.log(`  t+${el}s text pixels = ${px}`);
    if (px > base + 200) {
        console.log(`  >> output appeared after ${el}s  =>  ${(SIZE_MB / el).toFixed(2)} MB/s`);
        done = true; await shot(`speed-${FILE}-done`); break;
    }
}
if (!done) { console.log(`  no output within ${LIMIT}s`); await shot(`speed-${FILE}-timeout`); }
await browser.close();
