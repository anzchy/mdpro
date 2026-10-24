#!/bin/zsh
# reset-opus-auditor.sh — a fresh opus-auditor pane per request (ADR-0137, rule 71 § Fresh context).
# Refreshes the detached worktree to origin/master, splits a pane with the role guard env
# (MDPRO_ROLE=real-device-tester, MDPRO_REPORT_DIR=its report folder), closes the old pane, starts Claude on Opus.
set -u
wt=$HOME/Documents/mac-app/mdpro-wt/opus-auditor rep=$HOME/.mdpro-redesign/herdr-spike/opus-auditor
git -C $wt fetch -q origin && git -C $wt checkout -q --detach origin/master || { echo "FAIL refresh $wt"; exit 1; }
old=$(herdr agent get opus-auditor 2>&1 | grep -oE '"pane_id":"[^"]+"' | head -1 | cut -d'"' -f4)
new=$(herdr pane split ${old:-w1:p1} --direction down --cwd $wt --no-focus --env MDPRO_ROLE=real-device-tester \
  --env MDPRO_REPORT_DIR=$rep 2>&1 | grep -oE 'w1:p[0-9A-Za-z]+' | tail -1)
[[ -n $old ]] && herdr pane close $old >/dev/null 2>&1
sleep 4
herdr agent start opus-auditor --kind claude --pane $new -- --model opus --dangerously-skip-permissions >/dev/null 2>&1
sleep 12
herdr agent get opus-auditor 2>&1 | grep -q '"agent_status"' && echo "NEW $new" || { echo "FAIL start in $new"; exit 1; }
