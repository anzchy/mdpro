#!/bin/zsh
# reset-opus-auditor.sh — a fresh opus-auditor pane per request (ADR-0137, rule 71 § Fresh context).
# Refuses unless the agent is idle or done, refreshes the detached worktree to origin/master, splits a pane with the
# role guard env (MDPRO_ROLE=real-device-tester, MDPRO_REPORT_DIR=its report folder), closes the old pane only after the
# split succeeded, starts Claude on Opus, and fails unless the new agent is registered.
set -u
wt=$HOME/Documents/mac-app/mdpro-wt/opus-auditor rep=$HOME/.mdpro-redesign/herdr-spike/opus-auditor
info=$(herdr agent get opus-auditor 2>&1)
old=$(print -r -- $info | grep -oE '"pane_id":"[^"]+"' | head -1 | cut -d'"' -f4)
st=$(print -r -- $info | grep -oE '"agent_status":"[a-z]+"' | head -1 | cut -d'"' -f4)
if [[ -n $old ]]; then case $st in idle|done) ;; *) echo "FAIL opus-auditor is $st, not idle/done"; exit 1;; esac; fi
git -C $wt fetch -q origin && git -C $wt checkout -q --detach origin/master || { echo "FAIL refresh $wt"; exit 1; }
new=$(herdr pane split ${old:-w1:p1} --direction down --cwd $wt --no-focus --env MDPRO_ROLE=real-device-tester \
  --env MDPRO_REPORT_DIR=$rep 2>&1 | grep -oE 'w1:p[0-9A-Za-z]+' | tail -1)
[[ -n $new ]] || { echo "FAIL split; old pane $old left untouched"; exit 1; }
[[ -n $old ]] && herdr pane close $old >/dev/null 2>&1
sleep 4
herdr agent start opus-auditor --kind claude --pane $new -- --model opus --dangerously-skip-permissions >/dev/null 2>&1 \
  || { echo "FAIL start in $new"; exit 1; }
sleep 12
herdr agent get opus-auditor 2>&1 | grep -q "\"pane_id\":\"$new\"" && echo "NEW $new" || { echo "FAIL: opus-auditor not registered in $new"; exit 1; }
