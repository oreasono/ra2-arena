// Import RA2 assets into one client profile from the local asset server.
//
// Two things this has to get right, both learned the hard way:
//  - The URL field is a controlled component. Setting .value programmatically leaves the app's own
//    state on its default, so it submits the wrong URL. Type real keystrokes instead.
//  - The client is served over https. A plain http asset URL produces no request at all, with no
//    console message, so the asset server must speak https (self-signed is fine with
//    --ignore-certificate-errors).
// Ground truth for "did it work" is the asset server log, not the page text.
import { chromium } from "playwright";

const profile = process.env.PROFILE ?? "./profiles/p0";
const url = process.env.ASSET_URL ?? "https://127.0.0.1:8125/ra2-assets.zip";
const IMPORT_SCREEN = "Locate original game assets";

const ctx = await chromium.launchPersistentContext(profile, {
    headless: false, viewport: null, ignoreHTTPSErrors: true,
    args: ["--window-position=0,25", "--window-size=1280,860", "--ignore-certificate-errors"],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
page.on("console", (m) => { if (m.type() !== "info") console.log(`  [${m.type()}] ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`));

const fullText = () => page.evaluate(() => document.body.innerText);

await page.goto("https://game.chronodivide.com/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);

if ((await fullText()).includes(IMPORT_SCREEN)) {
    const input = page.locator('input[type="url"]');
    await input.click();
    await page.keyboard.press("Meta+A");
    await page.keyboard.press("Backspace");
    await input.pressSequentially(url, { delay: 12 });   // real key events, so app state updates
    console.log("typed URL, field now:", await input.inputValue());
    await page.locator('button:has-text("Download")').click();
    console.log("clicked Download");

    // The import screen clears long before the download starts; "Preparing for import..." comes
    // first, then the transfer, then extraction. Wait for the game itself (a canvas) to appear.
    for (let i = 0; i < 120; i++) {
        await page.waitForTimeout(10000);
        const t = (await fullText()).replace(/\s+/g, " ");
        const status = t.replace(/© 2000 ELECTRONIC.*/i, "").trim().slice(0, 120);
        const hasCanvas = await page.evaluate(() => !!document.querySelector("canvas"));
        console.log(`  t+${(i + 1) * 10}s canvas=${hasCanvas} :: ${status || "(no status text)"}`);
        if (hasCanvas) { console.log("  >> game canvas present"); break; }
    }
} else console.log("assets already present in this profile");

await page.waitForTimeout(5000);
const info = await page.evaluate(() => ({
    text: document.body.innerText.slice(0, 900),
    buttons: [...document.querySelectorAll("button,a,[role=button]")].map((b) => (b.innerText || "").trim()).filter(Boolean).slice(0, 25),
    inputs: [...document.querySelectorAll("input")].map((i) => ({ type: i.type, placeholder: i.placeholder })),
    storage: Object.keys(localStorage),
    canvas: !!document.querySelector("canvas"),
}));
console.log("=== screen now ==="); console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: "out/after-import.png" });
await ctx.close();
