#!/bin/bash
# ADR-0047 WI-006 spike, S2.2 / S2.3: the driver's Esc for J5 step 3.
# Usage: s2esc.sh <run-id>   (the id `pnpm control:launch` printed as "ready: L1 run <id> pid <pid>")
# Sends one W3C Actions key press of Escape (U+E00C) through the run's control channel, in a fresh
# session, with no element found, clicked or focused first. Eval stays off; this is a fixed command.
# Prints "S2ESC <http-code> <detail>" lines; never prints the token. Exit 0 only when the press was accepted.
set -u
export LC_ALL=en_US.UTF-8
R="${1:?usage: s2esc.sh <run-id>}"
RUNS="$HOME/Library/Application Support/mdpro-verify/runs"
CJ="$RUNS/$R/control.json"
[ -s "$CJ" ] || { echo "S2ESC - no control.json for run $R"; exit 2; }
jget() { python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }
PORT=$(jget "$CJ" port); TOKEN=$(jget "$CJ" token); B="http://127.0.0.1:$PORT"
A=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
rid() { echo "X-Request-Id: s2esc-$1-$RANDOM$RANDOM"; }
TMP="${TMPDIR:-/tmp}/s2esc.$$"; mkdir -p "$TMP"
S=$(curl -s -m 10 -X POST "${A[@]}" -H "$(rid s)" -d '{"capabilities":{}}' "$B/session" \
  | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["value"]["sessionId"])' 2>/dev/null)
[ -n "$S" ] || { echo "S2ESC - no session"; exit 1; }
KEYS='{"actions":[{"type":"key","id":"k","actions":[{"type":"keyDown","value":"\uE00C"},{"type":"keyUp","value":"\uE00C"}]}]}'
code=$(curl -s -o "$TMP/body" -w '%{http_code}' -m 10 -X POST "${A[@]}" -H "$(rid k)" -d "$KEYS" "$B/session/$S/actions")
echo "S2ESC $code actions $(head -c 200 "$TMP/body")"
# No DELETE of the session or its actions: s1a/s1b never send one, and an unchecked session delete
# could close the window past the unsaved-changes prompt. The session ends with the run.
rm -rf "$TMP"
[ "$code" = 200 ]
