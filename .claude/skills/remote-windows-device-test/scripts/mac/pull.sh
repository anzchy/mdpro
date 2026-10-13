#!/bin/bash
# pull.sh <windows file> <local name> — copy a (binary) file back into $OUT via base64.
# The Windows path must be C:\… without quotes; the local name is a plain file name (no / or ..).
source "$(dirname "$0")/common.sh"
check_winpath "$1"; check_name "$2"
win "[Convert]::ToBase64String([IO.File]::ReadAllBytes('$(psq "$1")'))" | tr -d '\r\n' | base64 -D > "$OUT/$2"; echo "$OUT/$2"
