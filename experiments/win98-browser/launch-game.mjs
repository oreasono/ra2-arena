// Boot the guest with a writable game disk and start the game through the Start > Run dialog.
// Read-only was right for sharing one disk, but the game writes its own settings, so launching
// needs a writable copy.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const exe = process.env.EXE ?? "D:\\RA2\\GAMEMD.EXE";
const browser = await chromium.launch({ headless: false, args: ["--window-position=0,25", "--window-size=1000,780"] });
const page = await browser.newPage({ viewport: null });
page.on("pageerror", (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`));
const manifestQ = process.env.EXCLUDE ? `%3Fexclude=${encodeURIComponent(process.env.EXCLUDE)}` : "";
await page.goto(`http://127.0.0.1:8123/ra2.html?slot=0&manifest=/game-manifest.json${manifestQ}&ro=0`);

const shot = async (n) => {
    try { const p = await page.evaluate(() => window.screenshotPNG());
          writeFileSync(`out/${n}.png`, Buffer.from(p.split(",")[1], "base64")); } catch {}
};
const teal = () => page.evaluate(async () => {
    const img = await window.ci.screenshot(); const d = img.data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 40 && Math.abs(d[i + 1] - 128) < 40 && Math.abs(d[i + 2] - 128) < 40) n++;
    return n / (d.length / 4);
});

let up = false;
for (let i = 0; i < 48; i++) {
    await page.waitForTimeout(10000);
    const st = await page.evaluate(() => window.state).catch(() => null);
    const score = st?.ready ? await teal().catch(() => -1) : -1;
    console.log(`  t+${(i + 1) * 10}s injected=${st?.injected ?? "?"}/${st?.toInject ?? "?"} ready=${st?.ready} desktop=${score >= 0 ? score.toFixed(2) : "-"}`);
    if (score > 0.25) { up = true; break; }
}
if (!up) { console.log("desktop never appeared"); await shot("launch-noboot"); await browser.close(); process.exit(1); }
await shot("launch-desktop");

// Ctrl+Esc never reaches the guest -- the browser takes it. Click the Start button instead, using
// coordinates normalised to the emulated 640x480 screen. Plain keystrokes do get through: an
// earlier attempt typed a path at the desktop and selected an icon beginning with that letter.
await page.locator("canvas").click({ position: { x: 400, y: 300 } }).catch(() => {});
await page.waitForTimeout(1000);

// The guest does not see the browser's shift state, so a typed ":" arrives as ";" and paths fail
// to resolve. Send shifted characters as explicit down/up pairs.
const typeGuest = async (text) => {
    for (const ch of text) {
        if (ch === ":") {
            await page.keyboard.down("Shift");
            await page.keyboard.press("Semicolon");
            await page.keyboard.up("Shift");
        } else await page.keyboard.type(ch);
        await page.waitForTimeout(55);
    }
};
// Ctrl+Esc never reaches the guest -- the browser takes it. Click Start instead, in coordinates
// normalised to the emulated screen.
const runCommand = async (cmd, label) => {
    await page.evaluate(() => window.clickAt(0.039, 0.973, 1));   // Start
    await page.waitForTimeout(2500);
    await page.keyboard.press("r");                                // Run...
    await page.waitForTimeout(2500);
    await shot(`launch-${label}-dialog`);
    await typeGuest(cmd);
    await page.waitForTimeout(800);
    await page.keyboard.press("Enter");
};

// The game refuses to initialise unless its Blowfish component is registered, which normally
// happens during a real install. Register it first, then dismiss the confirmation.
if (process.env.SKIP_REG !== "1") {
    console.log("importing registry keys");
    await runCommand("regedit /s D:\\\\RA2\\\\install.reg", "regedit");
    await page.waitForTimeout(8000);
    await shot("launch-regedit-done");
}
if (process.env.SKIP_REGSVR !== "1") {
    console.log("registering Blowfish.dll");
    await runCommand("regsvr32 D:\\RA2\\Blowfish.dll", "regsvr");
    await page.waitForTimeout(12000);
    await shot("launch-regsvr-result");
    await page.keyboard.press("Enter");   // dismiss the result dialog
    await page.waitForTimeout(3000);
}

console.log(`launching ${exe}`);
await runCommand(exe, "game");

for (const t of [15, 40, 80, 130]) {
    await page.waitForTimeout(t === 15 ? 15000 : (t === 40 ? 25000 : 40000));
    await shot(`launch-t${t}`);
    console.log(`  screenshot at +${t}s after Enter`);
}
const out = await page.evaluate(() => window.stdoutText?.() ?? "").catch(() => "");
writeFileSync("out/launch-stdout.txt", out);
await browser.close();
