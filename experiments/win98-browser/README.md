# Spike: Windows 98 in the browser, N instances on one machine

M0 validation of the "Windows 98 track" for Mode B: can one machine run several browser windows,
each a full Windows 98 PC (js-dos = DOSBox-X compiled to WebAssembly), driven programmatically?

Result on 2026-09-09, Apple M4 (10 cores, 16 GB), Chromium via Playwright, 2x2 windows on a 1920x1080 display:

| Check | Outcome |
|---|---|
| Windows 98 boots inside a locally served page | Yes, using js-dos's public `system/win98-v1` image |
| 4 instances side by side | Yes; ~4.8 cores total under load (~1.2 cores per instance), ~4 GB RSS for the four Chromium processes |
| Boot time and reliability, image streamed from the CDN | 100-150 s; 3 failures out of 6 boots ("Windows protection error", "IBM ROM BASIC not implemented") |
| Boot time and reliability, image served from the local disk cache | **15 s, 4 of 4 booted** in one run |
| Per-instance screenshots straight from the emulator | Yes (`ci.screenshot()`), independent of page rendering |
| Input injection | Yes; Playwright keyboard/mouse on the canvas (tooltips appear on hover) |
| IPX host/join between windows (DOSBox-level networking) | Yes; peer ids assigned by the default `net.dos.zone` signaling server, both ready in ~10 s |

Not validated here (needs the game and more work): Red Alert 2 inside the image, and IPX from a
Windows 98 guest (Windows' own IPX/SPX stack over an emulated NIC, not the DOSBox IPX driver).

## Two things that were not obvious

- **CORS.** `br.cdn.dos.zone` only sends `Access-Control-Allow-Origin` to js-dos.com / dos.zone
  origins, so a local page cannot stream the public images directly. The emulator uses any
  non-official `sockdrive` backend URL verbatim and fetches `<url>/sockdrive.metaj` plus chunk
  files under it, so `serve.mjs` proxies `/sd/<owner>/<drive>/...` to the CDN same-origin.
- **Cache the image.** The proxy keeps every chunk on disk (`out/cache/`). All boot failures seen
  so far happened while chunks were streaming from the CDN; with a warm cache boots were fast and
  clean. Treat this as n=1 run of 4 until repeated.

Also: `pathPrefix` must be set explicitly, otherwise js-dos resolves `webrtcnet.mjs` relative to
the page (404) and IPX setup hangs on "Creating server".

## Run it

```bash
npm install                      # Playwright
npx playwright install chromium
node serve.mjs &                 # static page + sockdrive proxy on http://127.0.0.1:8123
N=4 OWNER=system DRIVE_C=win98-v1 HOLD_SECONDS=400 node grid.mjs
```

Environment knobs: `N`, `COLS`, `SCREEN_W`/`SCREEN_H`, `HOLD_SECONDS`, `BOOT_TIMEOUT`,
`MAX_RETRIES`, `DWELL`, `IPX=1` (slot 0 hosts, others join), `DRIVE_C`/`DRIVE_D`/`OWNER`
(js-dos public images are under owner `system`, see https://js-dos.com/system-images.html).
`debug.mjs` opens one slot and dumps console, page text, emulator stdout and screenshots.

Outputs go to `out/` (ignored): per-slot screenshots, `samples.json` with CPU/RSS samples and boot
statistics, and the chunk cache.

## Notes

- The public Windows 98 image is provided by js-dos for read access; writes by anonymous users are
  forked locally. Installing a game into it means either persisting the local fork or building our
  own image. Nothing from the image is stored in this repository.
- The Win98 desktop detector is a pixel heuristic (fraction of teal pixels), good enough to drive
  automatic reboots.
