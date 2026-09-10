// Minimal static server for the spike page plus a same-origin proxy for js-dos sockdrive images.
// Why the proxy: br.cdn.dos.zone only sends CORS headers to js-dos.com / dos.zone origins, so a
// locally served page cannot fetch the public system images directly. The emulator composes the
// drive URL as "<backend>/<owner>/<drive>" and then fetches "<url>/sockdrive.metaj" and chunk files
// under it, so pointing the backend at "/sd" on this server keeps everything same-origin.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream, statSync, readdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("./page/", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 8123);
const CDN = "https://br.cdn.dos.zone/sockdrive-qcow2";
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png" };
let proxied = 0, proxiedBytes = 0, cacheHits = 0;
const CACHE = new URL("./out/cache/", import.meta.url).pathname; mkdirSync(CACHE, { recursive: true });

async function proxy(req, res, path) {
    const m = path.match(/^\/sd\/([^/]+)\/([^/]+)\/(.*)$/);
    if (!m) { res.writeHead(404); res.end("bad sockdrive path"); return; }
    const target = `${CDN}/${m[1]}-${m[2]}/${m[3]}`;
    const headers = {};
    if (req.headers.range) headers.range = req.headers.range;
    // Disk cache keyed by path + range: N instances booting the same image fetch identical chunks.
    const key = createHash("sha1").update(target + "|" + (req.headers.range ?? "")).digest("hex");
    const cf = CACHE + key, cm = cf + ".json";
    if (req.method === "GET" && existsSync(cf) && existsSync(cm)) {
        const meta = JSON.parse(readFileSync(cm, "utf8"));
        cacheHits++;
        res.writeHead(meta.status, { ...meta.headers, "x-cache": "hit" });
        res.end(readFileSync(cf));
        return;
    }
    let up;
    try { up = await fetch(target, { method: req.method, headers }); }
    catch (e) { console.error(`proxy fetch error ${target} ${req.headers.range ?? ""}: ${e}`); res.writeHead(502); res.end(String(e)); return; }
    if (up.status >= 400) console.error(`proxy upstream ${up.status} ${target} ${req.headers.range ?? ""}`);
    const h = { "cache-control": "no-store", "access-control-allow-origin": "*" };
    for (const k of ["content-type", "content-range", "accept-ranges", "etag", "last-modified"]) { const v = up.headers.get(k); if (v) h[k] = v; }
    if (!up.headers.get("content-encoding") && up.headers.get("content-length")) h["content-length"] = up.headers.get("content-length");
    res.writeHead(up.status, h);
    proxied++;
    if (req.method === "HEAD" || !up.body) { res.end(); return; }
    const chunks = [];
    const body = Readable.fromWeb(up.body);
    body.on("data", (c) => { proxiedBytes += c.length; chunks.push(c); });
    body.on("end", () => {
        if (req.method === "GET" && (up.status === 200 || up.status === 206)) {
            try { writeFileSync(cf, Buffer.concat(chunks)); writeFileSync(cm, JSON.stringify({ status: up.status, headers: h })); } catch {}
        }
    });
    body.pipe(res);
}

// Everything the game shipped with, minus the cutscene archives (~1 GB and not needed to play).
// Hand-picking a subset looked reasonable and cost several debugging rounds: the release also
// ships map packs, a type library and an IPX emulation component, and the game will not start
// without them.
const SKIP = /^(movies0[12]\.mix|movmd03\.mix)$/i;
const gameFiles = () => {
    const dir = process.env.GAME_DIR;
    return readdirSync(dir).filter((n) => !SKIP.test(n) && statSync(join(dir, n)).isFile());
};
// Generated, not read from disk: see the /game/install.reg handler.
const GENERATED = [{ name: "install.reg", size: 220 }, { name: "run.bat", size: 40 }, { name: "runmd.bat", size: 42 }];

http.createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (path.startsWith("/sd/")) return proxy(req, res, path);
    if (path === "/game-manifest.json") {
        const dir = process.env.GAME_DIR;
        // ?maxmb=N caps the manifest, smallest files first, for bisecting how much the guest's
        // filesystem will actually accept.
        const cap = Number(new URL(req.url, "http://x").searchParams.get("maxmb") ?? 0) * 1048576;
        // ?exclude=a,b drops files. The shipped ddraw.dll is a compatibility shim for modern
        // Windows and shadows the one Windows 98 already has.
        const drop = new Set((new URL(req.url, "http://x").searchParams.get("exclude") ?? "").split(",").filter(Boolean));
        let all = [];
        for (const name of gameFiles()) {
            if (drop.has(name)) continue;
            try { all.push({ name, size: statSync(join(dir, name)).size }); } catch {}
        }
        const out = [];
        if (cap > 0) {
            let total = 0;
            for (const f of all.sort((a, b) => a.size - b.size)) {
                if (total + f.size > cap) break;
                out.push(f); total += f.size;
            }
        } else out.push(...all);
        out.push(...GENERATED);
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(out));
        return;
    }
    if (path === "/game/run.bat" || path === "/game/runmd.bat") {
        // The game loads its bootstrap archives relative to the working directory, and launching by
        // full path from the Run dialog does not set that to the game's own folder. Its own error
        // strings include "Failed to initialize bootstrap mixfiles!", which is what that looks like.
        const exe = path.endsWith("runmd.bat") ? "gamemd.exe" : "game.exe";
        const bat = ["@echo off", "D:", "cd \\RA2", exe, ""].join("\r\n");
        res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
        res.end(bat);
        return;
    }
    if (path === "/game/install.reg") {
        // Injecting files skips the installer, so the keys it would have written are missing and the
        // game refuses to initialise. Point them at wherever the disk ends up inside the guest.
        const drive = new URL(req.url, "http://x").searchParams.get("drive") ?? "D";
        const dir = new URL(req.url, "http://x").searchParams.get("dir") ?? "RA2";
        const base = `${drive}:\\\\${dir}`;
        const reg = ["REGEDIT4", "",
            "[HKEY_LOCAL_MACHINE\\SOFTWARE\\Westwood\\Red Alert 2]",
            `"InstallPath"="${base}\\\\game.exe"`, "",
            "[HKEY_LOCAL_MACHINE\\SOFTWARE\\Westwood\\Yuri's Revenge]",
            `"InstallPath"="${base}\\\\gamemd.exe"`, ""].join("\r\n");
        res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
        res.end(reg);
        return;
    }
    if (path.startsWith("/game/")) {
        const name = path.slice("/game/".length);
        if (!gameFiles().includes(name)) { res.writeHead(404); res.end("not in manifest"); return; }
        try {
            const full = join(process.env.GAME_DIR, name);
            const st = statSync(full);
            res.writeHead(200, { "content-type": "application/octet-stream", "content-length": st.size, "cache-control": "no-store" });
            createReadStream(full).pipe(res);
        } catch { res.writeHead(404); res.end("missing"); }
        return;
    }
    if (path === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    if (path === "/stats") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ proxied, cacheHits, proxiedMB: Math.round(proxiedBytes / 1048576) })); return; }
    const file = join(root, path === "/" ? "index.html" : path);
    try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
        res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
}).listen(port, "127.0.0.1", () => console.log(`serving ${root} on http://127.0.0.1:${port}/ (sockdrive proxy at /sd)`));
