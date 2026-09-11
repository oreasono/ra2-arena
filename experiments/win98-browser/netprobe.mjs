// Ask the emulated network card whether it came up, from DOS, before the operating system takes
// the machine over. Run with the asset server up: node netprobe.mjs
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.goto("http://127.0.0.1:8123/ra2.html?slot=0&noboot=1");
await p.waitForTimeout(30000);
const out = await p.evaluate(() => window.stdoutText()).catch((e) => String(e));
console.log(out.slice(-2000));
try {
    const png = await p.evaluate(() => window.screenshotPNG());
    writeFileSync("out/netprobe.png",
        Buffer.from(png.split(",")[1], "base64"));
    console.log("shot written");
} catch (e) { console.log("no shot:", e.message); }
await b.close();
