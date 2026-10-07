#!/bin/zsh
# usage: shot.sh <surface>-<theme>   -> $MDPRO_SHOTS/<name>.png (window only, native backing scale)
# Captures only the mdpro window (screencapture -l), never the rest of the desktop.
# Needs Screen Recording for the terminal that runs it; over plain SSH it fails (no TCC grant).
MDPRO_SHOTS=${MDPRO_SHOTS:-$HOME/.mdpro-redesign/stage-0/shots}
mkdir -p "$MDPRO_SHOTS"
WID=$(osascript -l JavaScript ${0:h}/winid.js | awk 'NR==1{print $1}')
[ -n "$WID" ] || { echo "no mdpro window found" >&2; exit 1; }
out="$MDPRO_SHOTS/$1.png"
screencapture -x -o -l$WID "$out" && echo "$1 $(sips -g pixelWidth -g pixelHeight "$out" | awk '/pixel/{printf "%s ",$2}')"
