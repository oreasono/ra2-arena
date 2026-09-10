// Probe whether injected files reach a booted Windows 98 as a converted FAT disk.
// Evidence is the emulator's own stdout (the pre-boot `dir` and DOSBox-X's conversion messages),
// plus screenshots of the guest.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const url = process.env.URL ?? "http://127.0.0.1:8123/ra2.html?slot=0&payload=/payload-test.json&ro=1";
const WAIT = Number(process.env.WAIT ?? 240);
const browser = await chromium.launch({ headless: false, args: ["--window-position=0,25", "--window-size=1000,760"] });
const page = await browser.newPage({ viewport: null });
page.on("console", (m) => { if (!/^js-dos event/.test(m.text())) console.log(`  [${m.type()}] ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`));

await page.goto(url);
for (let i = 0; i < WAIT / 15; i++) {
    await page.waitForTimeout(15000);
    const st = await page.evaluate(() => window.state).catch(() => null);
    if (!st) { console.log(`  t+${(i + 1) * 15}s: no state yet`); continue; }
    console.log(`  t+${(i + 1) * 15}s ready=${st.ready} frames=${st.frames} injected=${st.injected} (${st.injectedBytes}B) stdout=${st.stdout?.length ?? 0}`);
    if (st.ready) {
        try {
            const png = await page.evaluate(() => window.screenshotPNG());
            writeFileSync(`out/convertfat-t${(i + 1) * 15}.png`, Buffer.from(png.split(",")[1], "base64"));
        } catch {}
    }
}
const out = await page.evaluate(() => window.stdoutText()).catch(() => "");
writeFileSync("out/convertfat-stdout.txt", out);
console.log("=== emulator stdout (filtered) ===");
console.log(out.split("\n").filter((l) => /MARKER|RA2|README|convert|FAT|Drive|drive|mount|boot|error|Error|bytes|Directory/.test(l)).slice(0, 40).join("\n") || "(nothing matched)");
await browser.close();
