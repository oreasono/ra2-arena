// Open one Chrono Divide client with a persistent profile and report what the entry flow needs.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const profile = process.env.PROFILE ?? "./profiles/p0";
const ctx = await chromium.launchPersistentContext(profile, {
    headless: false, viewport: null,
    args: ["--window-position=0,25", "--window-size=1280,860"],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${String(e).slice(0, 200)}`));

await page.goto("https://game.chronodivide.com/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);

const info = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll("input")].map((i) => ({
        type: i.type, accept: i.accept, id: i.id, name: i.name,
        webkitdirectory: i.webkitdirectory, placeholder: i.placeholder,
        visible: !!(i.offsetWidth || i.offsetHeight),
    }));
    const buttons = [...document.querySelectorAll("button, a, [role=button]")]
        .map((b) => (b.innerText || b.textContent || "").trim()).filter(Boolean).slice(0, 40);
    return { title: document.title, url: location.href, inputs, buttons,
             text: document.body.innerText.slice(0, 1200),
             storage: Object.keys(localStorage) };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: "out/explore.png" });
writeFileSync("out/explore-console.txt", logs.join("\n"));
console.log("--- console ---"); console.log(logs.slice(0, 20).join("\n"));
await ctx.close();
