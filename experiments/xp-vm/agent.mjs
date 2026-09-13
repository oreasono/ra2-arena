// Drive one Red Alert 2 player with a vision model.
//
// The retail game has no API. The only channel in is a mouse and a keyboard; the only channel out is
// the framebuffer. So a step is: screenshot -> ask the model for ONE action as JSON -> execute it.
// One action per call is deliberate: it keeps every decision individually reviewable in the match
// log, which is the whole point of running models against each other.
//
// Configure with (see .env.example):
//   MODEL_BASE_URL  OpenAI-compatible endpoint, including /v1
//   MODEL_API_KEY   bearer token
//   MODEL_NAME      model id
//   VM_HOST/VM_DIR  passed through to vm.sh
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VM = join(HERE, "vm.sh");
const OUT = process.env.ARENA_OUT ?? join(HERE, "out");

const BASE = (process.env.MODEL_BASE_URL ?? "").replace(/\/$/, "");
const KEY = process.env.MODEL_API_KEY ?? "";
const NAME = process.env.MODEL_NAME ?? "";
if (!BASE || !KEY || !NAME) throw new Error("set MODEL_BASE_URL, MODEL_API_KEY and MODEL_NAME");

const SYSTEM = `You are playing Command & Conquer: Red Alert 2 as one player in a 1v1 LAN match.
The screen is 640x480. The strip from x=470 rightwards is the sidebar; the map is to the left of it.
The small square near the top of the sidebar is the radar minimap: clicking a point on it jumps the
view there, which is how you find your base again if the view scrolls away.

Return exactly ONE action as JSON and nothing else:
  {"why":"<short reason>","action":"click","x":<0-639>,"y":<0-479>}
  {"why":"...","action":"rclick","x":...,"y":...}     right click: move selected units, or deselect
  {"why":"...","action":"scroll","dir":"up|down|left|right"}   scroll the map view
  {"why":"...","action":"key","key":"<qemu key name, e.g. d, s, g, ret, esc>"}
  {"why":"...","action":"wait"}                        let the game run a few seconds

Opening that works: click your MCV to select it, deploy it (key "d"), then use the sidebar to queue
a Power Plant, then an Ore Refinery, then a Barracks. A finished building flashes in its sidebar
slot: click the slot, then click an empty patch of map to place it.
Economy first. A refinery and more miners raise income; a second barracks does not -- a duplicate
production building only lets you queue faster, which is worthless while you have no money to spend.`;

const sh = (...args) => execFileSync(VM, args, { env: process.env, timeout: 180000 }).toString();

function screenshot(guest, label) {
  sh("shot", guest, label);
  return join(OUT, `${label}.png`);
}

function execute(guest, a) {
  switch (a.action) {
    case "wait": execFileSync("sleep", ["6"]); return "waited";
    case "key": sh("key", guest, String(a.key)); return `key ${a.key}`;
    case "scroll": {
      const k = { up: "up", down: "down", left: "left", right: "right" }[a.dir] ?? "up";
      for (let i = 0; i < 6; i++) sh("key", guest, k);
      return `scroll ${a.dir}`;
    }
    case "click": case "rclick": {
      const x = String(Math.round(a.x)), y = String(Math.round(a.y));
      sh("point", guest, x, y, a.action);
      return `${a.action} ${x},${y}`;
    }
    default: return `ignored unknown action ${a.action}`;
  }
}

async function decide(png, history) {
  const img = readFileSync(png).toString("base64");
  const messages = [{ role: "system", content: SYSTEM }];
  if (history.length) {
    messages.push({ role: "user", content: `Your last actions: ${history.slice(-6).join("; ")}` });
  }
  messages.push({ role: "user", content: [
    { type: "text", text: "Current screen. Return ONE action as JSON." },
    { type: "image_url", image_url: { url: `data:image/png;base64,${img}` } }] });

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: NAME, messages, max_tokens: 300 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = (await res.json()).choices[0].message.content;
  // Models wrap JSON in prose often enough that trimming to the outermost braces is worth it.
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

const [guest, stepsArg] = process.argv.slice(2);
if (!guest) { console.error("usage: agent.mjs <guest-monitor-name> [steps]"); process.exit(2); }
const steps = Number(stepsArg ?? 20);
const history = [];
for (let i = 0; i < steps; i++) {
  const png = screenshot(guest, `agent-${guest}-${String(i).padStart(3, "0")}`);
  let a;
  try { a = await decide(png, history); }
  catch (e) { console.error(`step ${i}: ${e.message}`); break; }
  const done = execute(guest, a);
  const line = `${a.action}(${a.x ?? ""}${a.y !== undefined ? "," + a.y : ""}${a.key ?? ""}${a.dir ?? ""}) -- ${(a.why ?? "").slice(0, 60)}`;
  history.push(line);
  console.log(`step ${i}: ${line}  => ${done}`);
  await new Promise((r) => setTimeout(r, 3000));
}
