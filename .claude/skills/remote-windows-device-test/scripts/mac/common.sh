#!/bin/bash
# Shared settings and guards for the Mac-side wrappers. Override settings with environment variables.
WIN_HOST="${WIN_HOST:-win-desktop}"                    # ssh alias (see remote-ssh reference/windows-desktop.md)
WIN_DIR="${WIN_DIR:-C:\\Users\\jack\\mdpro-audit}"      # working folder on Windows (scripts, fixtures, shots)
OUT="${MDPRO_WIN_OUT:-${TMPDIR:-/tmp}/mdpro-win-out}"   # where screenshots / pulled files land on the Mac
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Every value interpolated into a remote PowerShell command goes through psq (inside '...')
# and one of the validators: a ' in a value would otherwise end the string and run the rest.
# psq: double every ' (the quote char sits in a variable: /bin/bash 3.2 keeps backslashes in a
# literal ${x//\'/\'\'} replacement). Only ever applied after a validator below.
psq() { local q="'"; printf '%s' "${1//$q/$q$q}"; }
# Patterns live in variables: /bin/bash 3.2 treats backslashes inside a literal [[ =~ ]] bracket differently.
RE_WINPATH='^[A-Za-z]:\\[A-Za-z0-9 ._\\-]*$'   # allow-list: C:\ then letters, digits, space . _ \ - only
                                              # (blocks every quote incl. U+2018-201B, $, `, %, &, newline, non-ASCII)
RE_NAME='^[A-Za-z0-9._-]+$'
check_winpath() { [[ $1 =~ $RE_WINPATH && $1 != *..* ]] || { echo "refusing Windows path: $1" >&2; exit 2; }; }
check_name() { [[ $1 =~ $RE_NAME && $1 != .* ]] || { echo "refusing file name: $1" >&2; exit 2; }; }
check_winpath "$WIN_DIR"
mkdir -p "$OUT"

# ssh exits 255 both when it never connected and when the connection dropped after the remote
# command ran, so a 255 says nothing about whether the command happened (D228).
# win: a command that changes state (a keystroke, an eval, an append, a restart). Never retried:
# on 255 it reports an unknown outcome and returns 3; the caller stops, and the state on the PC is
# checked by hand before anything else runs.
win() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$WIN_HOST" "$@"; local r=$?
  if [ $r -eq 255 ]; then
    echo "UNKNOWN OUTCOME: transport lost after send; reconcile state before continuing" >&2
    return 3
  fi
  return $r
}
# win_read: an idempotent read (or an overwrite that is safe to repeat). Retried once on 255.
win_read() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$WIN_HOST" "$@"; local r=$?
  if [ $r -eq 255 ]; then
    sleep "${WIN_RETRY_SLEEP:-2}"; ssh -o BatchMode=yes -o ConnectTimeout=10 "$WIN_HOST" "$@"; r=$?
  fi
  return $r
}
# Fail loudly on empty output: an empty result is a transport problem, never an answer.
need() { [ -n "$1" ] || { echo "NO OUTPUT from $WIN_HOST (ssh failed? run: ssh $WIN_HOST hostname)" >&2; exit 1; }; }
WD="$(psq "$WIN_DIR")"   # WIN_DIR ready for use inside '...'
