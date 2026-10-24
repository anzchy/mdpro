#!/bin/zsh
# prompt.sh <agent> <file> [verb] [timeout_ms=7200000]
# Sends the standard pointer prompt and waits for the agent to settle. RUN IT WITH run_in_background: its exit is the
# delegator's wake-up (rule 71). Never arm a bare `herdr agent wait` after a prompt.
#   verb: "brief" (implementors: read the brief and run $mdpro-tdd-workflow) or "request" (auditors: read BRIEF.md
#   first). After launching, check `herdr agent get <agent>` shows "working": a prompt sent while a new pane was still
#   starting was lost once.
set -u
a=$1 f=$2 verb=${3:-request} to=${4:-7200000}
case $a in
  opus-auditor) pre="read /Users/jack/.mdpro-redesign/herdr-spike/opus-auditor/BRIEF.md and /Users/jack/Documents/mac-app/mdpro/.claude/agents/mdpro-fable-auditor.md, then" ;;
  gpt-auditor)  pre="read /Users/jack/.mdpro-redesign/herdr-spike/gpt-auditor/BRIEF.md, then" ;;
  *) pre="" ;;
esac
if [[ $verb == brief ]]; then
  text="herdr-delegator: read $f and everything it names, then do it with \$mdpro-tdd-workflow. Write the handoff it names and stop."
else
  text="herdr-delegator: $pre the request $f. Do what it describes, write the report to the path it names, then stop."
fi
herdr agent prompt $a "$text" --wait --timeout $to
