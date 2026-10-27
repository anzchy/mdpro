#!/bin/zsh
# Print the active herdr-delegator runtime. Never guess from a pane name or model label.
set -eu
record=$(herdr --session mdpro agent get herdr-delegator) || {
  echo "REFUSED: cannot read herdr-delegator" >&2
  exit 2
}
mode=$(print -r -- "$record" | python3 -c '
import json, sys
try:
    agent = json.load(sys.stdin)["result"]["agent"]
    kind = agent.get("agent") or agent.get("agent_session", {}).get("agent")
except (KeyError, TypeError, ValueError):
    kind = None
if kind not in ("codex", "claude"):
    sys.exit(2)
print(kind)
') || {
  echo "REFUSED: unknown herdr-delegator runtime" >&2
  exit 2
}
print -r -- "$mode"
