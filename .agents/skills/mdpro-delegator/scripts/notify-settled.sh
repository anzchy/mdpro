#!/bin/zsh
# notify-settled.sh <agent> [report] — route completion to the active delegator runtime.
set -eu
agent=${1:?agent} report=${2:-}
state=$(herdr --session mdpro agent get "$agent" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["agent"]["agent_status"])')
case $state in idle|done|blocked) ;; *) echo "REFUSED: $agent is $state, not settled" >&2; exit 2;; esac
if [[ -n $report && -s $report ]]; then
  detail="Report ready: $report"
elif [[ -n $report ]]; then
  detail="Report missing: $report; inspect the $agent pane"
else
  detail="Read the $agent handoff or pane"
fi
mode=$("${0:A:h}/delegator-route.sh" --kind-only)
if [[ $mode == claude ]]; then
  # Claude's background Bash result resumes its turn. The Herdr Done badge is
  # sufficient; prompting it would create an unrelated, duplicate turn.
  print -r -- "Herdr completion: $agent is $state. $detail"
  exit 0
fi
herdr --session mdpro notification show "mdpro: $agent $state" --body "$detail" --sound done ||
  echo "WARN: Herdr notification failed; delegator wake still pending" >&2

# A background exec session's output alone does not start a new Codex turn.
# Herdr's wait can miss an idle transition when several callbacks race. Check
# state before each bounded wait, and re-check after a timeout.
deadline=$((SECONDS + 7200))
while true; do
  delegator_state=$(herdr --session mdpro agent get herdr-delegator | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["agent"]["agent_status"])')
  [[ $delegator_state == idle || $delegator_state == done ]] && break
  (( SECONDS < deadline )) || { echo "TIMEOUT: delegator never became idle" >&2; exit 124; }
  herdr --session mdpro agent wait herdr-delegator --until idle --timeout 5000 >/dev/null 2>&1 || true
done
if [[ $("${0:A:h}/delegator-route.sh" --kind-only) != codex ]]; then
  print -r -- "Herdr completion: $agent is $state. $detail"
  exit 0
fi
herdr --session mdpro agent prompt herdr-delegator "Herdr completion: $agent is $state. $detail Read its handoff or pane, update heartbeat, and continue the delegator queue."
