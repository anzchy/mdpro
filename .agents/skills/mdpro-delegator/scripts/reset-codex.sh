#!/bin/zsh
# reset-codex.sh <agent> <worktree> <model> <effort> <implementor|auditor>
# Rule 71 § Restart: every reset is a new pane, and it counts only when the start's argv shows the flags and the status
# line reads "<model> <effort> · Context 0% used". Steps: refuse unless idle/done; split a pane in the worktree (with
# MDPRO_ROLE=implementor for an implementor); close the old pane only after the split succeeded;
# start Codex with the full launch line, retrying only the transient bootstrap error ("workspace routing discovery
# failed"); skip Codex's self-upgrade prompt (the install is shared with picsee; upgrading is the user's call); then
# verify argv and the status line. Exit 0 = verified; 3 = started but the status line could not be read (pane too
# narrow: zoom it and check by eye before dispatching); 1 = failed.
# Implementors get -s danger-full-access; gpt-auditor does not (ADR-0134 decision 4).
set -u
(( $# == 5 )) || { echo "REFUSED: reset-codex.sh needs implementor or auditor role" >&2; exit 2; }
name=$1 wt=$2 model=$3 effort=$4 role=$5
[[ $role == implementor || $role == auditor ]] || { echo "REFUSED: unknown Codex role $role" >&2; exit 2; }
"${0:A:h}/delegator-route.sh" >/dev/null || exit $?
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
info=$(herdr --session mdpro agent get $name 2>&1)
old=$(print -r -- $info | grep -oE '"pane_id":"[^"]+"' | head -1 | cut -d'"' -f4)
st=$(print -r -- $info | grep -oE '"agent_status":"[a-z]+"' | head -1 | cut -d'"' -f4)
if [[ -n $old ]]; then case $st in idle|done) ;; *) echo "FAIL $name is $st, not idle/done"; exit 1;; esac; fi
node "$main/scripts/codex-rules/install-role.mjs" --worktree "$wt" --role "$role" || {
  echo "REFUSED: Codex role installer failed; old pane left untouched" >&2
  exit 2
}
overlay="$wt/.codex/rules/mdpro-role.rules"
[[ -f $overlay && ! -L $overlay && $(head -n 1 "$overlay") == "# Local mdpro role: $role" ]] || {
  echo "REFUSED: invalid $role overlay after installation; old pane left untouched" >&2
  exit 2
}
extra=() ; sandbox=()
[[ $role == implementor ]] && { extra=(--env MDPRO_ROLE=implementor); sandbox=(-s danger-full-access); }
new=$(herdr --session mdpro pane split ${old:-w1:p1} --direction down --cwd $wt --no-focus $extra 2>&1 | grep -oE 'w1:p[0-9A-Za-z]+' | tail -1)
[[ -n $new ]] || { echo "FAIL split; old pane $old left untouched"; exit 1; }
[[ -n $old ]] && herdr --session mdpro pane close $old >/dev/null 2>&1
sleep 4
argv="" ok=0
for i in 1 2 3 4; do
  out=$(herdr --session mdpro agent start $name --kind codex --pane $new -- -m $model $sandbox -c model_reasoning_effort=$effort \
    -c model_auto_compact_token_limit=250000 2>&1)
  argv=$(print -r -- $out | grep -oE '"argv":\[[^]]*\]')
  sleep 15
  if herdr --session mdpro agent get $name 2>&1 | grep -q "\"pane_id\":\"$new\""; then ok=1; break; fi
  # A narrow pane wraps "workspace routing discovery failed" across lines.
  herdr --session mdpro pane read $new --lines 16 2>&1 | grep -q 'account/read failed' || break   # retry bootstrap only
  sleep 15
done
(( ok )) || { echo "FAIL start $name in $new (herdr pane read $new)"; exit 1; }
for f in "\"$model\"" "\"model_reasoning_effort=$effort\""; do
  [[ $argv == *$f* ]] || { echo "FAIL argv lacks $f: $argv"; exit 1; }
done
[[ $role == implementor && $argv != *'"danger-full-access"'* ]] && { echo "FAIL argv lacks -s danger-full-access"; exit 1; }
herdr --session mdpro pane read $new --lines 8 2>&1 | grep -q 'esc skip' && { herdr --session mdpro pane send-keys $new Escape >/dev/null; sleep 4; }
line=$(herdr --session mdpro pane read $new --lines 8 2>&1 | grep -oiE "${model}[^·]*${effort}[^·]*· Context [0-9]+% used" | tail -1)
if [[ -z $line ]]; then
  herdr --session mdpro pane zoom --on --pane $new >/dev/null 2>&1
  line=$(herdr --session mdpro pane read $new --lines 8 2>&1 | grep -oiE "${model}[^·]*${effort}[^·]*· Context [0-9]+% used" | tail -1)
  herdr --session mdpro pane zoom --off --pane $new >/dev/null 2>&1
fi
if [[ -z $line ]]; then echo "UNVERIFIED $new: status line not readable (zoom the pane and check before dispatch)"; exit 3; fi
[[ $line == *"Context 0% used"* ]] || { echo "FAIL $new: $line"; exit 1; }
echo "NEW $new $line"
