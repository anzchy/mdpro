#!/bin/bash
# pull.sh <windows file> <local name> — copy a (binary) file back into $OUT via base64.
# The Windows path must be C:\… without quotes; the local name is a plain file name (no / or ..).
source "$(dirname "$0")/common.sh"
check_winpath "$1"; check_name "$2"
# Read first, then decode: inside a pipeline a failed read would leave an empty file and exit 0.
b=$(win_read "[Convert]::ToBase64String([IO.File]::ReadAllBytes('$(psq "$1")'))") || exit $?
# Decode into a .part file and print the path only once it is complete: a failed decode or write
# must fail the caller (cdp.sh shot), not leave a broken file behind an exit 0 (audit b163 H3).
f="$OUT/$2"
if ! printf '%s' "$b" | tr -d '\r\n' | base64 --decode > "$f.part" || ! mv "$f.part" "$f"; then
  rm -f "$f.part"; echo "pull failed: could not decode or write $f" >&2; exit 1
fi
echo "$f"
