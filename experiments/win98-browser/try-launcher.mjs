// Try the shipped launcher rather than the game binary directly, and pull the guest's filesystem
// changes back to the host afterwards so the failure can be read rather than guessed at.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const target = process.env.TARGET ?? "D:\\RA2\\RA2MD.EXE";
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
    else await page.keyboard.type(ch);
    await page.waitForTimeout(55); } };
// Verify the Start menu actually opened before typing into it: otherwise the keystrokes land on the
// desktop, where a single letter selects an icon. That mistake opened the Recycle Bin once.
const runCommand = async (cmd) => {
    for (let attempt = 0; attempt < 3; attempt++) {
        const before = await teal();
        await page.evaluate(() => window.clickAt(0.039, 0.973, 1));
        await page.waitForTimeout(2500);
        const after = await teal();
        if (after < before - 0.02) {          // menu covers part of the desktop
            await page.keyboard.press("r");
            await page.waitForTimeout(2500);
            await typeGuest(cmd);
            await page.waitForTimeout(600);
            await page.keyboard.press("Enter");
            return true;
        }
        console.log(`  start menu did not open (attempt ${attempt + 1})`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(1500);
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

console.log("registry + component registration");
await runCommand("regedit /s D:\\\\RA2\\\\install.reg");
await page.waitForTimeout(6000);
await runCommand("regsvr32 /s D:\\\\RA2\\\\Blowfish.dll");
await page.waitForTimeout(8000);

console.log(`launching ${target}`);
const ok = await runCommand(target);
console.log("  launch command issued:", ok);
for (const t of [20, 50, 100]) { await page.waitForTimeout(t === 20 ? 20000 : 30000); await shot(`launcher-t${t}`); }

// Pull whatever the guest wrote back to the host.
try {
    const changes = await page.evaluate(async () => {
        const u8 = await window.ci.persist(true);
        return u8 ? Array.from(u8.slice(0, 4_000_000)) : null;
    });
    if (changes) { writeFileSync("out/guest-changes.bin", Buffer.from(changes));
        console.log(`persisted guest changes: ${changes.length} bytes -> out/guest-changes.bin`); }
    else console.log("persist() returned nothing");
} catch (e) { console.log("persist failed:", String(e).slice(0, 160)); }
await browser.close();
