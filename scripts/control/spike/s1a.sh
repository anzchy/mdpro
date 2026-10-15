#!/bin/bash
# ADR-0047 WI-006 spike, S1 slot A (plan §WI-006 S1.1–S1.3; prep a1–a7).
# Run on the mini from the spike verify worktree, after `pnpm control:build --profile verify
# --features control-channel,devtools`. Usage: s1a.sh <feature-off worktree>   (e.g. verify-9940be9-wi005-base)
# Prints one "CASE <id> PASS|FAIL <detail>" line per check; never prints the token.
set -u
OFF_WT="$1"; ON_WT="$(pwd)"
RUNS="$HOME/Library/Application Support/mdpro-verify/runs"
fails=0
say() { printf 'CASE %s %s %s\n' "$1" "$2" "$3"; [ "$2" = FAIL ] && fails=$((fails+1)); return 0; }
launch() {  # launch [env...] → prints "<run> <pid>"; launcher output goes to stderr
  env "$@" pnpm -s control:launch 2>&1 | tee /dev/stderr | sed -n 's/^ready: L1 run \([^ ]*\) pid \([0-9]*\).*/\1 \2/p'
}
quit() { pnpm -s control:quit "$1" >&2 2>&1 || true; }
listeners() { lsof -nP -a -p "$1" -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $9}' | sort -u; }

# --- a7: feature-off build has only the MCP listener -------------------------------------
cd "$OFF_WT" || exit 2
read -r R P <<<"$(launch)"; [ -n "${P:-}" ] || { say a7 FAIL "launch failed"; exit 1; }
sleep 3; L=$(listeners "$P"); n=$(printf '%s\n' "$L" | grep -c . )
ws=0; for a in $L; do curl -s -m 2 "http://$a/status" | grep -q '"ready"' && ws=1; done
[ "$n" -le 1 ] && [ $ws -eq 0 ] && say a7 PASS "listeners=$n ($L), none answers WebDriver /status" || say a7 FAIL "listeners=$n ($L) ws=$ws"
quit "$R"; cd "$ON_WT" || exit 2

# --- WI-006 build, eval off; TAURI_WEBDRIVER_PORT=abc must be ignored (a6) -----------------
read -r R P <<<"$(launch TAURI_WEBDRIVER_PORT=abc)"; [ -n "${P:-}" ] || { say a0 FAIL "launch failed"; exit 1; }
CJ="$RUNS/$R/control.json"
for _ in $(seq 1 20); do [ -s "$CJ" ] && break; sleep 0.5; done
[ -s "$CJ" ] || { say a0 FAIL "no control.json"; quit "$R"; exit 1; }
mode=$(stat -f %Lp "$CJ"); PORT=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["port"])' "$CJ")
TOKEN=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["token"])' "$CJ")
EVAL=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["eval"])' "$CJ")
[ "$mode" = 600 ] && say a0 PASS "control.json mode 600, eval=$EVAL" || say a0 FAIL "control.json mode $mode"
L=$(listeners "$P")
printf '%s\n' "$L" | grep -q ':4445$' && say a6 FAIL "something on 4445" || say a6 PASS "port env ignored; channel on $PORT; listeners: $(echo $L)"
printf '%s\n' "$L" | grep -q "^127.0.0.1:$PORT$" && say a5a PASS "bound to 127.0.0.1:$PORT only" || say a5a FAIL "listener list: $L"
B="http://127.0.0.1:$PORT"; LOG="$RUNS/$R/.mdpro/mdpro.log"
code() { curl -s -o /dev/null -w '%{http_code}' -m 5 "$@"; }
ROUTES="GET /status
POST /session
DELETE /session/x
GET /session/x/url
GET /session/x/title
POST /session/x/element
POST /session/x/elements
GET /session/x/element/active
POST /session/x/element/e/click
POST /session/x/element/e/clear
POST /session/x/element/e/value
GET /session/x/element/e/text
GET /session/x/source
GET /session/x/screenshot
GET /session/x/window
POST /session/x/window
GET /session/x/window/handles
POST /session/x/window/rect
POST /session/x/window/maximize
POST /session/x/actions
DELETE /session/x/actions
POST /session/x/cookie
POST /session/x/alert/accept
POST /session/x/alert/text"
# a1: no token on every route → 401, and no new log line
before=$(wc -l < "$LOG" 2>/dev/null || echo 0); bad=""
while read -r m p; do c=$(code -X "$m" -H "X-Request-Id: a1-$RANDOM$RANDOM" "$B$p"); [ "$c" = 401 ] || bad="$bad $m$p=$c"; done <<<"$ROUTES"
after=$(wc -l < "$LOG" 2>/dev/null || echo 0)
[ -z "$bad" ] && [ "$before" = "$after" ] && say a1 PASS "$(grep -c . <<<"$ROUTES") routes 401, log lines $before→$after" || say a1 FAIL "bad:$bad log $before→$after"
# a2: wrong token of the same length → 401 (and rough timing against no-token)
WRONG=$(printf '%s' "$TOKEN" | tr '0-9a-f' 'f0-9a-e')
c=$(code -H "Authorization: Bearer $WRONG" "$B/status"); [ "$c" = 401 ] && say a2 PASS "wrong token 401" || say a2 FAIL "wrong token $c"
t() { for _ in $(seq 1 40); do curl -s -o /dev/null -w '%{time_total}\n' -m 5 "$@"; done | sort -n | sed -n 20p; }
say a2t INFO "median no-token $(t "$B/status")s, wrong-token $(t -H "Authorization: Bearer $WRONG" "$B/status")s"
A=(-H "Authorization: Bearer $TOKEN")
c=$(code "${A[@]}" -H "Host: evil.example" "$B/status"); [ "$c" = 403 ] && say a3 PASS "foreign Host 403" || say a3 FAIL "foreign Host $c"
c=$(code "${A[@]}" -H "Origin: http://evil.example" "$B/status"); [ "$c" = 403 ] && say a4 PASS "Origin 403" || say a4 FAIL "Origin $c"
TS=$(ifconfig | awk '/inet 100\./{print $2; exit}')
if [ -n "$TS" ]; then c=$(code --connect-timeout 2 "${A[@]}" "http://$TS:$PORT/status"); [ "$c" = 000 ] && say a5 PASS "refused on $TS" || say a5 FAIL "answered $c on $TS"; else say a5 INFO "no 100.x address"; fi
c=$(code "${A[@]}" "$B/status"); [ "$c" = 200 ] && say ok0 PASS "right token /status 200" || say ok0 FAIL "right token /status $c"

