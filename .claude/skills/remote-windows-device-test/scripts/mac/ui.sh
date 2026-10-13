#!/bin/bash
# ui.sh '<json steps>' — run ui.ps1 steps in the Windows desktop session; prints one log line per step.
# Steps and their limits: ../../reference/ops.md. Never discard this output (>/dev/null): it is the only
# evidence that a step (e.g. "max") actually ran.
source "$(dirname "$0")/common.sh"
b=$(printf '%s' "$1" | base64 | tr -d '\n')
raw=$(win "powershell -NoProfile -ExecutionPolicy Bypass -File '$WIN_DIR\\ui-run.ps1' -StepsB64 $b" | tr -d '\r\n')
need "$raw"
printf '%s' "$raw" | base64 -D | python3 -c "
import json,sys
raw=sys.stdin.buffer.read().decode('utf-8-sig')
try:
    v=json.loads(raw); [print(x) for x in (v if isinstance(v,list) else [v])]
except Exception: print(raw)"
