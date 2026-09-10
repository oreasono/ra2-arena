// How much can initFs actually deliver to the guest's filesystem? Inject a capped payload, boot far
// enough for the pre-boot directory listing, and read the byte count the emulator itself reports.
import { chromium } from "playwright";
const caps = (process.env.CAPS ?? "8,64,192,384").split(",").map(Number);
for (const mb of caps) {
    const browser = await chromium.launch({ headless: false, args: ["--window-position=0,25", "--window-size=900,700"] });
    const page = await browser.newPage({ viewport: null });
    await page.goto(`http://127.0.0.1:8123/ra2.html?slot=0&manifest=/game-manifest.json%3Fmaxmb=${mb}&ro=1`);
    let listing = "", st = null;
    for (let i = 0; i < 18; i++) {
        await page.waitForTimeout(5000);
        st = await page.evaluate(() => window.state).catch(() => null);
        const out = await page.evaluate(() => window.stdoutText?.() ?? "").catch(() => "");
        if (/File\(s\)/.test(out)) { listing = out; break; }
    }
    const m = /(\d+)\s+File\(s\)\s+([\d,]+)\s+Bytes/.exec(listing);
    const dirs = (listing.match(/\[[A-Z0-9~]+\]/g) ?? []).filter((d) => !/^\[\.+\]$/.test(d));
    console.log(`cap=${String(mb).padStart(4)}MB  injected=${st?.injected ?? "?"} files ${(((st?.injectedBytes ?? 0) / 1048576)).toFixed(0)}MB` +
        `  ->  guest sees: ${m ? `${m[1]} files, ${m[2]} bytes` : "NO LISTING"}  dirs=${dirs.join("") || "none"}`);
    await browser.close();
}