# --- S1.3 with a valid session, eval off -------------------------------------------------
rid() { printf 'X-Request-Id: s13-%s-%s' "$1" "$RANDOM$RANDOM"; }
S=$(curl -s -m 10 "${A[@]}" -H "$(rid s)" -H 'Content-Type: application/json' -d '{"capabilities":{}}' "$B/session" | python3 -c 'import json,sys;print(json.load(sys.stdin)["value"]["sessionId"])' 2>/dev/null)
[ -n "$S" ] && say s0 PASS "session created" || say s0 FAIL "no session"
G="$B/session/$S"
for mp in "POST /wdio/eval" "POST /session/$S/execute/sync" "POST /session/$S/execute/async" "POST /session/$S/url" \
          "POST /session/$S/back" "POST /session/$S/forward" "POST /session/$S/refresh" "DELETE /session/$S/window" \
          "POST /session/$S/window/new" "POST /session/$S/print"; do
  set -- $mp; c=$(code -X "$1" "${A[@]}" -H "$(rid r)" -H 'Content-Type: application/json' -d '{"script":"return 1","args":[],"url":"javascript:1"}' "$B$2")
  case "$c" in 404|405) say s13 PASS "$1 $2 → $c" ;; *) say s13 FAIL "$1 $2 → $c" ;; esac
done
E=$(curl -s -m 10 "${A[@]}" -H "$(rid f)" -H 'Content-Type: application/json' -d '{"using":"css selector","value":"body"}' "$G/element" | python3 -c 'import json,sys;v=json.load(sys.stdin)["value"];print(list(v.values())[0])' 2>/dev/null)
[ -n "$E" ] && say s13c PASS "find element works with eval off" || say s13c FAIL "find element failed"
c=$(code -X POST "${A[@]}" -H "$(rid c)" -H 'Content-Type: application/json' -d '{}' "$G/element/$E/click"); [ "$c" = 200 ] && say s13c PASS "click works with eval off" || say s13c FAIL "click $c"
c=$(code -X POST "${A[@]}" -H 'Content-Type: application/json' -d '{}' "$G/element/$E/click"); [ "$c" = 400 ] && say r1 PASS "mutation without X-Request-Id 400" || say r1 FAIL "no id → $c"
ID="X-Request-Id: dup-$RANDOM$RANDOM"
c1=$(code -X POST "${A[@]}" -H "$ID" -H 'Content-Type: application/json' -d '{"using":"css selector","value":"body"}' "$G/element")
c2=$(code -X POST "${A[@]}" -H "$ID" -H 'Content-Type: application/json' -d '{"using":"css selector","value":"body"}' "$G/element")
[ "$c1" = 200 ] && [ "$c2" = 409 ] && say r2 PASS "duplicate id 409" || say r2 FAIL "dup → $c1/$c2"
code -X DELETE "${A[@]}" -H "$(rid d)" "$G" >/dev/null
grep -c '"control.listen"' "$LOG" | xargs -I{} say log INFO "control.listen lines: {}"
grep -q "$TOKEN" "$LOG" && say tok FAIL "token appears in mdpro.log" || say tok PASS "token absent from mdpro.log"
quit "$R"
echo "FAILS $fails"
