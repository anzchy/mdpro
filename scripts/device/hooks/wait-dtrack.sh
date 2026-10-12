#!/bin/bash
# Purpose: block until the hook receiver appends a new event to events.jsonl.
# Usage: wait-dtrack.sh [-t seconds (default 1800)] [-e regex on "hook_event_name|notification_type"]
# Prints the matching event JSON and exits 0; exits 124 on timeout. Either way the
# receiver's gap report (gap-lines.py: missing seq runs, dead and orphan counts) goes to stderr
# (D177-WI-3). A matched event the receiver marked "spool_late" (it arrived below the
# source's floor, so it is an old event, not the one being waited for) also prints
# "late seq N (source)" on stderr (D177-H-4). The hook dir is $MDPRO_HOOK_DIR, else
# ~/.mdpro-redesign/hooks.
set -u
DIR="${MDPRO_HOOK_DIR:-$HOME/.mdpro-redesign/hooks}"
HERE="$(cd "$(dirname "$0")" && pwd)"
gaps() { /usr/bin/python3 "$HERE/gap-lines.py" "$DIR/gaps.json" >&2; }
late() {
  printf '%s' "$1" | /usr/bin/python3 -c 'import json,sys
d=json.loads(sys.stdin.read())
if d.get("spool_late") is True: print("late seq %s (%s)" % (d.get("spool_seq"), d.get("spool_source")))' >&2 2>/dev/null
}
found() { echo "$1"; late "$1"; gaps; exit 0; }
EVENTS="$DIR/events.jsonl"
TIMEOUT=1800
FILTER=""
while getopts "t:e:h" opt; do
  case "$opt" in
    t) TIMEOUT="$OPTARG" ;;
    e) FILTER="$OPTARG" ;;
    *) sed -n '2,4p' "$0"; exit 2 ;;
  esac
done
touch "$EVENTS"
start=$(wc -l < "$EVENTS" | tr -d ' ')
deadline=$(( $(date +%s) + TIMEOUT ))
seen=$start
while :; do
  now_count=$(wc -l < "$EVENTS" | tr -d ' ')
  if [ "$now_count" -lt "$seen" ]; then seen=0; fi   # file truncated/rotated
  while [ "$seen" -lt "$now_count" ]; do
    seen=$((seen + 1))
    line=$(sed -n "${seen}p" "$EVENTS")
    if [ -z "$FILTER" ]; then found "$line"; fi
    key=$(printf '%s' "$line" | /usr/bin/python3 -c 'import json,sys
d=json.loads(sys.stdin.read()); print("%s|%s" % (d.get("hook_event_name") or "", d.get("notification_type") or ""))' 2>/dev/null)
    if printf '%s' "$key" | grep -Eq -- "$FILTER"; then found "$line"; fi
  done
  if [ "$(date +%s)" -ge "$deadline" ]; then gaps; exit 124; fi
  sleep 1
done
