#!/bin/bash
# ADR-0047 WI-006 spike, S1 slot B: S1.4 at-most-once under four faults, S1.5 result contract.
# Run on the mini from the spike verify worktree (built with control-channel,devtools).
# Each mutation is one click on #md-auto-pair; "ran" = new `preferences.set` Start lines in the run's log.
# Prints one "CASE <id> PASS|FAIL|INFO <detail>" line per check; never prints the token.
set -u
export LC_ALL=en_US.UTF-8
# Never leave an app behind: on any exit, quit the run still open (a second quit of a closed run is a harmless refusal).
trap '[ -n "${R:-}" ] && pnpm -s control:quit "$R" >/dev/null 2>&1' EXIT
HERE="$(cd "$(dirname "$0")" && pwd)"
RUNS="$HOME/Library/Application Support/mdpro-verify/runs"
TMP="${TMPDIR:-/tmp}/s1b.$$"; mkdir -p "$TMP"
fails=0
say() { printf 'CASE %s %s %s\n' "$1" "$2" "$3"; [ "$2" = FAIL ] && fails=$((fails+1)); return 0; }
launch() { env "$@" pnpm -s control:launch 2>&1 | tee /dev/stderr | sed -n 's/^ready: L1 run \([^ ]*\) pid \([0-9]*\).*/\1 \2/p'; }
quit() { pnpm -s control:quit "$1" >&2 2>&1 || true; }
jget() { python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }
open_run() {  # sets R P PORT TOKEN B LOG A
  read -r R P <<<"$(launch "$@")"; [ -n "${P:-}" ] || { say launch FAIL "no pid"; exit 1; }
  local cj="$RUNS/$R/control.json"; for _ in $(seq 1 20); do [ -s "$cj" ] && break; sleep 0.5; done
  PORT=$(jget "$cj" port); TOKEN=$(jget "$cj" token); B="http://127.0.0.1:$PORT"; LOG="$RUNS/$R/.mdpro/mdpro.log"
  A=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
}
rid() { echo "X-Request-Id: s1b-$1-$RANDOM$RANDOM"; }
wd() { curl -s -m 10 -X "$1" "${A[@]}" -H "$(rid w)" ${3:+-d "$3"} "$B$2"; }
val() { python3 -c 'import json,sys;v=json.load(sys.stdin)["value"];print(list(v.values())[0] if isinstance(v,dict) else v)' 2>/dev/null; }
starts() { grep '"preferences.set"' "$LOG" 2>/dev/null | grep -ci '"start"'; }
new_session() { S=$(wd POST /session '{"capabilities":{}}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["value"]["sessionId"])'); G="/session/$S"; }
setup_prefs() {  # opens Settings with ⌘, (handled in the webview) and finds the checkbox → CB
  new_session
  wd POST "$G/actions" '{"actions":[{"type":"key","id":"k","actions":[{"type":"keyDown","value":""},{"type":"keyDown","value":","},{"type":"keyUp","value":","},{"type":"keyUp","value":""}]}]}' >/dev/null
  CB=""
  for _ in $(seq 1 10); do
    CB=$(wd POST "$G/element" '{"using":"css selector","value":"#md-auto-pair"}' | val)
    case "$CB" in ""|*"no such"*) CB=""; sleep 0.5 ;; *) break ;; esac
  done
  [ -n "$CB" ] && say setup PASS "settings open, checkbox found" || { say setup FAIL "checkbox not found"; quit "$R"; exit 1; }
}
selected() { wd GET "$G/element/$CB/selected" | val; }
fault() {  # fault <id> <mode>: one click through the proxy, a same-id retry, then judge run count and state
  local id=$1 mode=$2 pp=$((PORT+1000)) s0 s1 x0 x1 out re ID
  x0=$(selected); s0=$(starts)
  python3 -I "$HERE/faultproxy.py" "$pp" "$PORT" "$mode" 4 > "$TMP/proxy" & local pxy=$!
  sleep 0.3; ID=$(rid "$id")
  out=$(curl -s -o /dev/null -w '%{http_code}' -m 2 -X POST "${A[@]}" -H "Host: 127.0.0.1:$PORT" -H "$ID" -d '{}' "http://127.0.0.1:$pp$G/element/$CB/click")
  wait $pxy; sleep 1.5
  re=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST "${A[@]}" -H "$ID" -d '{}' "$B$G/element/$CB/click")
  sleep 1; x1=$(selected); s1=$(starts)
  local ran=$((s1-s0)) flipped=0; [ "$x0" != "$x1" ] && flipped=1
  local d="client=$out $(cat "$TMP/proxy") retry=$re ran=$ran state ${x0}→$x1"
  if [ "$re" = 409 ] && [ $ran -le 1 ] && [ $ran -eq $flipped ]; then say "$id" PASS "$d"; else say "$id" FAIL "$d"; fi
}

