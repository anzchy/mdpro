#!/bin/zsh
# clear-mac-test.sh — before each brief to mac-test (tmux dtrack): capture the pane once (rule 70 § The Mac mini),
# refuse while any read-only viewer is attached (send-keys would deliver nothing), send /clear with C-m, and fail
# unless the status line then reads Context 0%. Dim text in its input box is a prompt suggestion, never the user's answer.
set -u
tmux capture-pane -pt dtrack | tail -8 || { echo "FAIL capture"; exit 1; }
tmux list-clients -t dtrack 2>/dev/null | grep -q 'read-only' && { echo "REFUSED: a read-only viewer is attached; ask the user"; exit 1; }
tmux send-keys -t dtrack '/clear' C-m || { echo "FAIL send-keys"; exit 1; }
sleep 5
ctx=$(tmux capture-pane -pt dtrack | grep -oE 'Context [^│]*[0-9]+%' | tail -1)
[[ $ctx == *" 0%"* ]] && echo "CLEARED ($ctx)" || { echo "FAIL: after /clear the pane shows '${ctx:-no context line}'; look before briefing"; exit 1; }
