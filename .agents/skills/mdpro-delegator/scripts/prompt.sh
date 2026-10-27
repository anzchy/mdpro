#!/bin/zsh
# prompt.sh <agent> <file> [verb] [timeout_ms=7200000] [expected_report]
# Sends the standard pointer prompt and waits for the agent to settle. Run in the background.
# Codex gets an explicit Herdr wake-up; Claude resumes from the background Bash result.
#   verb: "brief" (implementors: read the brief and run $tdd-guardian:tdd-guardian-workflow) or "request" (auditors: read BRIEF.md
#   first). After launching, check `herdr agent get <agent>` shows "working": a prompt sent while a new pane was still
#   starting was lost once.
set -eu
a=$1 f=$2 verb=${3:-request} to=${4:-7200000} report=${5:-}
mode=$("${0:A:h}/delegator-route.sh")
if [[ $a == opus-auditor ]]; then
  [[ $mode == claude ]] || { echo "REFUSED: opus-auditor is unavailable to a Codex delegator" >&2; exit 2; }
  [[ -f $f ]] && grep -Eq '^User request: .+' "$f" && grep -Eiq '^Claude usage: sufficient([[:space:]]|$)' "$f" || {
    echo "REFUSED: opus-auditor request needs the user request and sufficient Claude usage recorded in its brief" >&2
    exit 2
  }
fi
target_record=$(herdr --session mdpro agent get "$a") || {
  echo "REFUSED: cannot read target $a" >&2
  exit 2
}
target_kind=$(print -r -- "$target_record" | python3 -c 'import json,sys
try:
 a=json.load(sys.stdin)["result"]["agent"]
 print(a.get("agent") or a.get("agent_session",{}).get("agent") or "")
except (KeyError,TypeError,ValueError): sys.exit(2)') || {
  echo "REFUSED: malformed target record for $a" >&2
  exit 2
}
case $target_kind in
  codex)
    source "${0:A:h}/agent-role.sh"
    expected=$(mdpro_role_for_agent "$a") || { echo "REFUSED: unknown Codex agent $a" >&2; exit 2; }
    target_cwd=$(print -r -- "$target_record" | python3 -c 'import json,sys
a=json.load(sys.stdin)["result"]["agent"]
v=a.get("cwd")
print(v if isinstance(v,str) else "")') || {
      echo "REFUSED: malformed cwd for $a" >&2
      exit 2
    }
    [[ -n $target_cwd ]] || { echo "REFUSED: empty cwd for Codex target $a" >&2; exit 2; }
    overlay="$target_cwd/.codex/rules/mdpro-role.rules"
    [[ -f $overlay && ! -L $overlay ]] || { echo "REFUSED: missing restricted overlay for $a" >&2; exit 2; }
    first=$(head -n 1 "$overlay")
    [[ $first == "# Local mdpro role: $expected" ]] || {
      echo "REFUSED: wrong restricted overlay for $a (expected $expected)" >&2
      exit 2
    }
    target_pane=$(print -r -- "$target_record" | python3 -c 'import json,sys
try:
 a=json.load(sys.stdin)["result"]["agent"]
 v=a.get("pane_id")
 print(v if isinstance(v,str) else "")
except (KeyError,TypeError,ValueError): sys.exit(2)') || {
      echo "REFUSED: malformed pane for $a" >&2
      exit 2
    }
    [[ -n $target_pane ]] || { echo "REFUSED: empty pane for $a" >&2; exit 2; }
    marker="$target_cwd/.codex/rules/.started-at"
    [[ -f $marker && ! -L $marker && $(cat "$marker") == "$target_pane" ]] || {
      echo "REFUSED: pane start record missing or mismatched for $a" >&2
      exit 2
    }
    /usr/bin/python3 -c 'import os,sys
overlay,marker=sys.argv[1:]
sys.exit(0 if os.stat(marker).st_mtime_ns >= os.stat(overlay).st_mtime_ns else 1)' "$overlay" "$marker" || {
      echo "REFUSED: overlay is newer than the pane for $a" >&2
      exit 2
    } ;;
  claude) ;;
  *) echo "REFUSED: unknown target runtime for $a" >&2; exit 2 ;;
esac
pre=""
case $a in
  gpt-auditor)  pre="read /Users/jack/.mdpro-redesign/herdr-spike/gpt-auditor/BRIEF.md, then" ;;
  *) pre="" ;;
esac
if [[ $verb == brief ]]; then
  text="herdr-delegator: read $f and everything it names, then do it with \$tdd-guardian:tdd-guardian-workflow. Write the handoff it names and stop."
else
  text="herdr-delegator: $pre the request $f. Do what it describes, write the report to the path it names, then stop."
fi
herdr --session mdpro agent prompt $a "$text" --wait --timeout $to
"${0:A:h}/notify-settled.sh" "$a" "$report"
