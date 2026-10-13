#!/bin/bash
# push.sh <local file> <windows path> — upload any file in 7 KB base64 chunks and verify it by SHA-256
# (Windows has no rsync and scp is denied; one ssh command line holds about 8 KB).
source "$(dirname "$0")/common.sh"; set -e
src="$1"; check_winpath "$2"; dst="$(psq "$2")"; tmp="$dst.b64"
[ -f "$src" ] || { echo "no such file: $src" >&2; exit 2; }
win "Set-Content -NoNewline -Encoding Ascii -Path '$tmp' -Value ''"
# `|| [ -n "$chunk" ]`: fold does not end its last chunk with a newline, and plain `while read` drops it.
base64 < "$src" | tr -d '\n' | fold -w 7000 | while read -r chunk || [ -n "$chunk" ]; do
  win "Add-Content -NoNewline -Encoding Ascii -Path '$tmp' -Value '$chunk'" </dev/null   # base64: no quotes
done
remote=$(win "[IO.File]::WriteAllBytes('$dst', [Convert]::FromBase64String((Get-Content -Raw '$tmp'))); Remove-Item '$tmp'; (Get-FileHash '$dst' -Algorithm SHA256).Hash.ToLower()" | tr -d '\r\n')
local_h=$(shasum -a 256 "$src" | cut -d' ' -f1)
[ "$remote" = "$local_h" ] && echo "hash ok $(basename "$src")" || { echo "HASH MISMATCH $(basename "$src")" >&2; exit 1; }
