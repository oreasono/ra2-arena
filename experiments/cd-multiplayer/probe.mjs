import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const ctx = await chromium.launchPersistentContext(process.env.PROFILE ?? "./profiles/p0", {
    headless: false, viewport: null, args: ["--window-position=0,25", "--window-size=1280,860"],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
const reqs = [];
page.on("request", (r) => reqs.push(`${r.method()} ${r.url().slice(0, 110)}`));
page.on("console", (m) => console.log(`  [${m.type()}] ${m.text().slice(0, 200)}`));
await page.goto("https://game.chronodivide.com/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);

const dom = await page.evaluate(() => {
    const input = document.querySelector('input[type="url"]');
    const root = input?.closest("form") ?? input?.parentElement?.parentElement?.parentElement;
    return { html: (root?.outerHTML ?? "no root").slice(0, 3000), isForm: root?.tagName };
});
console.log("=== container tag:", dom.isForm); console.log(dom.html);
writeFileSync("out/import-dom.html", dom.html);

const btn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button,a,[role=button],div,span")]
        .find((e) => (e.innerText || "").trim() === "Download");
    if (!b) return null;
    return { tag: b.tagName, cls: b.className, disabled: b.disabled ?? null,
             html: b.outerHTML.slice(0, 400), rect: b.getBoundingClientRect().toJSON() };
});
console.log("=== Download element ==="); console.log(JSON.stringify(btn, null, 2));

// Try: fill, then press Enter in the input (many such forms submit on Enter).
reqs.length = 0;
await page.fill('input[type="url"]', "http://127.0.0.1:8124/ra2-assets.zip");
await page.locator('input[type="url"]').press("Enter");
await page.waitForTimeout(4000);
console.log("=== requests after Enter ==="); console.log(reqs.slice(-8).join("\n") || "(none)");

// Try: real mouse click at the element centre.
reqs.length = 0;
if (btn?.rect) {
    await page.mouse.click(btn.rect.x + btn.rect.width / 2, btn.rect.y + btn.rect.height / 2);
    await page.waitForTimeout(5000);
}
console.log("=== requests after coordinate click ==="); console.log(reqs.slice(-8).join("\n") || "(none)");
const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(-200));
console.log("=== page tail ==="); console.log(t);
await page.screenshot({ path: "out/probe.png" });
await ctx.close();
