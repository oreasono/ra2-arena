# Red Alert 2 multiplayer on a Windows XP guest, driven by a vision model

Two QEMU guests on one virtual Ethernet segment play a LAN match against each other, and a vision
model drives one player by looking at the screen and returning a single action at a time.

This replaces the Windows 98 approach in `../win98-browser`. That one got as far as running the game
and opening the LAN lobby, and then wedged permanently the moment a player created a game — see
"Why not Windows 98" below.

## Layout

| file | what it is |
|---|---|
| `xpvm.sh` | QEMU launcher, runs **on** the VM host. `VM=a ROLE=listen`, `VM=b ROLE=connect`. |
| `vm.sh` | screenshots, keys and pointer over the monitor socket, from your workstation |
| `agent.mjs` | the observe-decide-act loop: screenshot → model → one action → repeat |
| `winnt.sif.example` | unattended XP setup answer file |
| `.env.example` | gateway and host settings |

Bring your own retail game files and Windows media; nothing licensed is committed here.

## Getting a working LAN match

Six things are each necessary. Miss any one and the symptom is silent — the UI looks fine and
nothing happens.

1. **`-vga cirrus`, never `-vga std`.** With `std`, XP's first boot hangs applying display settings:
   the kernel keeps running its idle loop (`sti; hlt`) while the GUI session is dead, so keyboard,
   mouse and even ACPI shutdown are all ignored. It looks exactly like a crashed VM. It is not.
2. **Install NWLink IPX/SPX.** RA2's LAN mode is IPX, and XP does not install IPX by default
   (Windows 98 did). Without it the Network button does nothing at all — no error, no hang, no
   reaction — while every other menu button works. Add it under the adapter's properties →
   Install → Protocol → NWLink IPX/SPX/NetBIOS Compatible.
3. **Turn the firewall off** on the isolated segment: `netsh firewall set opmode disable`.
4. **Disable pointer acceleration** (`HKCU\Control Panel\Mouse` → `MouseSpeed`, `MouseThreshold1`,
   `MouseThreshold2` all `"0"`, then reboot) **and do not attach the USB tablet.** With
   acceleration on, relative motion is non-linear and clicks land nowhere near the target; with a
   tablet attached, it owns the pointer and the fullscreen DirectInput game never sees the motion.
   With both handled, requesting (100,400) lands within about 4 px.
5. **Point RA2 at the physical NIC.** In-game: Options → Network opens an "IPX Options" page whose
   Network Card dropdown defaults to NWLink's *internal virtual* adapter
   (`12 34 cd ef : 00 00 00 00 00 02`). Choose the entry whose node matches the NIC's MAC
   (`00 00 00 00 : 52 54 00 12 35 0X`). Until you do, the lobby opens and looks healthy but **not
   one game packet reaches the wire**, so the other player's game list stays empty.
6. **Give each clone its own identity.** A disk-image clone duplicates every identity the OS and the
   game have written down. Each guest needs a distinct computer name, IP address, RA2 serial
   (`HKLM\SOFTWARE\Westwood\Red Alert 2\Serial`), in-game player name, **and** the adapter chosen in
   step 5 — that dropdown's default value is identical on both clones.

Then: host creates a game → joiner sees it listed → joins → host presses Start → joiner presses the
flashing Accept → host presses Start again → both drop into the same live match.

## Operating the container

The public container surface is read-only: `/status` reports both guests, while `/a.png` and
`/b.png` capture fresh frames. Drive the lobby from the Coolify container terminal with the existing
monitor tool, using the runtime monitor names `xpa` and `xpb`:

```sh
export VM_HOST=local VM_DIR=/run/ra2-arena ARENA_OUT=/run/ra2-arena/screens
VMCTL=/app/experiments/xp-vm/vm.sh
$VMCTL shot xpa before-a
$VMCTL shot xpb before-b
$VMCTL point xpa X Y click       # replace X/Y with coordinates from the latest frame
$VMCTL key xpa ret               # QEMU key names: ret, esc, up, down, and so on
```

Use `shot` after every action and keep the UTC time window for external verification. On `xpa`,
open LAN and create a room; its frame should show the host room. On `xpb`, open LAN, confirm that
room appears, and join it; the next `xpa` frame must show both players. Then send Start on `xpa`,
Accept on `xpb`, and Start on `xpa` again. Final fresh frames from both guests must show the live
match. The same frames are independently available at `/a.png` and `/b.png`.

Healthy status is `{"ok": true, "vms": {"a": true, "b": true}}`. If either QEMU process is not
running, `/status` returns HTTP 503 with that guest set to `false`.

## Why not Windows 98

Recorded so nobody repeats it. On 98, creating a LAN game froze the guest permanently: no redraw,
no input, no packets, for 13 minutes with zero changed pixels. Disassembling the address the CPU
kept landing on showed it writing VGA GC index 9 — the Cirrus **bank-select** register — so the
hang was an outer loop in the display path, not the network. Eliminated first, each with a test:
icount, hardware acceleration, name resolution via HOSTS, an inbound interrupt storm, duplicate RA2
serials, whether a peer was present, and adapter ambiguity. A skirmish game ran fine throughout,
which is what made it clear the fault was specific to what the LAN screen draws.

There was no cheap fix: the targeted remedy is a linear framebuffer, but 98 only boots here with
`acpi=off`, and `acpi=off` means PCI never enumerates, so the video card cannot be changed.

## Running the agent

```
cp .env.example .env      # fill in gateway, key, model, VM host
node agent.mjs xpa 20     # 20 steps against the guest whose monitor socket is xpa.mon
```

Each step logs the action and the model's stated reason, so a match can be read back decision by
decision.

**Known gap:** the action vocabulary has scrolling and radar-minimap clicks, but the model still
loses track of its base when the view drifts, and no end-of-match detection is wired up yet, so a
run does not yet produce a result on its own.
