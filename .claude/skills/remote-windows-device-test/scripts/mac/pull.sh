#!/bin/bash
# pull.sh <windows file> <local name> — copy a (binary) file back into $OUT via base64.
# The Windows path must be C:\… without quotes; the local name is a plain file name (no / or ..).
source "$(dirname "$0")/common.sh"
check_winpath "$1"; check_name "$2"
# Read first, then decode: inside a pipeline a failed read would leave an empty file and exit 0.
b=$(win_read "[Convert]::ToBase64String([IO.File]::ReadAllBytes('$(psq "$1")'))") || exit $?
printf '%s' "$b" | tr -d '\r\n' | base64 --decode > "$OUT/$2"; echo "$OUT/$2"
