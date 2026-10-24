#!/bin/zsh
# clear-mac-test.sh — before each SendMessage brief to mac-test (tmux dtrack): capture the pane once (rule 70 § The Mac
# mini), refuse if a read-only viewer is the latest client, send /clear with C-m, and confirm Context 0%.
# Dim text in its input box is a prompt suggestion, never the user's answer.
tmux capture-pane -pt dtrack | tail -8
tmux list-clients -t dtrack 2>/dev/null | grep -q ' (read-only' && { echo "REFUSED: a read-only viewer is attached; ask the user"; exit 1; }
tmux send-keys -t dtrack '/clear' C-m; sleep 4
tmux capture-pane -pt dtrack | grep -oE 'Context [^│]*' | tail -1
