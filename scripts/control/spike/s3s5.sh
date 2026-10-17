#!/bin/bash
# ADR-0047 WI-006 spike, S3-S5: one `cli` journey step through the run's control channel.
# Usage: s3s5.sh <run-id> <step>   (run id from `pnpm control:launch`'s "ready: L1 run <id> pid <pid>")
#        s3s5.sh --dry-run <step>  print the requests without a server
# Steps and what each reads back: s3s5.py. Eval stays off. Never prints the token.
set -u
export LC_ALL=en_US.UTF-8
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "${1:-}" = --dry-run ]; then exec python3 -I "$HERE/s3s5.py" --dry-run "${2:?step}"; fi
R="${1:?usage: s3s5.sh <run-id> <step>}"; STEP="${2:?usage: s3s5.sh <run-id> <step>}"
CJ="$HOME/Library/Application Support/mdpro-verify/runs/$R/control.json"
[ -s "$CJ" ] || { echo "S3S5 $STEP ERR no control.json for run $R"; exit 2; }
jget() { python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }
S3S5_PORT=$(jget "$CJ" port) S3S5_TOKEN=$(jget "$CJ" token) exec python3 -I "$HERE/s3s5.py" "$STEP"
