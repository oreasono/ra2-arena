// Import RA2 assets into one client profile from the local asset server, then report the next screen.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const profile = process.env.PROFILE ?? "./profiles/p0";
const url = process.env.ASSET_URL ?? "http://127.0.0.1:8124/ra2-assets.zip";
const IMPORT_SCREEN = "Locate original game assets";

const ctx = await chromium.launchPersistentContext(profile, {
    headless: false, viewport: null,
    args: ["--window-position=0,25", "--window-size=1280,860",
           // The client is served over https; the asset URL is a local http server. Chrome would
           // otherwise auto-upgrade or block that request, silently, with no console message.
           "--allow-running-insecure-content", "--ignore-certificate-errors"],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 250)}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${String(e).slice(0, 250)}`));
page.on("request", (r) => { if (r.url().includes("8124")) logs.push(`[req] ${r.method()} ${r.url()}`); });
// Requests made from workers do not surface on the page; watch the context too.
ctx.on("request", (r) => { if (r.url().includes("8124")) logs.push(`[ctx-req] ${r.method()} ${r.url()}`); });
page.on("requestfailed", (r) => logs.push(`[reqfail] ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.url().includes("8124")) logs.push(`[resp] ${r.status()} ${r.url()}`); });

const fullText = () => page.evaluate(() => document.body.innerText);
const onImportScreen = async () => (await fullText()).includes(IMPORT_SCREEN);

await page.goto("https://game.chronodivide.com/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

if (await onImportScreen()) {
    console.log("import screen present; filling URL");
    const input = page.locator('input[type="url"]');
    await input.fill(url);
    console.log("  input value now:", await input.inputValue());
    const btn = page.locator("text=Download").first();
    console.log("  Download button visible:", await btn.isVisible());
    await btn.click();
    console.log("  clicked Download");
    for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(5000);
        const t = (await fullText()).replace(/\s+/g, " ");
        // Progress text replaces the import prompt; report the tail, which is where status appears.
        console.log(`  t+${(i + 1) * 5}s: ${t.slice(-160)}`);
        if (!t.includes(IMPORT_SCREEN)) { console.log("  >> import screen gone"); break; }
    }
} else console.log("assets already imported in this profile");

await page.waitForTimeout(8000);
const info = await page.evaluate(() => ({
    url: location.href,
    text: document.body.innerText.slice(0, 1500),
    buttons: [...document.querySelectorAll("button, a, [role=button]")].map((b) => (b.innerText || "").trim()).filter(Boolean).slice(0, 30),
    inputs: [...document.querySelectorAll("input")].map((i) => ({ type: i.type, placeholder: i.placeholder, visible: !!(i.offsetWidth || i.offsetHeight) })),
    storage: Object.keys(localStorage),
}));
console.log("=== screen now ==="); console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: "out/after-import.png" });
writeFileSync("out/import-console.txt", logs.join("\n"));
console.log("=== browser log (asset requests + errors) ===");
console.log(logs.filter((l) => /req|resp|error|fail|8124/i.test(l)).slice(0, 25).join("\n") || "(none)");
await ctx.close();
