#!/bin/bash
# pull.sh <windows file> <local name> — copy a (binary) file back into $OUT via base64.
source "$(dirname "$0")/common.sh"
win "[Convert]::ToBase64String([IO.File]::ReadAllBytes('$1'))" | tr -d '\r\n' | base64 -D > "$OUT/$2"; echo "$OUT/$2"
