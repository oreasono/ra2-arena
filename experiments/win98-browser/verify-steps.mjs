// Every guest step gets its own screenshot, named in order. Three times in this spike a step was
// assumed to have worked and had not, so nothing here reports success on its own: the evidence is
// the image sequence, reviewed afterwards.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const B = String.fromCharCode(92);
const GAME = `D:${B}RA2`;
const EXE = process.env.EXE ?? "GAMEMD.EXE";
const CD = process.env.CD ?? "";

const browser = await chromium.launch({ headless: false, args: ["--window-position=0,25", "--window-size=1000,780"] });
const page = await browser.newPage({ viewport: null });
let step = 0;
const shot = async (label) => {
    step++;
    const name = `verify-${String(step).padStart(2, "0")}-${label}`;
    try { const p = await page.evaluate(() => window.screenshotPNG());
          writeFileSync(`out/${name}.png`, Buffer.from(p.split(",")[1], "base64"));
          console.log(`     shot: ${name}`); } catch { console.log(`     shot failed: ${name}`); }
};
const teal = () => page.evaluate(async () => {
    const img = await window.ci.screenshot(); const d = img.data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 40 && Math.abs(d[i+1]-128) < 40 && Math.abs(d[i+2]-128) < 40) n++;
    return n / (d.length / 4); });
const SHIFTED = { ":": "Semicolon", "*": "Digit8", ">": "Period", "?": "Slash" };
const typeGuest = async (t) => { for (const ch of t) {
    const k = SHIFTED[ch];
    if (k) { await page.keyboard.down("Shift"); await page.keyboard.press(k); await page.keyboard.up("Shift"); }
    else await page.keyboard.type(ch);
    await page.waitForTimeout(50); } };

// Runs one command and photographs what came back. Returns whether the desktop changed, which is a
// weak signal on its own -- the images are what settle it.
const step_ = async (cmd, label, settle = 9000) => {
    console.log(`  -> ${cmd}`);
    let opened = false;
    for (let a = 0; a < 3 && !opened; a++) {
        const before = await teal();
        await page.evaluate(() => window.clickAt(0.039, 0.973, 1));
        await page.waitForTimeout(2500);
        if (await teal() < before - 0.02) opened = true;
        else { await page.keyboard.press("Escape"); await page.waitForTimeout(1500); }
    }
    if (!opened) { console.log("     START MENU DID NOT OPEN"); await shot(`${label}-nomenu`); return false; }
    await page.keyboard.press("r"); await page.waitForTimeout(2500);
    await shot(`${label}-rundialog`);
    await typeGuest(cmd); await page.waitForTimeout(600);
    await shot(`${label}-typed`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(settle);
    await shot(`${label}-result`);
    return true;
};

const cdQ = CD ? `&cd=${encodeURIComponent(CD)}` : "";
await page.goto(`http://127.0.0.1:8123/ra2.html?slot=0&manifest=/game-manifest.json&ro=0${cdQ}`);
for (let i = 0; i < 48; i++) {
    await page.waitForTimeout(10000);
    const st = await page.evaluate(() => window.state).catch(() => null);
    const s = st?.ready ? await teal().catch(() => -1) : -1;
    console.log(`  t+${(i+1)*10}s injected=${st?.injected ?? "?"} desktop=${s >= 0 ? s.toFixed(2) : "-"}`);
    if (s > 0.25) break;
}
await page.locator("canvas").click({ position: { x: 400, y: 300 } }).catch(() => {});
await page.waitForTimeout(1000);
await shot("desktop");

// What is actually on the game drive, before touching anything.
await step_(`command.com /k dir ${GAME}${B}Internet`, "list-internet", 12000);
await page.keyboard.press("Enter");

await step_(`regedit ${GAME}${B}install.reg`, "regedit", 8000);
await page.keyboard.press("Enter"); await page.waitForTimeout(5000);
await shot("regedit-confirmed");
await page.keyboard.press("Enter"); await page.waitForTimeout(3000);

for (const [dll, label] of [["Blowfish.dll", "reg-blowfish"],
                            [`Internet${B}Wolapi.dll`, "reg-wolapi"],
                            [`Internet${B}WOLBrowser.dll`, "reg-wolbrowser"]]) {
    await step_(`regsvr32 ${GAME}${B}${dll}`, label, 11000);
    await page.keyboard.press("Enter"); await page.waitForTimeout(3000);
}

await step_(`${GAME}${B}${EXE}`, "launch", 30000);
await page.waitForTimeout(45000);
await shot("launch-late");
console.log("done; review the numbered screenshots in out/");
await browser.close();
