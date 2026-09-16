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
mkdir -p "$WORK_DIR/disc" "$WORK_DIR/cabs" "$WORK_DIR/content/depot_2229851" "$WORK_DIR/content/depot_2229852"
bsdtar -xf "$ISO" -C "$WORK_DIR/disc"

cab_ok=0
while IFS= read -r -d '' cab; do
    out="$WORK_DIR/cabs/$cab_ok"; mkdir -p "$out"
    if cabextract -q -L -d "$out" "$cab"; then cab_ok=$((cab_ok + 1)); else rm -rf "$out"; fi
done < <(find "$WORK_DIR/disc" -type f -iname '*.cab' -print0)
[ "$cab_ok" -gt 0 ] || { echo "no extractable cabinet found in $ISO" >&2; exit 1; }

asset_count=0
while IFS= read -r -d '' asset; do
    name="$(basename "$asset")"; lower="${name,,}"
    case "$lower" in
        language.mix|langmd.mix) target="$WORK_DIR/content/depot_2229852" ;;
        *) target="$WORK_DIR/content/depot_2229851" ;;
    esac
    [ -e "$target/$lower" ] || cp -f "$asset" "$target/$lower"
    asset_count=$((asset_count + 1))
done < <(find "$WORK_DIR/disc" "$WORK_DIR/cabs" -type f \( -iname '*.mix' -o -iname '*.map' \) -print0)

# Preserve the small directories that the repository's assembler knows to include.
for sub in Internet RMCache Taunts; do
    while IFS= read -r -d '' asset; do
        rel="${asset#*/$sub/}"
        mkdir -p "$WORK_DIR/content/depot_2229851/$sub/$(dirname "$rel")"
        cp -f "$asset" "$WORK_DIR/content/depot_2229851/$sub/$rel"
    done < <(find "$WORK_DIR/disc" "$WORK_DIR/cabs" -type f -path "*/$sub/*" -print0)
done

[ -s "$WORK_DIR/content/depot_2229851/ra2.mix" ] || { echo "required asset missing after extraction: ra2.mix" >&2; exit 1; }
[ -s "$WORK_DIR/content/depot_2229852/language.mix" ] || { echo "required asset missing after extraction: language.mix" >&2; exit 1; }
LANG_DEPOT=2229852 /app/tools/make-mix-dir.sh "$WORK_DIR/content" "$MIX_DIR"
echo "MIX_DIR ready from retail ISO: $asset_count archives/files"
exec node /app/tools/engine-serve.mjs
