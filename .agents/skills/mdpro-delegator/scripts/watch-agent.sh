#!/bin/zsh
# watch-agent.sh <working-agent> <report> [timeout_ms=7200000]
# Run once in the background for an agent that was already working when the delegator resumed.
set -eu
agent=${1:?agent} report=${2:?report} timeout=${3:-7200000}
state=$(herdr --session mdpro agent get "$agent" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["agent"]["agent_status"])')
[[ $state == working ]] || { echo "REFUSED: $agent is $state; no new completion to watch" >&2; exit 2; }
"${0:A:h}/delegator-route.sh" --kind-only >/dev/null
herdr --session mdpro agent wait "$agent" --timeout "$timeout"
"${0:A:h}/notify-settled.sh" "$agent" "$report"
