#!/usr/bin/env bash
# Assemble a MIX_DIR for @chronodivide/game-api out of a Steam depot download.
#
# You must own Red Alert 2 (Steam app 2229850). This script ships no game assets; it only
# links files you already downloaded. Get the depots from the Steam client console
# (open steam://open/console, or launch Steam with -console):
#
#   download_depot 2229850 2229851 4928885831751969588   # base game, Windows, ~1.9 GB
#   download_depot 2229850 2229852 2191822715159570153   # English,           ~1.2 GB
#   download_depot 2229850 2229855 126987739780522527    # Traditional Chinese
#
# The Steam release has no Simplified Chinese depot, and the Traditional Chinese pack is
# subtitles only: the voice-over stays English.
#
# Usage: tools/make-mix-dir.sh [CONTENT_DIR] [OUT_DIR]
#   LANG_DEPOT=2229855 tools/make-mix-dir.sh    # build with Traditional Chinese instead
set -euo pipefail

DEFAULT_CONTENT="$HOME/Library/Application Support/Steam/Steam.AppBundle/Steam/Contents/MacOS/steamapps/content/app_2229850"
CONTENT="${1:-$DEFAULT_CONTENT}"
OUT="${2:-$HOME/ra2-mix}"
BASE_DEPOT="${BASE_DEPOT:-2229851}"
LANG_DEPOT="${LANG_DEPOT:-2229852}"

# On macOS the client writes depots under its own app bundle rather than the Steam library, and the
# path it prints in console_log.txt mixes forward and back slashes -- that is a display bug, the
# directories on disk use forward slashes throughout.
[ -d "$CONTENT/depot_$BASE_DEPOT" ] || { echo "base depot not found: $CONTENT/depot_$BASE_DEPOT" >&2; exit 1; }
[ -d "$CONTENT/depot_$LANG_DEPOT" ] || { echo "language depot not found: $CONTENT/depot_$LANG_DEPOT" >&2; exit 1; }

rm -rf "$OUT"; mkdir -p "$OUT"

# Hard links, not symlinks. The engine's file layer rejects symlinks with
# `IOError: File "language.mix" could not be read (TypeMismatchError)`.
# Hard links are real directory entries and cost no extra space, but they require the output
# directory to sit on the same filesystem as the depots.
find "$CONTENT/depot_$BASE_DEPOT" -maxdepth 1 -type f -exec ln {} "$OUT"/ \;
for f in language.mix langmd.mix; do
    [ -f "$CONTENT/depot_$LANG_DEPOT/$f" ] || continue
    rm -f "$OUT/$f"; ln "$CONTENT/depot_$LANG_DEPOT/$f" "$OUT/$f"
done

# Small subdirectories the release ships alongside the archives. The online-play components live in
# one of them, and the game registers and initialises those at startup, so a flat copy of the
# top-level files alone is not a complete install.
for sub in Internet RMCache Taunts; do
    [ -d "$CONTENT/depot_$BASE_DEPOT/$sub" ] || continue
    mkdir -p "$OUT/$sub"
    find "$CONTENT/depot_$BASE_DEPOT/$sub" -maxdepth 1 -type f -exec ln {} "$OUT/$sub"/ \;
done

echo "MIX_DIR ready: $OUT"
echo "  files:    $(ls -1 "$OUT" | wc -l | tr -d ' ')"
echo "  language: depot_$LANG_DEPOT"
echo "Verify with: MIX_DIR=$OUT node tools/engine-smoke.mjs"
