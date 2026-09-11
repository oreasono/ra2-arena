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

Since then two more were ruled out:

| Hypothesis | Test | Result |
|---|---|---|
| Wrong working directory | Injected a batch file that changes drive and directory first | Still fails |
| Missing archives the binary names | Searched all three depots: no separate audio archive exists, and the language depot is fully covered | Not the cause |

A fourth round added two more, and corrected one:

| Hypothesis | Test | Result |
|---|---|---|
| The release is DRM-wrapped and needs a store client | Read the PE sections: the two launchers carry a wrapper section, the game binaries do not | Explains why the launcher dies with a store error; the game binary itself is clean |
| Missing installer registry keys (retested) | The earlier test never ran. Paths reached the guest with doubled separators and the import failed with a file-open error, while the run looked like it had succeeded. Retried with the confirmation visible: the guest reported the keys were entered | Properly eliminated this time |

**The escaping bug is worth stating plainly**, because it invalidated work that looked done: guest
commands were assembled as escaped string literals, went through several layers of quoting, and
arrived with every separator doubled. Build such paths at runtime instead, e.g. from
`String.fromCharCode(92)`, so no layer of quoting can touch them. And confirm each guest step
reports success rather than assuming a silent switch worked.

The binary's own strings show the dialog stands for several distinct internal failures, among them
rules, CD-ROM access, bootstrap archives and the string table. Which one fires is still unknown, and
guessing has now cost six rounds. The next attempt should read it out of the guest rather than infer
it: `ci.persist()` returns the emulated filesystem's changes to the host, which would expose whatever
the game writes when it gives up.

A fifth round measured the disk rather than guessing about it:

| Hypothesis | Test | Result |
|---|---|---|
| The converted disk cannot serve the large archives | Copied a 195 MB archive to the null device inside the guest | Reads back whole, so not a correctness problem, but it takes 75 s: about **2.6 MB/s** |

A small file copies instantly, so the cost is proportional to size rather than a fixed overhead.
The measurement carries some DOS-box overhead of its own, but it is the rate the game would see for
its own archives, which come to 463 MB between them. That is worth knowing independently of the
initialisation failure: even with the game starting, an emulated disk at this rate is a poor
foundation for four instances playing at once.

A sixth round narrowed it considerably by starting the base game rather than the expansion:

| Observation | What it rules out |
|---|---|
| The base game renders its full splash screen, then fails during loading | Display initialisation works, and the archives are readable: that artwork comes out of them |
| A file written into the game directory from inside the guest reads back and appears in a listing | The disk is genuinely writable, so a game unable to save settings is not the cause |
| The directory holds no report or log file after the failure | The game gives up before it writes anything |

A seventh round closed out the list:

| Hypothesis | Test | Result |
|---|---|---|
| The shipped subdirectories matter, including the online-play components | Injected them, registered those components, pointed the matching registry key at them | Still fails |
| The game wants an optical drive with a disc in it | Built a small ISO and attached it as an emulated CD before boot | Still fails |

**Thirteen explanations tested, thirteen eliminated, and the plumbing is proven at every step**:
files reach the guest, the disk is writable, the display initialises, the archives are readable
(the splash screen is drawn from them), several instances run side by side, and DOS-level IPX
connects between them.

The remaining explanation is the copy of the game itself. This is a modern re-release: its launchers
are DRM-wrapped, it ships a DirectDraw shim written for current Windows, and it carries a store
application id. A build repackaged for present-day Windows may simply not complete startup on
Windows 98, even though its header claims compatibility and its early stages clearly work.

### Retail binaries, and what per-step evidence changed

A retail disc later made it possible to test the original 2001 executables against the same
pipeline. Two things came out of it, both from photographing **every** guest step rather than
assuming the sequence worked -- an assumption that had already produced wrong conclusions twice
here, and did so a third time before this was fixed.

| Step | Outcome |
|---|---|
| Registering the encryption component | Succeeded |
| Registering the online browser component | Succeeded |
| Registering the main online component | **Failed**, `LoadLibrary` error `0x485` |
| Starting the retail executable | Nothing at all: no window, no error, no log |

`0x485` is "a dependent library was not found". Reading the import table settles which one: of its
eight imports, seven are standard, and the eighth is an SNMP library that this Windows does not ship
by default and that is not on the disc either. It belongs to an optional networking component.

The disc's installer configuration also names the volume label it looks for, which an earlier
hand-made probe disc had guessed wrong. Rebuilt with the right label, the game still starts and
exits silently.

That silent exit is the current open question. The likely explanation is the combination being
tested: a 2001 executable against data archives from a modern re-release, which may have been
repackaged. Settling it means installing from the disc's own cabinets, which carry the original
data -- and that needs the base game's disc as well, since this one is an expansion whose installer
requires the parent product.

**The store copy's own failure needs a different copy — an original install predating the re-release.** Until one is
available this track is blocked on the game, not on the emulation. Everything built here would
carry over unchanged.

### Three copies, one outcome

The paragraph above turned out to be wrong about the cause, and the way it was settled is worth
recording: an original retail disc, an installed copy built from it by hand, and a pre-installed
no-CD copy were all tried against the same guest. All three fail. So the copy of the game is not
the variable, and the earlier conclusion was an inference presented as a finding.

**The disc's own installer cannot run here, and the reason is in the binaries.** Both the root
bootstrapper's target and the game's launcher carry a well-known disc-protection wrapper: two extra
PE sections and its signature string. Every one of them dies at the *same* address with the *same*
bytes at the instruction pointer, which is un-decrypted code. That scheme authenticates against
sectors a disc image cannot carry, because the image format stores 2048 bytes per sector and the
check reads what lives outside them. The unprotected binaries in the same folder have ordinary
sections and no signature.

