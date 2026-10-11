#!/bin/sh
# Purpose: Device drag driver wrapper (D113). Posts a real CGEvent drag
# (leftMouseDown → leftMouseDragged × N → leftMouseUp) so WebKit starts a drag
# session, which computer-use's plain mouse-moved events never do.
#
#   drag.sh install                                   compile the executor (harness, over ssh)
#   drag.sh x1 y1 x2 y2 [--copy] [--steps N] [...]    run one drag (dtrack's own terminal)
#
# Key decisions:
# - Only `install` compiles. The drag path never runs swiftc: a stale or
#   missing executor exits 3 so a device run never compiles mid-run.
# - The plan is captured from drag.mjs before the executor starts, so a parse
#   error (exit 64) never posts a partial plan.
# - The executor's exit status is the script's (2 = no Accessibility grant).
#
# Exit codes: 0 ok, 1 malformed plan, 2 no Accessibility, 3 executor missing
# or stale, 64 bad arguments (incl. a plan over the 30 s cap, D133), 129/130/143
# executor interrupted by SIGHUP/SIGINT/SIGTERM after releasing the button and
# Option; install exits with swiftc's status on failure.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SRC="$DIR/drag.swift"
BIN_DIR="${MDPRO_DRAG_BIN_DIR:-$HOME/.mdpro-redesign/dtrack/tools}"
BIN="$BIN_DIR/drag-bin"

if [ "${1:-}" = "install" ]; then
  mkdir -p "$BIN_DIR"
  swiftc -O -o "$BIN" "$SRC"
  HASH=$(shasum -a 256 "$BIN" | awk '{print $1}')
  echo "drag: installed $BIN sha256 $HASH"
  exit 0
fi

# --- drag path: nothing below this line compiles ---
if [ ! -x "$BIN" ] || [ -n "$(find "$SRC" -newer "$BIN")" ]; then
  echo "drag: executor missing or stale at $BIN; run 'drag.sh install' first (not during a device run)" >&2
  exit 3
fi

PLAN=$(node "$DIR/drag.mjs" "$@") || exit $?
printf '%s\n' "$PLAN" | "$BIN"
