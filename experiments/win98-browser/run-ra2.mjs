// Inject the real game files into the guest and boot Windows 98 with them attached as a read-only
// disk. Reports injection progress, browser memory, and what the guest sees.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const url = process.env.URL ?? "http://127.0.0.1:8123/ra2.html?slot=0&manifest=/game-manifest.json&ro=1";
const browser = await chromium.launch({ headless: false, args: ["--window-position=0,25", "--window-size=1000,760"] });
const page = await browser.newPage({ viewport: null });
page.on("console", (m) => { if (!/^js-dos event|WARN!/.test(m.text())) console.log(`  [${m.type()}] ${m.text().slice(0, 180)}`); });
page.on("pageerror", (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`));

const shot = async (name) => {
    try {
        const png = await page.evaluate(() => window.screenshotPNG());
        writeFileSync(`out/${name}.png`, Buffer.from(png.split(",")[1], "base64"));
    } catch {}
};
const rssMB = () => {
    const out = execSync("ps -A -o rss=,comm= | grep -i chromium | awk '{s+=$1} END {print s}'", { encoding: "utf8" });
    return Math.round(Number(out.trim() || 0) / 1024);
};
const teal = () => page.evaluate(async () => {
    const img = await window.ci.screenshot(); const d = img.data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 40 && Math.abs(d[i + 1] - 128) < 40 && Math.abs(d[i + 2] - 128) < 40) n++;
    return n / (d.length / 4);
});

const t0 = Date.now();
await page.goto(url);
let booted = false;
for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(10000);
    const st = await page.evaluate(() => window.state).catch(() => null);
    const el = Math.round((Date.now() - t0) / 1000);
    if (!st) { console.log(`  t+${el}s: no state`); continue; }
    const inj = `${st.injected}/${st.toInject} files ${(st.injectedBytes / 1048576).toFixed(0)}/${(st.toInjectBytes / 1048576).toFixed(0)} MB`;
    const score = st.ready ? await teal().catch(() => -1) : -1;
    console.log(`  t+${el}s inject=${inj} ready=${st.ready} desktop=${score >= 0 ? score.toFixed(2) : "-"} chromiumRSS=${rssMB()}MB`);
    if (score > 0.25) { booted = true; await shot("ra2-desktop"); break; }
}
const out = await page.evaluate(() => window.stdoutText()).catch(() => "");
writeFileSync("out/ra2-stdout.txt", out);
console.log("=== pre-boot directory listing ===");
console.log(out.split("\n").filter((l) => /Directory of|MIX|EXE|INI|File\(s\)|Drive|convert|FAT|rror/i.test(l)).slice(0, 25).join("\n") || "(nothing matched)");
if (!booted) { console.log("guest did not reach the desktop"); await shot("ra2-noboot"); }
await browser.close();
