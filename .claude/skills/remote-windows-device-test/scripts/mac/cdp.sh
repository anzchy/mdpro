#!/bin/bash
# cdp.sh eval '<js>'        evaluate in the mdpro page (helpers: ../../reference/ops.md § __a)
# cdp.sh evalf <local.js>   push a longer script file and evaluate it (the eval form is limited to ~5 KB)
# cdp.sh shot <name>        page screenshot copied to $OUT/<name>.png
source "$(dirname "$0")/common.sh"
case "$1" in
  shot)
    win "cd '$WIN_DIR'; node cdp.mjs shot '$WIN_DIR\\$2.png'" >/dev/null
    "$(dirname "$0")/pull.sh" "$WIN_DIR\\$2.png" "$2.png" ;;
  evalf)
    "$(dirname "$0")/push.sh" "$2" "$WIN_DIR\\eval.js" >/dev/null || exit 1
    out=$(win "cd '$WIN_DIR'; node cdp.mjs evalfile '$WIN_DIR\\eval.js'"); need "$out"; printf '%s\n' "$out" ;;
  eval)
    b=$(printf '%s' "$2" | base64 | tr -d '\n')
    [ ${#b} -gt 7000 ] && { echo "script too long for eval (${#b} b64 chars); use: cdp.sh evalf file.js" >&2; exit 2; }
    out=$(win "cd '$WIN_DIR'; node cdp.mjs eval64 $b"); need "$out"; printf '%s\n' "$out" ;;
  *) sed -n 2,4p "$0"; exit 2 ;;
esac
