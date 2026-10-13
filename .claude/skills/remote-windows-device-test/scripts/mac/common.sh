#!/bin/bash
# Shared settings and guards for the Mac-side wrappers. Override settings with environment variables.
WIN_HOST="${WIN_HOST:-win-desktop}"                    # ssh alias (see remote-ssh reference/windows-desktop.md)
WIN_DIR="${WIN_DIR:-C:\\Users\\jack\\mdpro-audit}"      # working folder on Windows (scripts, fixtures, shots)
OUT="${MDPRO_WIN_OUT:-${TMPDIR:-/tmp}/mdpro-win-out}"   # where screenshots / pulled files land on the Mac
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Every value interpolated into a remote PowerShell command goes through psq (inside '...')
# and one of the validators: a ' in a value would otherwise end the string and run the rest.
psq() { printf '%s' "${1//\'/\'\'}"; }
# Patterns live in variables: /bin/bash 3.2 treats backslashes inside a literal [[ =~ ]] bracket differently.
RE_WINPATH='^[A-Za-z]:\\[^"'"'"'`$]*$'     # C:\… with no quote, backtick or $ anywhere
RE_NAME='^[A-Za-z0-9._-]+$'
check_winpath() { [[ $1 =~ $RE_WINPATH ]] || { echo "refusing Windows path: $1" >&2; exit 2; }; }
check_name() { [[ $1 =~ $RE_NAME && $1 != .* ]] || { echo "refusing file name: $1" >&2; exit 2; }; }
check_winpath "$WIN_DIR"
mkdir -p "$OUT"

# One ssh call; on a transport failure (exit 255, e.g. "Connection reset") retry once.
win() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$WIN_HOST" "$@"; local r=$?
  if [ $r -eq 255 ]; then sleep 2; ssh -o BatchMode=yes -o ConnectTimeout=10 "$WIN_HOST" "$@"; r=$?; fi
  return $r
}
# Fail loudly on empty output: an empty result is a transport problem, never an answer.
need() { [ -n "$1" ] || { echo "NO OUTPUT from $WIN_HOST (ssh failed? run: ssh $WIN_HOST hostname)" >&2; exit 1; }; }
WD="$(psq "$WIN_DIR")"   # WIN_DIR ready for use inside '...'
