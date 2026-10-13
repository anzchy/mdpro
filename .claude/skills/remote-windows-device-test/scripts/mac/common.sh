#!/bin/bash
# Shared settings for the Mac-side wrappers. Override with environment variables.
WIN_HOST="${WIN_HOST:-win-desktop}"                    # ssh alias (see remote-ssh reference/windows-desktop.md)
WIN_DIR="${WIN_DIR:-C:\\Users\\jack\\mdpro-audit}"      # working folder on Windows (scripts, fixtures, shots)
OUT="${MDPRO_WIN_OUT:-${TMPDIR:-/tmp}/mdpro-win-out}"   # where screenshots / pulled files land on the Mac
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$OUT"
# One ssh call; on a transport failure (exit 255, e.g. "Connection reset") retry once.
win() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$WIN_HOST" "$@"; local r=$?
  if [ $r -eq 255 ]; then sleep 2; ssh -o BatchMode=yes -o ConnectTimeout=10 "$WIN_HOST" "$@"; r=$?; fi
  return $r
}
# Fail loudly on empty output: an empty result is a transport problem, never an answer.
need() { [ -n "$1" ] || { echo "NO OUTPUT from $WIN_HOST (ssh failed? run: ssh $WIN_HOST hostname)" >&2; exit 1; }; }
