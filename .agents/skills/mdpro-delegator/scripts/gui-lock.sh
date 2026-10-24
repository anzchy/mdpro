#!/bin/zsh
# gui-lock.sh acquire|release|status|wait — the machine-wide desktop GUI lock shared with picsee
# (ADR-0134 decision 6; agreed with picsee-delegator 2026-10-24: picsee adopts it as-is).
#   lock dir: $HOME/.cache/desktop-gui.lock/ (mkdir = acquire); `owner` key=value lines are what counts:
#   project=mdpro session=<tester> batch=<id> start=<ISO> pid=<pid> expected_minutes=<n> purpose=<text>
# Taken before the first GUI action of a device run, held across relaunches, released after mdpro has quit (aborted
# runs too). Never remove another project's lock; report a stale-looking one to the user. Testers usually take it
# themselves from the brief; the delegator uses `status` before briefing and tells picsee-delegator at start and end.
#   gui-lock.sh acquire <batch> [expected_minutes=45] [purpose] [session=herdr-delegator]   exit 0 held, 75 busy
#   gui-lock.sh wait <batch> [expected] [purpose] [session] [max_wait_min=60]
#   gui-lock.sh release <batch>      only a lock whose owner says project=mdpro and the same batch
#   gui-lock.sh status
set -u
L=$HOME/.cache/desktop-gui.lock; cmd=${1:-status}
show() { [[ -d $L ]] && { echo "HELD:"; sed 's/^/  /' "$L/owner" 2>/dev/null || echo "  (no owner file)"; } || echo "FREE"; }
case $cmd in
  status) show ;;
  acquire)
    b=${2:?batch}; exp=${3:-45}; purpose=${4:-device batch}; sess=${5:-herdr-delegator}; mkdir -p $HOME/.cache
    if mkdir "$L" 2>/dev/null; then
      printf 'project=mdpro\nsession=%s\nbatch=%s\nstart=%s\npid=%s\nexpected_minutes=%s\npurpose=%s\n' \
        "$sess" "$b" "$(date +%Y-%m-%dT%H:%M:%S%z)" "$$" "$exp" "$purpose" > "$L/owner"; echo "ACQUIRED $b"; exit 0
    fi
    echo BUSY; show; exit 75 ;;
  wait)
    b=${2:?batch}; maxw=${6:-60}
    for i in $(seq 1 $maxw); do "$0" acquire "$b" "${3:-45}" "${4:-device batch}" "${5:-herdr-delegator}" >/dev/null && { echo "ACQUIRED $b"; exit 0; }; sleep 60; done
    echo "TIMEOUT: still held; report to the user, do not remove it"; show; exit 75 ;;
  release)
    # Atomic: rename the directory aside first (one winner), then check the owner in the renamed copy. If it is not
    # ours, put it back with os.rename, which fails rather than nesting if someone has taken the lock meanwhile.
    b=${2:?batch}; [[ -d $L ]] || { echo FREE; exit 0; }
    T="$L.release.$$"
    mv "$L" "$T" 2>/dev/null || { echo "FREE or released concurrently"; exit 0; }
    if grep -qx 'project=mdpro' "$T/owner" 2>/dev/null && grep -qx "batch=$b" "$T/owner" 2>/dev/null; then
      rm "$T/owner" && rmdir "$T" && echo "RELEASED $b"; exit $?
    fi
    python3 -c 'import os,sys; os.rename(sys.argv[1], sys.argv[2])' "$T" "$L" \
      && { echo "REFUSED: not our lock ($b); left in place"; show; exit 1; } \
      || { echo "ALERT: not our lock and the path was retaken; the foreign lock is at $T: tell the user"; exit 1; } ;;
  *) echo "usage: gui-lock.sh acquire|wait|release|status"; exit 2 ;;
esac