# ---------- S1.4, eval off ----------
open_run
setup_prefs
fault f1-lost lost
fault f2-delay delay
fault f3-disconnect disconnect
# f4 duplicate: the same id twice at once → one 200, one 409, one run
s0=$(starts); x0=$(selected); ID=$(rid f4)
for i in 1 2; do curl -s -o /dev/null -w '%{http_code}\n' -m 10 -X POST "${A[@]}" -H "$ID" -d '{}' "$B$G/element/$CB/click" > "$TMP/dup$i" & done; wait
sleep 1; ran=$(( $(starts)-s0 )); x1=$(selected); codes=$(cat "$TMP/dup1" "$TMP/dup2" | sort | tr '\n' ' ')
[ "$codes" = "200 409 " ] && [ $ran -eq 1 ] && say f4-dup PASS "codes $codes ran=$ran state ${x0}→$x1" || say f4-dup FAIL "codes $codes ran=$ran state ${x0}→$x1"
# a fresh id after the faults is a new intent and runs once
s0=$(starts); wd POST "$G/element/$CB/click" '{}' >/dev/null; sleep 1; ran=$(( $(starts)-s0 ))
[ $ran -eq 1 ] && say f5-fresh PASS "new id runs once" || say f5-fresh FAIL "new id ran $ran"

# ---------- S1.5 part 1, eval off: correlation id and error envelope ----------
H=$(curl -s -D - -o /dev/null -m 5 "${A[@]}" -H "X-Request-Id: corr-$RANDOM$RANDOM" -X POST -d '{"using":"css selector","value":"body"}' "$B$G/element" | tr -d '\r' | grep -i '^x-request-id:')
[ -n "$H" ] && say c1-corr PASS "echoed: $H" || say c1-corr INFO "response does not echo X-Request-Id (correlation is client-side only)"
E=$(wd POST "$G/element" '{"using":"css selector","value":"#no-such-node-s1b"}')
if echo "$E" | python3 -c 'import json,sys;v=json.load(sys.stdin)["value"];assert v["error"] and "message" in v' 2>/dev/null; then
  say c2-envelope PASS "$(echo "$E" | python3 -c 'import json,sys;print(json.load(sys.stdin)["value"]["error"])')"
else say c2-envelope FAIL "body: ${E:0:120}"; fi
wd DELETE "$G" >/dev/null; quit "$R"

# ---------- S1.5 part 2, eval on: awaited Promise, timeout, late result discarded ----------
open_run MDPRO_CONTROL_EVAL=1
[ "$(jget "$RUNS/$R/control.json" eval)" = True ] && say e0 PASS "eval flag set" || say e0 FAIL "eval flag not set in control.json"
new_session
wd POST "$G/timeouts" '{"script":1000}' >/dev/null
r=$(wd POST "$G/execute/sync" '{"script":"return new Promise(r=>setTimeout(()=>r(41+1),300))","args":[]}' | val)
[ "$r" = 42 ] && say c3-promise PASS "Promise awaited → 42" || say c3-promise FAIL "got $r"
r=$(wd POST "$G/execute/sync" '{"script":"return new Promise(r=>setTimeout(()=>r(\"late\"),2500))","args":[]}')
echo "$r" | grep -q 'script timeout' && say c4-timeout PASS "script timeout after 1 s" || say c4-timeout FAIL "${r:0:120}"
sleep 2.5
r=$(wd POST "$G/execute/sync" '{"script":"return \"fresh\"","args":[]}' | val)
[ "$r" = fresh ] && say c5-late PASS "late result discarded; next call got its own" || say c5-late FAIL "next call got $r"
c=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST "${A[@]}" -H "$(rid ev)" -d '{"script":"1"}' "$B/wdio/eval")
say c6-eval INFO "/wdio/eval with eval on → $c"
grep -qF "$TOKEN" "$LOG" && say tok FAIL "token in mdpro.log" || say tok PASS "token absent from mdpro.log"
wd DELETE "$G" >/dev/null; quit "$R"
echo "FAILS $fails"
[ $fails -eq 0 ]
