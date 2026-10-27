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
pre=""
case $a in
  opus-auditor)
    [[ $mode == claude ]] || { echo "REFUSED: opus-auditor is unavailable to a Codex delegator" >&2; exit 2; }
    [[ -f $f ]] && grep -Eq '^User request: .+' "$f" && grep -Eiq '^Claude usage: sufficient([[:space:]]|$)' "$f" || {
      echo "REFUSED: optional opus-auditor request needs the user request and sufficient Claude usage recorded in its brief" >&2
      exit 2
    } ;;
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
