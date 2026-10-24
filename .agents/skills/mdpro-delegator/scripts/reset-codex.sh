#!/bin/zsh
# reset-codex.sh <agent> <worktree> <model> <effort> [implementor]
# Rule 71 § Restart: every reset is a new pane. Confirms idle/done, splits a new pane in the worktree (with
# MDPRO_ROLE=implementor when the 5th argument is "implementor"), closes the old pane (releases the name), starts Codex
# with the full launch line, retries the transient "workspace routing discovery failed" start error, skips Codex's
# self-upgrade prompt (the install is shared with picsee; upgrading is the user's call), then checks the status line.
# Implementors get -s danger-full-access; gpt-auditor does not (ADR-0134 decision 4).
# Prints: NEW <pane> <status line>.  Example:
#   reset-codex.sh gpt-imple-1 ~/Documents/mac-app/mdpro-wt/gpt-imple-1 gpt-6-sol high implementor
#   reset-codex.sh gpt-auditor ~/Documents/mac-app/mdpro-wt/gpt-auditor gpt-6-sol medium
set -u
name=$1 wt=$2 model=$3 effort=$4 role=${5:-}
info=$(herdr agent get $name 2>&1)
old=$(print -r -- $info | grep -oE '"pane_id":"[^"]+"' | head -1 | cut -d'"' -f4)
st=$(print -r -- $info | grep -oE '"agent_status":"[a-z]+"' | head -1 | cut -d'"' -f4)
if [[ -n $old ]]; then
  case $st in idle|done) ;; *) echo "FAIL $name is $st, not idle/done"; exit 1;; esac
fi
extra=() ; sandbox=()
[[ $role == implementor ]] && { extra=(--env MDPRO_ROLE=implementor); sandbox=(-s danger-full-access); }
anchor=${old:-w1:p1}
new=$(herdr pane split $anchor --direction down --cwd $wt --no-focus $extra 2>&1 | grep -oE 'w1:p[0-9A-Za-z]+' | tail -1)
[[ -n $new ]] || { echo "FAIL split"; exit 1; }
[[ -n $old ]] && herdr pane close $old >/dev/null 2>&1
sleep 4
for i in 1 2 3 4; do
  herdr agent start $name --kind codex --pane $new -- -m $model $sandbox -c model_reasoning_effort=$effort \
    -c model_auto_compact_token_limit=250000 >/dev/null 2>&1
  sleep 15
  herdr agent get $name >/dev/null 2>&1 && break
  sleep 15   # "workspace routing discovery failed": transient, retry in the same pane
done
herdr agent get $name >/dev/null 2>&1 || { echo "FAIL start $name in $new (see: herdr pane read $new)"; exit 1; }
herdr pane read $new --lines 8 2>&1 | grep -q 'esc skip' && { herdr pane send-keys $new Escape >/dev/null; sleep 4; }
line=$(herdr pane read $new --lines 8 2>&1 | grep -oE '(GPT|gpt)[^·]*· Context [0-9]+% used' | tail -1)
echo "NEW $new ${line:-status line not visible (pane narrow): check herdr pane read $new}"
