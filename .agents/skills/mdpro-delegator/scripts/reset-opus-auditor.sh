#!/bin/zsh
# reset-opus-auditor.sh — fresh Claude/Opus pane for each required ADR-0143 audit.
# Refresh the detached worktree, split, then close the old pane; never use this route from a Codex delegator.
set -eu
mode=$("${0:A:h}/delegator-route.sh") || exit $?
[[ $mode == claude ]] || { echo "REFUSED: opus-auditor reset requires the Claude delegator route" >&2; exit 2; }

wt=$HOME/Documents/mac-app/mdpro-wt/opus-auditor
rep=$HOME/.mdpro-redesign/herdr-spike/opus-auditor
if [[ ${MDPRO_GUARD_TEST:-} == 1 ]]; then
  wt=${MDPRO_GUARD_TEST_OPUS_WT:-}
  rep=${MDPRO_GUARD_TEST_OPUS_REPORT:-}
  /usr/bin/python3 -c 'import os,sys,tempfile
root=os.path.realpath(tempfile.gettempdir())
for p in sys.argv[1:]:
 if not os.path.isdir(p) or not os.path.isabs(p) or os.path.commonpath((os.path.realpath(p),root)) != root or os.path.realpath(p) == root: sys.exit(1)' "$wt" "$rep" || {
    echo "REFUSED: test Opus paths must resolve under tmpdir" >&2
    exit 2
  }
fi

info=$(herdr --session mdpro agent get opus-auditor) || { echo "REFUSED: cannot read opus-auditor" >&2; exit 2; }
old=$(print -r -- "$info" | grep -oE '"pane_id":"[^"]+"' | head -1 | cut -d'"' -f4 || true)
st=$(print -r -- "$info" | grep -oE '"agent_status":"[a-z]+"' | head -1 | cut -d'"' -f4 || true)
if [[ -n $old ]]; then
  case $st in idle|done) ;; *) echo "REFUSED: opus-auditor is $st, not idle/done" >&2; exit 2;; esac
fi

git -C "$wt" fetch -q origin && git -C "$wt" checkout -q --detach origin/master || {
  echo "FAIL: could not refresh $wt" >&2
  exit 1
}
split_out=$(herdr --session mdpro pane split ${old:-w1:p1} --direction down --cwd "$wt" --no-focus \
  --env MDPRO_ROLE=real-device-tester --env "MDPRO_REPORT_DIR=$rep" 2>&1) || {
  echo "FAIL: split; old pane $old left untouched" >&2
  exit 1
}
new=$(print -r -- "$split_out" | grep -oE 'w1:p[0-9A-Za-z]+' | tail -1 || true)
[[ -n $new ]] || { echo "FAIL: split; old pane $old left untouched" >&2; exit 1; }
if [[ -n $old ]]; then
  herdr --session mdpro pane close "$old" >/dev/null 2>&1 || { echo "FAIL: could not close old pane $old" >&2; exit 1; }
fi
sleep 4
herdr --session mdpro agent start opus-auditor --kind claude --pane "$new" -- --model opus --dangerously-skip-permissions >/dev/null 2>&1 || {
  echo "FAIL: start in $new" >&2
  exit 1
}
sleep 12
herdr --session mdpro agent get opus-auditor 2>&1 | grep -q "\"pane_id\":\"$new\"" || {
  echo "FAIL: opus-auditor not registered in $new" >&2
  exit 1
}
echo "NEW $new"
