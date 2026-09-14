#!/usr/bin/env bash
# Talk to a QEMU guest over its monitor socket: screenshots, keys, pointer.
#
# The guest normally runs on another host; VM_HOST=local talks to an in-container guest directly.
# Configure it with:
#   VM_HOST   user@host of the machine running QEMU, or "local" inside its container
#   VM_DIR    directory on that machine holding the disk images and monitor sockets
#   VM_SSH    optional extra ssh options
# Authentication is whatever your ssh setup provides -- use a key, not a password.
set -u
: "${VM_HOST:?set VM_HOST, e.g. user@192.0.2.10}"
: "${VM_DIR:=\$HOME/ra2vm}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${ARENA_OUT:-$HERE/out}"; mkdir -p "$OUT"

rsh() {
  if [ "$VM_HOST" = local ]; then bash -c "$*"
  else ssh -o StrictHostKeyChecking=accept-new ${VM_SSH:-} "$VM_HOST" "$@"
  fi
}
fetch() {
  if [ "$VM_HOST" = local ]; then cp "$1" "$2"
  else scp -o StrictHostKeyChecking=accept-new ${VM_SSH:-} "$VM_HOST:$1" "$2"
  fi
}
mon() { rsh "printf '%s\n' '$1' | nc -U $VM_DIR/$2.mon >/dev/null 2>&1"; }

# shot <guest> <label> -- fetch one frame as PNG.
# Deletes both copies first and fails loudly if either step fails. An earlier version sent scp's
# errors to /dev/null and converted whatever local file happened to exist, so a failed copy silently
# re-rendered the PREVIOUS frame -- a "frozen screen" that survived even a reset and sent us hunting
# a guest hang that was not happening.
shot() {
  local g="$1" label="${2:-shot}"
  local ppm="$OUT/$g.ppm"
  rm -f "$ppm"
  rsh "rm -f $VM_DIR/$g.ppm"
  mon "screendump $VM_DIR/$g.ppm" "$g"
  sleep 2
  fetch "$VM_DIR/$g.ppm" "$ppm" || {
    echo "shot: transfer failed -- refusing to reuse the previous frame" >&2; return 1; }
  [ -s "$ppm" ] || { echo "shot: empty frame" >&2; return 1; }
  python3 "$HERE/ppm2png.py" "$ppm" "$OUT/$label.png"
}

key()  { mon "sendkey $2" "$1"; }
kseq() { local g="$1"; shift; for k in "$@"; do mon "sendkey $k" "$g"; sleep 0.25; done; }

# point <guest> <x> <y> [click|rclick] -- position the PS/2 pointer, in pixels.
#
# Two things make this work, and it is wrong without either. Guest pointer acceleration must be OFF
# (on Windows set HKCU\Control Panel\Mouse MouseSpeed/MouseThreshold1/2 to "0"), otherwise relative
# motion is non-linear and lands nowhere near the target. And the USB tablet must be ABSENT: a
# fullscreen DirectInput game reads the PS/2 device directly, so when a tablet is present and owns
# the pointer the game never sees the motion. Pinning into the top-left corner first clamps the
# origin; steps stay small because large per-packet deltas are not tracked faithfully.
point() {
  local g="$1" x="$2" y="$3" do="${4:-}" step="${STEP:-40}" cmd=""
  add() { cmd="${cmd}printf '$1\n' | nc -U $VM_DIR/$g.mon >/dev/null 2>&1; sleep ${DLY:-0.06}; "; }
  add "mouse_set 2"
  for _ in $(seq 1 20); do add "mouse_move -60 -60"; done
  local n=$x; while [ "$n" -gt 0 ]; do local d=$n; [ "$d" -gt "$step" ] && d=$step; add "mouse_move $d 0"; n=$((n-d)); done
  n=$y;       while [ "$n" -gt 0 ]; do local d=$n; [ "$d" -gt "$step" ] && d=$step; add "mouse_move 0 $d"; n=$((n-d)); done
  case "$do" in
    click)  add "mouse_button 1"; add "mouse_move 1 0"; add "mouse_button 0" ;;
    rclick) add "mouse_button 2"; add "mouse_button 0" ;;
  esac
  rsh "$cmd"
}

"$@"