| Binary | Protection | Behaviour in the guest |
|---|---|---|
| Disc installer | Wrapped | Invalid page fault, same address every run |
| Game launcher | Wrapped | Invalid page fault, same address |
| Game executable | None | Starts, exits immediately, writes nothing |
| Multiplayer helper | None | n/a |

**The installer is avoidable.** Its payload is a plain Microsoft cabinet holding the two big
archives; with the loose files beside it and the archives in the disc root, a complete original
install can be assembled on the host and injected like any other file set. That is how the retail
copy was tested at all, and it is a better route than the installer even if the installer worked,
because it is scriptable and repeatable.

**Two configuration faults, both real, neither the cause.**

| Fault | Evidence | Fixed by |
|---|---|---|
| Video memory setting ignored | The guest's own diagnostic reported 2.5 MB | The key belongs in `[dosbox]`, not `[video]`; it then reports 4 MB |
| Desktop is 8-bit, which the game cannot use | Same diagnostic, display page | Switch to 16-bit; it applies without a restart, but does **not** survive a page reload |

**The emulated video stack is not the blocker.** The guest's DirectX diagnostic runs its whole
DirectDraw suite, including exclusive fullscreen mode, and passes every stage. A screenshot taken
during the fullscreen stage shows the emulator in that mode.

**What the silent exit probably is.** The retail executable's own strings include a message about
failing to notify a launcher, alongside a shared-memory mapping call. It expects to be started by
the launcher and to hand back a handle through that mapping. The launcher is the wrapped binary
that cannot run. That fits the observed behaviour exactly: no window, no dialog, no log, and an
immediate clean exit rather than a fault.

**Controls that make the above trustworthy**, because three earlier rounds here drew conclusions
from steps that had silently not happened:

- A stock Windows program launched from the same command prompt opens normally, so the launch path
  works and the game really is exiting on its own.
- A directory listing inside the guest shows every injected file at its original size.
- The registry import was run with its confirmation visible and reported success.
- The crash dialog's detail pane was expanded and read, rather than the failure being summarised
  from the title bar.

**Still untried, and the most promising:** the base image ships a virtual-drive utility whose
protection-emulation feature exists precisely to defeat this scheme. Mounting the disc image inside
Windows through it, rather than attaching it from the emulator, would let the original installer and
launcher run. The guest's system drive has too little free space for the install, but the injected
drive reports 2 GB free and is writable, so the install would have to be directed there.

### It runs

The game starts, reaches its menu, and plays a skirmish in the browser guest.

**The silent exit was the wrong entry point.** Every attempt here had started the game binary
directly. That binary is not the entry point: it expects to be started by the launcher beside it and
to hand a handle back through a shared memory mapping, which is what its own strings say when they
mention failing to notify a launcher. Started through the launcher, it opens normally. Seven rounds
of hypotheses were spent on the environment while the actual fault was one level up, in how it was
being invoked -- and the evidence naming it had been sitting in the binary the whole time.

Four things had to be true at once, and each was false by default:

| Requirement | Default | Note |
|---|---|---|
| Started via the launcher | We ran the game binary | The one that mattered |
| Desktop at 16-bit colour | 8-bit | Applies without a restart, but **does not survive a page reload** |
| A mode the emulated card can set | The copy carried a previous owner's widescreen setting | Its settings file overrides what the card can do |
| Working directory = game folder | Whatever the caller had | Archives are opened by relative path |

The video memory setting also belongs in the emulator's main section rather than its video section;
put where it was, it was silently ignored and the guest ran with 2.5 MB instead of 4 MB.

**Clicks need movement.** A press and release at one point is seen as a hover: the menu highlights
and shows its help text but never activates. Moving the pointer a fraction between press and release
makes it register. This cost several attempts that looked like a broken button.

**LAN is inert, and the reason is the emulator build, not the guest.** The network entry does nothing
because no IPX protocol is bound -- the game hides LAN play when none is. Getting one bound means
the emulated network card, and that card has no usable backend here:

| Check | Result |
|---|---|
| Card compiled into the build | Yes: its init strings, config keys and poller symbol are all present |
| Backends it accepts | Two: a host-capture backend and a user-mode TCP/IP stack |
| Host capture in a browser | Impossible -- there is no host interface to capture |
| User-mode stack linked in | **No.** Its library exports are absent; only the config text that describes it is there |
| Card enabled and probed from DOS | Its packet driver is not registered, so the card did not come up |

The build's own text says the card is disabled when no backend is available, which is what we
observe. The networking js-dos does ship is an IPX tunnel at the DOS level, reached through a relay;
a protected-mode Windows guest runs its own protocol stack against a network adapter and cannot use
it.

**So this architecture runs the game but cannot play it between instances.** That is a property of
the published emulator build, not of the game or of anything above it. Changing it means building
the emulator with a browser-capable Ethernet backend. Everything else on this track -- assembling
the files, injecting them, booting, driving the guest, reaching a running match -- works and is
reusable. `netprobe.mjs` runs the card probe; `?noboot=1` stops before the operating system takes
the machine, so DOS-level questions can be asked at all.

 

Two traps when scripting the guest. Driving the Start menu without checking it opened sends the
following keystrokes to the desktop, where single letters select icons; a diagnostic run opened the
Recycle Bin that way, so the helper now compares the screen before and after clicking and retries.
And the game archives are large enough that the converted disk serving them correctly is itself
worth testing, which is the next hypothesis: read one of the big archives end to end inside the
guest and see whether it comes back whole.

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
