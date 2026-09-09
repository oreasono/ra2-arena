// Minimal static server for the spike page plus a same-origin proxy for js-dos sockdrive images.
// Why the proxy: br.cdn.dos.zone only sends CORS headers to js-dos.com / dos.zone origins, so a
// locally served page cannot fetch the public system images directly. The emulator composes the
// drive URL as "<backend>/<owner>/<drive>" and then fetches "<url>/sockdrive.metaj" and chunk files
// under it, so pointing the backend at "/sd" on this server keeps everything same-origin.
import http from "node:http";
import { readFile } from "node:fs/promises";
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

http.createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (path.startsWith("/sd/")) return proxy(req, res, path);
    if (path === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    if (path === "/stats") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ proxied, cacheHits, proxiedMB: Math.round(proxiedBytes / 1048576) })); return; }
    const file = join(root, path === "/" ? "index.html" : path);
    try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
        res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
}).listen(port, "127.0.0.1", () => console.log(`serving ${root} on http://127.0.0.1:${port}/ (sockdrive proxy at /sd)`));
