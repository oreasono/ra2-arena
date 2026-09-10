// After Windows 98 boots, open My Computer and look at which drives the guest sees.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const url = process.env.URL ?? "http://127.0.0.1:8123/ra2.html?slot=0&payload=/payload-test.json&ro=1";
const browser = await chromium.launch({ headless: false, args: ["--window-position=0,25", "--window-size=1000,760"] });
const page = await browser.newPage({ viewport: null });
page.on("pageerror", (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`));
await page.goto(url);

const shot = async (name) => {
    const png = await page.evaluate(() => window.screenshotPNG());
    writeFileSync(`out/${name}.png`, Buffer.from(png.split(",")[1], "base64"));
};
// Fraction of classic Windows 98 teal, used to tell "desktop is up" from "still booting".
const teal = () => page.evaluate(async () => {
    const img = await window.ci.screenshot(); const d = img.data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 40 && Math.abs(d[i + 1] - 128) < 40 && Math.abs(d[i + 2] - 128) < 40) n++;
    return n / (d.length / 4);
});

let up = false;
for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(10000);
    const st = await page.evaluate(() => window.state).catch(() => null);
    const score = st?.ready ? await teal().catch(() => -1) : -1;
    console.log(`  t+${(i + 1) * 10}s ready=${st?.ready} desktop=${typeof score === "number" ? score.toFixed(2) : score}`);
    if (score > 0.25) { up = true; break; }
}
if (!up) { console.log("desktop never appeared"); await shot("drive-noboot"); await browser.close(); process.exit(1); }
await shot("drive-desktop");

// My Computer sits top-left; the emulated screen is 640x480, so normalise its centre.
console.log("double-clicking My Computer at (0.058, 0.063)");
await page.evaluate(() => window.clickAt(0.058, 0.063, 2));
for (const t of [8, 20, 35]) {
    await page.waitForTimeout(t === 8 ? 8000 : 12000);
    await shot(`drive-mycomputer-t${t}`);
    console.log(`  screenshot at +${t}s`);
}
// If the window still has not opened, select the icon and press Enter through the page, which
// js-dos forwards to the guest once the canvas has focus.
await page.locator("canvas").click({ position: { x: 40, y: 30 } }).catch(() => {});
await page.keyboard.press("Enter");
await page.waitForTimeout(10000);
await shot("drive-after-enter");

// D: is the disk converted from the injected folder. Open it and confirm the files arrived.
console.log("opening D:");
await page.evaluate(() => window.clickAt(0.489, 0.302, 1));
await page.waitForTimeout(1500);
await page.keyboard.press("Enter");
await page.waitForTimeout(9000);
await shot("drive-d-contents");
console.log("screenshots written to out/");
await browser.close();
