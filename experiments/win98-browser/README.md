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

## Getting files into the guest — works

Proven end to end on 2026-09-11: files injected from the host appear inside Windows 98 as a
read-only drive. `check-drive.mjs` boots the guest, opens My Computer and opens that drive; the
screenshots it writes to `out/` show the injected folder and file on `D:`, alongside the OS image
on `C:`.

The chain is:

1. `initFs` puts `{ path, contents }` entries into the emulated filesystem before boot. The page
   loads them from a JSON payload of base64 blobs, so what gets injected is a runtime choice rather
   than something baked into a bundle.
2. The DOSBox-X autoexec mounts that as a folder (`mount d .`) and mounts the OS image over
   sockdrive.
3. `boot c: -convertfatro` converts every folder mount into an emulated FAT hard disk as the guest
   boots, read-only, so several instances can share one game disk without fighting over writes.

Two notes for whoever repeats this:

- **Guest interaction goes through the emulator, not the page.** `ci.sendMouseMotion` takes
  coordinates normalised to the emulated screen, so they survive whatever scaling the browser
  applies to the canvas. Double-click was unreliable for opening desktop icons; selecting the icon
  and pressing Enter worked every time.
- **A still frame counter does not mean the guest is stuck.** An idle Windows desktop renders almost
  nothing, and reading a stalled counter as a hang sent this spike down a wrong path once.

## Running the game — launches, does not initialise

The full game reaches the guest: 125 files, 808 MB, listed by the emulator itself under `D:\RA2`
with long filenames intact and 2 GB free on the converted disk. `launch-game.mjs` boots the guest
with a writable copy, imports registry keys, registers the game's Blowfish component and starts the
executable through Start > Run.

The executable runs. It takes over the display at 800x600 and puts up its own dialog: *Failed to
initialize. Please reinstall.* So the binary loads and gets far enough to report an error of its
own, which is a different and much better failure than not starting.

Five explanations were tested and none of them is the cause:

| Hypothesis | Test | Result |
|---|---|---|
| Blowfish component not registered | `regsvr32` in the guest | Succeeded, game still fails |
| Missing installer registry keys | Injected and imported a `.reg` with both install paths | Still fails |
| Shipped DirectDraw shim shadows the system one | Excluded it from the payload | Still fails |
| Hand-picked file subset was incomplete | Injected all 125 shipped files instead of 20 | Still fails |
| Binary too new for this Windows | Read the PE header: requires OS 4.0, subsystem 4.0 | Compatible; eliminated |

Top remaining candidate: the working directory. The game loads its archives relative to wherever it
was started from, and launching by full path from the Run dialog does not necessarily set that to
the game's own folder. The next test is a batch file that changes drive and directory first.

Two things worth knowing before repeating any of this:

- **Shift does not cross into the guest.** A typed `:` arrives as `;`, which turned a path into
  `d;\ra2\gamemd.exe`. Send shifted characters as explicit down/up pairs.
- **Ctrl+Esc never reaches the guest** either; the browser keeps it. Click the Start button using
  emulator-normalised coordinates instead. Plain letters do get through.

Still open: the initialisation failure above (roughly 650 MB once cutscenes are dropped, versus 56 bytes for
the probe), and whether the guest's own IPX/SPX stack can talk between instances. The emulator does
have an NE2000 card compiled in (`NE2000_Poller`, `ethernet_frame` appear in the build's symbols),
which is the hardware that stack needs; the IPX proven in the table above is the DOS-level driver,
a different path from what a Windows game uses.

The sockdrive image format was also decoded, in case serving our own disk becomes necessary:
`sockdrive.metaj` is Brotli-compressed JSON describing a plain CHS disk (520 cylinders, 128 heads,
63 sectors of 512 bytes for the 2 GB image) split into `range_count` chunks of `ahead_read` bytes.
Chunk retrieval is not a simple index under that path, so a custom image would still need protocol
work. The route above avoids needing it.

The public Windows 98 image is read-only for anonymous users, so the game cannot be installed into
it directly, which is what sent this route through injection instead. The findings behind it:

- **js-dos can inject arbitrary files** into the emulated filesystem before boot, via the player's
  `initFs` option, which takes `{ path, contents }` entries.
- **DOSBox-X can hand a folder mount to a booted guest.** `boot c: -convertfat` converts every folder
  mount into an emulated FAT hard disk at boot time, which is exactly the case this feature was added
  for. `-convertfatro` makes it read-only, so several instances can share one game disk with no write
  conflicts. FAT16 is chosen when files plus 250 MiB stay under 2 GiB, FAT32 otherwise; Windows 98
  handles both. You cannot boot from such a disk, which is fine: the OS still boots from the image.
- **The emulator has an NE2000 network card compiled in** (`NE2000_Poller`, `ethernet_frame` appear in
  the build's symbols). That matters because the guest's own IPX/SPX stack needs a NIC to bind to.
  The IPX proven in the table above is the DOS-level driver, which is a different path from what a
  Windows game uses.



## Notes

- The public Windows 98 image is provided by js-dos for read access; writes by anonymous users are
  forked locally. Installing a game into it means either persisting the local fork or building our
  own image. Nothing from the image is stored in this repository.
- The Win98 desktop detector is a pixel heuristic (fraction of teal pixels), good enough to drive
  automatic reboots.
