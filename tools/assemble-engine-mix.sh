#!/usr/bin/env bash
# Extract the mounted retail disc into the flat MIX_DIR expected by game-api, then start E1.
set -euo pipefail

ISO="${RA2_ISO:-/opt/ra2-arena/images/ra2full.iso}"
MIX_DIR="${MIX_DIR:-/run/ra2-mix}"
WORK_DIR="${ENGINE_WORK_DIR:-/run/ra2-engine-assets}"
RESULT_DIR="${RESULT_DIR:-/run/engine-results}"

safe_reset() {
    case "$1" in
        /run/*|/tmp/*) rm -rf -- "$1"; mkdir -p "$1" ;;
        *) echo "refusing to reset runtime path: $1" >&2; exit 1 ;;
    esac
}

[ -f "$ISO" ] || { echo "retail ISO not found: $ISO" >&2; exit 1; }
safe_reset "$MIX_DIR"
safe_reset "$WORK_DIR"
safe_reset "$RESULT_DIR"
mkdir -p "$WORK_DIR/disc" "$WORK_DIR/cabs"
bsdtar -xf "$ISO" -C "$WORK_DIR/disc"

cab_ok=0
while IFS= read -r -d '' cab; do
    out="$WORK_DIR/cabs/$cab_ok"; mkdir -p "$out"
    if cabextract -q -L -d "$out" "$cab"; then cab_ok=$((cab_ok + 1)); else rm -rf "$out"; fi
done < <(find "$WORK_DIR/disc" -type f -iname '*.cab' -print0)
[ "$cab_ok" -gt 0 ] || { echo "no extractable cabinet found in $ISO" >&2; exit 1; }

mix_count=0
while IFS= read -r -d '' mix; do
    name="$(basename "$mix")"; name="${name,,}"
    cp -f "$mix" "$MIX_DIR/$name"; mix_count=$((mix_count + 1))
done < <(find "$WORK_DIR/disc" "$WORK_DIR/cabs" -type f -iname '*.mix' -print0)
for required in ra2.mix language.mix; do
    [ -s "$MIX_DIR/$required" ] || { echo "required asset missing after extraction: $required" >&2; exit 1; }
done

echo "MIX_DIR ready from retail ISO: $mix_count archives"
exec node /app/tools/engine-serve.mjs
