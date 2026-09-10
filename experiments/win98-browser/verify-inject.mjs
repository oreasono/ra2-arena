// Confirm the full game payload actually lands in the guest's filesystem.
// Prints the emulator's own directory listing UNFILTERED -- filtering evidence has produced three
// wrong conclusions in this spike already.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const mb = process.env.MAXMB;
const manifest = mb ? `/game-manifest.json%3Fmaxmb=${mb}` : "/game-manifest.json";
const browser = await chromium.launch({ headless: false, args: ["--window-position=0,25", "--window-size=900,700"] });
const page = await browser.newPage({ viewport: null });
await page.goto(`http://127.0.0.1:8123/ra2.html?slot=0&manifest=${manifest}&ro=1`);
let out = "", st = null;
for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(5000);
    st = await page.evaluate(() => window.state).catch(() => null);
    out = await page.evaluate(() => window.stdoutText?.() ?? "").catch(() => "");
    if (/Directory of D:\\RA2/i.test(out)) break;
    console.log(`  t+${(i + 1) * 5}s injected=${st?.injected ?? "?"}/${st?.toInject ?? "?"} (${((st?.injectedBytes ?? 0) / 1048576).toFixed(0)}MB) ready=${st?.ready}`);
}
writeFileSync("out/verify-inject-stdout.txt", out);
console.log("=== emulator stdout, verbatim from the D: mount onwards ===");
const idx = out.indexOf("Drive D is mounted");
console.log(idx >= 0 ? out.slice(idx, idx + 2600) : out.slice(-2600));
await browser.close();
