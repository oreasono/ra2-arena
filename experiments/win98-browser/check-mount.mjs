// Read the emulator's own pre-boot output: it says plainly whether the disc image was attached.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({ headless: false, args: ["--window-position=0,25", "--window-size=900,700"] });
const page = await browser.newPage({ viewport: null });
await page.goto("http://127.0.0.1:8123/ra2.html?slot=0&manifest=/game-manifest.json&ro=0&cd=ra2cd.iso");
let out = "";
for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(5000);
    out = await page.evaluate(() => window.stdoutText?.() ?? "").catch(() => "");
    if (/imgmount|Drive number|MSCDEX|CD-?ROM|not found|rror/i.test(out)) break;
}
writeFileSync("out/mount-stdout.txt", out);
const start = out.indexOf("Drive D is mounted");
console.log("=== emulator output, verbatim ===");
console.log(start >= 0 ? out.slice(start, start + 1800) : out.slice(-1800));
await browser.close();
