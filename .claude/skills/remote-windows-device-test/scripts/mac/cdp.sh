#!/bin/bash
# cdp.sh eval '<js>'        evaluate in the mdpro page (helpers: ../../reference/ops.md § __a)
# cdp.sh evalf <local.js>   push a longer script file and evaluate it (the eval form is limited to ~5 KB)
# cdp.sh shot <name>        page screenshot copied to $OUT/<name>.png  (name: [A-Za-z0-9._-]+)
# cdp.sh --window <label> … the same, in the mdpro window with that Tauri label; required when
#                           several windows are open (cdp.mjs exits 5 / 6 otherwise, listing them)
source "$(dirname "$0")/common.sh"
W=""
if [ "$1" = --window ]; then
  [[ $2 =~ $RE_NAME ]] || { echo "refusing window label: $2" >&2; exit 2; }
  W="--window '$(psq "$2")' "; shift 2
fi
# Print the remote output and exit with the remote status: a failed eval must fail its caller.
# Exit 3 is an unknown outcome (the eval may have run); see common.sh win.
finish() { [ -n "$2" ] && printf '%s\n' "$2"; [ "$1" -eq 0 ] || exit "$1"; need "$2"; }
case "$1" in
  shot)
    check_name "$2"
    win_read "cd '$WD'; node cdp.mjs ${W}shot '$WD\\$(psq "$2").png'" >/dev/null || exit $?
    "$(dirname "$0")/pull.sh" "$WIN_DIR\\$2.png" "$2.png" ;;
  evalf)
    "$(dirname "$0")/push.sh" "$2" "$WIN_DIR\\eval.js" >/dev/null || exit $?
    out=$(win "cd '$WD'; node cdp.mjs ${W}evalfile '$WD\\eval.js'"); finish $? "$out" ;;
  eval)
    b=$(printf '%s' "$2" | base64 | tr -d '\n')     # base64 has no quote characters
    [ ${#b} -gt 7000 ] && { echo "script too long for eval (${#b} b64 chars); use: cdp.sh evalf file.js" >&2; exit 2; }
    out=$(win "cd '$WD'; node cdp.mjs ${W}eval64 $b"); finish $? "$out" ;;
  *) sed -n 2,6p "$0"; exit 2 ;;
esac
