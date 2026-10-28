# D329 step 4: mixed-project GUI-lock interop on the deployed heads (2026-10-28)

The joint cutover agreed with picsee-delegator for [D329](../plans/20260912-frontend-backend-sequencing-order.md#d329):
1. both projects paused GUI dispatch;
2. picsee confirmed no old releaser was alive;
3. picsee installed its port (picsee PR #210, main `9e8ae83`);
4. this run;
5. resume.

**Run.** herdr-delegator drove both live scripts, unedited, against the real `~/.cache/desktop-gui.lock` and `~/.cache/desktop-gui.mutex`.
No GUI run was active on either side. picsee-delegator was told beforehand not to touch the lock.
- mdpro: `.agents/skills/mdpro-delegator/scripts/gui-lock.sh` at master after `17fc6517` (ADR-0141 WI-2).
- picsee: `/Users/jack/Documents/mac-app/picsee/.agents/skills/picsee-delegator/scripts/gui-lock.sh` at picsee `9e8ae83`.

**Result: 18/18 PASS, exit 0; both FREE at the end.**
- **T3:** 20 simultaneous acquire races, each with exactly one winner (mdpro 5, picsee 15), never two, never none.
- **T1, T2 and T4:** each side sees the other as BUSY (exit 75) and parses the other's eight-field owner. Each refuses to release the
  other's lock, and refuses a forged-uuid release.

The pre-existing race the D row describes (the old picsee releaser checks, then `rm owner && rmdir`) is gone: both sides now run the
whole read-check-mutate under the flock mutex. A separate owner-validation defect found during picsee's port, the `splitlines` mismatch,
is D333 and still open on the mdpro side.

## Output

```
PASS T0 both FREE before
PASS T1 mdpro acquired (44d2570c-b816-494f-9ce6-fa95f33e764e)
PASS T1 picsee acquire BUSY (75)
PASS T1 picsee status shows project=mdpro
PASS T1 picsee release of mdpro lock refused (rc=1)
PASS T1 mdpro owner intact
PASS T1 mdpro release -> FREE
PASS T2 picsee acquired (dda38077-e98d-4d76-87b2-dd84362704a6)
PASS T2 mdpro acquire BUSY (75)
PASS T2 mdpro status shows project=picsee
PASS T2 mdpro release of picsee lock refused (rc=1)
PASS T4 picsee forged-uuid release refused (rc=1)
PASS T2 picsee owner intact
PASS T2 picsee release -> FREE
PASS T4 mdpro forged-uuid release refused (rc=1)
PASS T4 mdpro release -> FREE
PASS T3 20 rounds: exactly one winner each (mdpro won 5, picsee won 15)
PASS END both FREE
```

## Script

```zsh
#!/bin/zsh
# D329 step 4: mixed-project tests on the real shared GUI lock, both live scripts, no edits to either.
set -u
M=/Users/jack/Documents/mac-app/mdpro/.agents/skills/mdpro-delegator/scripts/gui-lock.sh
P=/Users/jack/Documents/mac-app/picsee/.agents/skills/picsee-delegator/scripts/gui-lock.sh
fail=0
ok()  { print -r -- "PASS $1"; }
bad() { print -r -- "FAIL $1"; fail=1; }
uid() { print -r -- "$1" | grep -oE 'acquisition_id=[0-9a-f-]+' | head -1 | cut -d= -f2; }
free() { [[ "$($M status 2>&1)" == FREE && "$($P status 2>&1)" == FREE ]]; }

free && ok "T0 both FREE before" || { bad "T0 not FREE before start: $($M status)"; exit 1; }

# T1: mdpro holds
o=$($M acquire interop-t1 2 "D329 interop T1" herdr-delegator 2>&1); mid=$(uid "$o")
[[ -n $mid ]] && ok "T1 mdpro acquired ($mid)" || bad "T1 mdpro acquire: $o"
o=$($P acquire interop-t1p 2 "D329 interop T1" picsee-delegator 2>&1); rc=$?
[[ $rc == 75 ]] && ok "T1 picsee acquire BUSY (75)" || bad "T1 picsee acquire rc=$rc: $o"
s=$($P status 2>&1); [[ $s == *"project=mdpro"* ]] && ok "T1 picsee status shows project=mdpro" || bad "T1 picsee status: $s"
o=$($P release interop-t1 --acquisition-id "$mid" 2>&1); rc=$?
[[ $rc != 0 ]] && ok "T1 picsee release of mdpro lock refused (rc=$rc)" || bad "T1 picsee released mdpro's lock: $o"
[[ "$($M status 2>&1)" == *"acquisition_id=$mid"* ]] && ok "T1 mdpro owner intact" || bad "T1 owner changed"
o=$($M release interop-t1 --acquisition-id "$mid" 2>&1); rc=$?
[[ $rc == 0 ]] && free && ok "T1 mdpro release -> FREE" || bad "T1 mdpro release rc=$rc: $o"

# T2: picsee holds
o=$($P acquire interop-t2 2 "D329 interop T2" picsee-delegator 2>&1); pid_=$(uid "$o")
[[ -n $pid_ ]] && ok "T2 picsee acquired ($pid_)" || bad "T2 picsee acquire: $o"
o=$($M acquire interop-t2m 2 "D329 interop T2" herdr-delegator 2>&1); rc=$?
[[ $rc == 75 ]] && ok "T2 mdpro acquire BUSY (75)" || bad "T2 mdpro acquire rc=$rc: $o"
s=$($M status 2>&1); [[ $s == *"project=picsee"* ]] && ok "T2 mdpro status shows project=picsee" || bad "T2 mdpro status: $s"
o=$($M release interop-t2 --acquisition-id "$pid_" 2>&1); rc=$?
[[ $rc != 0 ]] && ok "T2 mdpro release of picsee lock refused (rc=$rc)" || bad "T2 mdpro released picsee's lock: $o"
# T4a: forged release by the holder's own script, wrong uuid
o=$($P release interop-t2 --acquisition-id 00000000-0000-4000-8000-000000000000 2>&1); rc=$?
[[ $rc != 0 ]] && ok "T4 picsee forged-uuid release refused (rc=$rc)" || bad "T4 picsee forged release succeeded: $o"
[[ "$($P status 2>&1)" == *"acquisition_id=$pid_"* ]] && ok "T2 picsee owner intact" || bad "T2 owner changed"
o=$($P release interop-t2 --acquisition-id "$pid_" 2>&1); rc=$?
[[ $rc == 0 ]] && free && ok "T2 picsee release -> FREE" || bad "T2 picsee release rc=$rc: $o"

# T4b: mdpro forged-uuid release
o=$($M acquire interop-t4 2 "D329 interop T4" herdr-delegator 2>&1); mid=$(uid "$o")
o2=$($M release interop-t4 --acquisition-id 00000000-0000-4000-8000-000000000000 2>&1); rc=$?
[[ $rc != 0 ]] && ok "T4 mdpro forged-uuid release refused (rc=$rc)" || bad "T4 mdpro forged release succeeded: $o2"
$M release interop-t4 --acquisition-id "$mid" >/dev/null 2>&1 && free && ok "T4 mdpro release -> FREE" || bad "T4 cleanup"

# T3: 20 simultaneous rounds
both=0; none=0
T=$(mktemp -d /private/tmp/claude-501/-Users-jack-Documents-mac-app-mdpro/f8ccc845-6922-453b-9b22-efbc0402f3b6/scratchpad/interop.XXXX)
for r in $(seq 1 20); do
  ( $M acquire interop-r$r 2 "D329 race" herdr-delegator > $T/m$r 2>&1; print $? > $T/mrc$r ) &
  ( $P acquire interop-r$r 2 "D329 race" picsee-delegator > $T/p$r 2>&1; print $? > $T/prc$r ) &
  wait
  mrc=$(<$T/mrc$r); prc=$(<$T/prc$r)
  if [[ $mrc == 0 && $prc == 0 ]]; then both=$((both+1)); print -r -- "FAIL T3 round $r: BOTH acquired"; fail=1
  elif [[ $mrc == 0 && $prc == 75 ]]; then $M release interop-r$r --acquisition-id "$(uid "$(<$T/m$r)")" >/dev/null 2>&1
  elif [[ $prc == 0 && $mrc == 75 ]]; then $P release interop-r$r --acquisition-id "$(uid "$(<$T/p$r)")" >/dev/null 2>&1
  else none=$((none+1)); print -r -- "FAIL T3 round $r: mdpro rc=$mrc picsee rc=$prc"; fail=1; fi
  free || { print -r -- "FAIL T3 round $r: not FREE after release: $($M status)"; fail=1; break; }
done
mw=$(grep -l '^0$' $T/mrc* 2>/dev/null | wc -l | tr -d ' '); pw=$(grep -l '^0$' $T/prc* 2>/dev/null | wc -l | tr -d ' ')
(( both == 0 && none == 0 )) && ok "T3 20 rounds: exactly one winner each (mdpro won $mw, picsee won $pw)" || bad "T3 both=$both neither=$none"
free && ok "END both FREE" || bad "END not FREE: $($M status)"
exit $fail
```
