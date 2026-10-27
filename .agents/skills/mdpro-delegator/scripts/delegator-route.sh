#!/bin/zsh
# Print the active herdr-delegator runtime. Codex dispatch requires the main checkout's delegator overlay.
# --kind-only is for completion delivery after a pane has settled, when losing the wake would strand work.
set -eu
case ${1:-} in
  '') kind_only=0 ;;
  --kind-only) kind_only=1 ;;
  *) echo "REFUSED: usage: delegator-route.sh [--kind-only]" >&2; exit 2 ;;
esac
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
if [[ $mode == codex ]]; then
  if (( kind_only )); then
    echo "WARN: Codex completion route skipped delegator overlay check" >&2
  else
    main=/Users/jack/Documents/mac-app/mdpro
    if [[ ${MDPRO_GUARD_TEST:-} == 1 ]]; then
      main=${MDPRO_GUARD_TEST_MAIN:-}
      /usr/bin/python3 -c 'import os,sys,tempfile
p=sys.argv[1]
t=os.path.realpath(tempfile.gettempdir())
sys.exit(0 if os.path.isabs(p) and os.path.exists(p) and os.path.commonpath((os.path.realpath(p),t))==t and os.path.realpath(p)!=t else 1)' "$main" || {
        echo "REFUSED: test main override must resolve under tmpdir" >&2
        exit 2
      }
    fi
    overlay="$main/.codex/rules/mdpro-role.rules"
    [[ -f $overlay && ! -L $overlay && $(head -n 1 "$overlay") == '# Local mdpro role: delegator' ]] || {
      echo "REFUSED: Codex delegator overlay missing or invalid" >&2
      exit 2
    }
  fi
fi
print -r -- "$mode"
