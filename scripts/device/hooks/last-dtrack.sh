#!/bin/bash
# Purpose: pretty-print the most recent hook event received from dtrack, then the
# receiver's gap report (D177-WI-3): "missing seq A..B (source)" per run of missing
# seqs, "dead N (source)" when the sender dead-lettered events and "orphans N (source)"
# when it orphaned some (gap-lines.py).
# The hook dir is $MDPRO_HOOK_DIR, else ~/.mdpro-redesign/hooks.
DIR="${MDPRO_HOOK_DIR:-$HOME/.mdpro-redesign/hooks}"
F="$DIR/latest.json"
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$F" ] || { echo "no event received yet" >&2; /usr/bin/python3 "$HERE/gap-lines.py" "$DIR/gaps.json"; exit 1; }
/usr/bin/python3 -m json.tool "$F"
/usr/bin/python3 "$HERE/gap-lines.py" "$DIR/gaps.json"
