#!/bin/bash
# ui.sh '<json steps>' — run ui.ps1 steps in the Windows desktop session; prints one log line per step.
# Steps and their limits: ../../reference/ops.md. Never discard this output (>/dev/null): it is the only
# evidence that a step (e.g. "max") actually ran.
source "$(dirname "$0")/common.sh"
# Reject caller-supplied identity: only the fresh read below may authorize a labelled native step.
needsIdentity=$(STEPS_JSON="$1" python3 -c '
import json,os,sys
try:
    steps=json.loads(os.environ["STEPS_JSON"])
    if not isinstance(steps,list) or any(not isinstance(s,dict) or "_identity" in s for s in steps): raise ValueError()
    labels=[s["window"] for s in steps if "window" in s]
    if any(not isinstance(v,str) or not v for v in labels): raise ValueError()
    print(int(bool(labels)))
except (ValueError,KeyError,TypeError): sys.exit(2)
') || { echo "invalid UI steps or caller-supplied identity" >&2; exit 2; }
if [ "$needsIdentity" = 1 ]; then
  identity=$(win_read "cd '$WD'; node cdp.mjs identity-native"); readRc=$?
  [ $readRc -eq 0 ] || exit $readRc
  [ -n "$identity" ] || { echo "IDENTITY_READ_FAILED: empty CDP answer" >&2; exit 1; }
  b=$(STEPS_JSON="$1" IDENTITY_JSON="$identity" python3 -c '
import base64,json,os,sys
try:
    steps=json.loads(os.environ["STEPS_JSON"])
    records=json.loads(os.environ["IDENTITY_JSON"])
    if not isinstance(records,list) or not records: raise ValueError()
    labels=[r.get("label") for r in records if isinstance(r,dict)]
    if len(labels)!=len(records) or len(set(labels))!=len(records): raise ValueError()
    for r in records:
        rect=r.get("rect")
        if not isinstance(r.get("label"),str) or not r["label"] or not isinstance(rect,list) or len(rect)!=4 or any(type(n)!=int for n in rect): raise ValueError()
        if rect[2]<=rect[0] or rect[3]<=rect[1]: raise ValueError()
    for s in steps:
        if "window" in s:
            if s["window"] not in labels: raise ValueError()
            s["_identity"]=records
    print(base64.b64encode(json.dumps(steps,separators=(",",":")).encode()).decode())
except (ValueError,TypeError,KeyError,AttributeError): sys.exit(2)
') || { echo "IDENTITY_INVALID: CDP answer cannot authorize native input" >&2; exit 2; }
else
  b=$(printf '%s' "$1" | base64 | tr -d '\n')
fi
# If the mutation dies mid-run, remove the task as a backstop; no cleanup is needed after a read failure.
trap 'rc=$?; [ $rc -ne 0 ] && "$(dirname "$0")/mdpro.sh" cleanup >/dev/null 2>&1; exit $rc' EXIT
raw=$(win "powershell -NoProfile -ExecutionPolicy Bypass -File '$WIN_DIR\\ui-run.ps1' -StepsB64 $b"); rc=$?
raw=$(printf '%s' "$raw" | tr -d '\r\n')
# Exit 3: the steps may or may not have run (common.sh win). Nothing to decode; stop here.
[ $rc -eq 3 ] && exit 3
[ $rc -eq 0 ] && need "$raw"
# Decode and print the step log whatever the status, then exit with the remote status.
[ -n "$raw" ] && printf '%s' "$raw" | base64 --decode | python3 -c "
import json,sys
raw=sys.stdin.buffer.read().decode('utf-8-sig')
try:
    v=json.loads(raw); [print(x) for x in (v if isinstance(v,list) else [v])]
except Exception: print(raw)"
exit $rc
