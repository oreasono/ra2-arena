// Let the game fail, then open a DOS box inside the guest and look at what it left behind.
// Guessing at causes has cost six rounds; this reads the guest's own filesystem instead.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch({ headless: false, args: ["--window-position=0,25", "--window-size=1000,780"] });
const page = await browser.newPage({ viewport: null });
await page.goto("http://127.0.0.1:8123/ra2.html?slot=0&manifest=/game-manifest.json&ro=0");
const shot = async (n) => { try { const p = await page.evaluate(() => window.screenshotPNG());
    writeFileSync(`out/${n}.png`, Buffer.from(p.split(",")[1], "base64")); } catch {} };
const teal = () => page.evaluate(async () => {
    const img = await window.ci.screenshot(); const d = img.data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 40 && Math.abs(d[i+1]-128) < 40 && Math.abs(d[i+2]-128) < 40) n++;
    return n / (d.length / 4); });
const typeGuest = async (t) => { for (const ch of t) {
    if (ch === ":") { await page.keyboard.down("Shift"); await page.keyboard.press("Semicolon"); await page.keyboard.up("Shift"); }
    else if (ch === ">") { await page.keyboard.down("Shift"); await page.keyboard.press("Period"); await page.keyboard.up("Shift"); }
    else await page.keyboard.type(ch);
    await page.waitForTimeout(55); } };
const runCommand = async (cmd, label) => {
    await page.evaluate(() => window.clickAt(0.039, 0.973, 1));
    await page.waitForTimeout(2500);
    await page.keyboard.press("r");
    await page.waitForTimeout(2500);
    await typeGuest(cmd);
    await page.waitForTimeout(600);
    await page.keyboard.press("Enter");
    if (label) await shot(`diag-${label}`);
};

for (let i = 0; i < 48; i++) {
    await page.waitForTimeout(10000);
    const st = await page.evaluate(() => window.state).catch(() => null);
    const s = st?.ready ? await teal().catch(() => -1) : -1;
    console.log(`  t+${(i+1)*10}s injected=${st?.injected ?? "?"} desktop=${s >= 0 ? s.toFixed(2) : "-"}`);
    if (s > 0.25) break;
}
await page.locator("canvas").click({ position: { x: 400, y: 300 } }).catch(() => {});
await page.waitForTimeout(1000);

console.log("registering and launching so the failure happens");
await runCommand("regedit /s D:\\\\RA2\\\\install.reg");
await page.waitForTimeout(6000);
await runCommand("regsvr32 D:\\\\RA2\\\\Blowfish.dll");
await page.waitForTimeout(9000);
await page.keyboard.press("Enter");
await page.waitForTimeout(3000);
await runCommand("D:\\\\RA2\\\\GAMEMD.EXE");
await page.waitForTimeout(60000);
await shot("diag-after-launch");
await page.keyboard.press("Enter");            // dismiss the game's dialog
await page.waitForTimeout(8000);
await shot("diag-dismissed");

console.log("opening a DOS box to inspect what the game wrote");
// Redirect a directory listing, newest first, into a file, then show it in Notepad -- reading a
// scrolled DOS window from a screenshot is unreliable.
await runCommand("command.com /c dir D:\\\\RA2 /o-d /a-d > D:\\\\RA2\\\\LIST.TXT");
await page.waitForTimeout(12000);
await shot("diag-dosbox");
await runCommand("notepad D:\\\\RA2\\\\LIST.TXT", "listing");
await page.waitForTimeout(12000);
await shot("diag-listing");
await browser.close();
