// Open one slot headed, dump console, page text, state and screenshots to out/ for diagnosis.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const url = process.env.URL ?? "http://127.0.0.1:8123/index.html?slot=0&owner=system&c=win98-v1";
const browser = await chromium.launch({ headless: false, args: ["--window-position=0,25", "--window-size=960,700"] });
const page = await browser.newPage({ viewport: null });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));
page.on("requestfailed", (r) => logs.push(`[reqfail] ${r.url().slice(0, 200)} ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url().slice(0, 200)}`); });
await page.goto(url);
let last = 0;
const STEPS = (process.env.STEPS ?? "10,40,70,100,130,160").split(",").map(Number);
for (const t of STEPS) {
    await page.waitForTimeout((t - last) * 1000); last = t;
    const state = await page.evaluate(() => window.state).catch((e) => String(e));
    const text = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => "");
    await page.screenshot({ path: `out/debug-t${t}.png` });
    const { stdout, ...rest } = state ?? {};
    console.log(`--- t=${t}s state=${JSON.stringify(rest)}\nbody text: ${JSON.stringify(text)}\nstdout tail: ${JSON.stringify((stdout ?? []).slice(-12))}`);
}
console.log("--- console/network log ---");
console.log(logs.slice(0, 80).join("\n"));
writeFileSync("out/debug-log.txt", logs.join("\n"));
await browser.close();
