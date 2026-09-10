// Serve a local archive of RA2 assets to the game client, which imports it from a URL.
// The client is served over https, so this server speaks https too: a plain http URL produces no
// request at all from the page, with no console message. Range requests and CORS are both required.
// Nothing here ships assets -- point ASSETS at your own archive.
import http from "node:http";
import https from "node:https";
import { createReadStream, statSync, readFileSync } from "node:fs";

const file = process.env.ASSETS;
const port = Number(process.env.PORT ?? 8125);
const cert = process.env.CERT, key = process.env.KEY;
if (!file) { console.error("set ASSETS=/path/to/ra2-assets.zip"); process.exit(1); }
const size = statSync(file).size;
let hits = 0;

const handler = (req, res) => {
    const cors = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "range,content-type",
        "access-control-expose-headers": "content-length,content-range,accept-ranges",
        "accept-ranges": "bytes",
        "content-type": "application/zip",
    };
    console.log(`[${++hits}] ${req.method} ${req.url} range=${req.headers.range ?? "-"} origin=${req.headers.origin ?? "-"}`);
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Number(m[2]) : size - 1;
        res.writeHead(206, { ...cors, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
        if (req.method !== "HEAD") createReadStream(file, { start, end }).pipe(res); else res.end();
        return;
    }
    res.writeHead(200, { ...cors, "content-length": size });
    if (req.method !== "HEAD") createReadStream(file).pipe(res); else res.end();
};

const server = cert && key
    ? https.createServer({ cert: readFileSync(cert), key: readFileSync(key) }, handler)
    : http.createServer(handler);
server.on("clientError", (e, sock) => { console.log("clientError:", e.code ?? e.message); sock.destroy(); });
server.listen(port, "127.0.0.1", () =>
    console.log(`serving ${file} (${(size / 1048576).toFixed(0)} MB) on ${cert ? "https" : "http"}://127.0.0.1:${port}/ra2-assets.zip`));
