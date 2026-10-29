#!/usr/bin/env bash
# heavy-lock.sh — run a heavy job under one machine-wide lock.
#
# Purpose: serialise heavy jobs (vitest --coverage, cargo test, tauri build)
#   across every mdpro checkout and worktree on this machine, so concurrent
#   sessions queue instead of overloading CPU and memory together.
#
# Usage: scripts/heavy-lock.sh <command...>
#        scripts/heavy-lock.sh --guard-only <command...> (no lock)
#        scripts/heavy-lock.sh --hold|--release <uuid> (GUI keeper)
# Env:
#   MDPRO_HEAVY_LOCK            lock dir (default $HOME/.cache/mdpro-heavy.lock),
#                               outside the repo so all worktrees share it.
#   MDPRO_HEAVY_LOCK_WAIT_SECS  max wait for the lock (default 1800); exit 75.
#   MDPRO_HEAVY_LOCK_HELD=1     exported to the child; a nested call runs directly.
#   MDPRO_HEAVY_LOCK_KILL_GRACE_SECS  on INT/TERM, how long the job's process
#                               group gets after TERM before KILL (default 10).
#   MDPRO_LOAD_GUARD_INTERVAL_SECS  sample interval (default 5); the sampler
#                               can be injected with MDPRO_LOAD_GUARD_SAMPLER.
#   MDPRO_LOAD_GUARD_BUDGET_GIB   test-only budget override.
#   MDPRO_LOAD_GUARD_LOG / MDPRO_LOAD_GUARD_ACTIVE override the JSON-lines log
#                               and registration directory for tests.
# Exit: child status normally; 64 invalid invocation; 75 wait/admission refusal;
#   76 stopped after TERM, grace, KILL if needed, and process-group drain.
# Log: commands omit arguments (basename + full-command SHA256 digest).
#   event,time,project,cmd,cwd,readings (pressure,cpuBusy,availableGiB,
#   vmStatFreeGiB,memorystatusLevel),reason,topRss (JSON per line).
# Pressure uses libdispatch NORMAL=1, WARN=2, CRITICAL=4. On macOS an
#   unreadable value waits rather than starting; Linux CI starts with a note.
#   Admission uses kern.memorystatus_level% of hw.memsize on macOS and logs
#   vm_stat free+inactive+purgeable beside it for comparison.
#
# Key decisions: macOS has no flock(1), so the lock is an atomic `mkdir` dir
#   holding an `owner` file (pid, start time, cwd, command). An owner pid that
#   fails `kill -0` is stale and reclaimed. The child's exit code propagates
#   exactly; the lock is released on EXIT/INT/TERM — on a signal only after the
#   child's whole process group has exited (D75), so a queued job never starts
#   beside orphaned rustc / vitest workers. Cost of the own process group: the
#   job is not the terminal's foreground group, so a job that reads the tty
#   (an interactive prompt) is stopped by SIGTTIN; heavy jobs here never do.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: $0 [--guard-only] <command...>" >&2
  echo "exit 76 is a load-guard stop: do not retry immediately; after ten minutes at pressure 1 retry once with fewer workers or a smaller shard, then report a second stop to the owner" >&2
  exit 64
fi
GUARD_ONLY=0
KEEPER=0
if [[ "$1" == "--hold" || "$1" == "--release" || "$1" == "--keeper" ]]; then
  mode="$1"; shift
  [[ $# -ge 1 && "$1" =~ ^[0-9a-f-]{36}$ ]] || exit 64
  keeper_label="$1"; shift
  [[ "$mode" != "--keeper" ]] || KEEPER=1
  if [[ "$mode" == "--keeper" ]]; then
    [[ $# -eq 1 ]] || exit 64
    keeper_ready="$1"
    set -- "--keeper" "$keeper_label" "$keeper_ready"
  fi
fi
if [[ "${1:-}" == "--guard-only" ]]; then
  GUARD_ONLY=1
  shift
  [[ $# -gt 0 ]] || exit 64
fi
[[ "$GUARD_ONLY" == 0 && -z "${mode:-}" && "${MDPRO_HEAVY_LOCK_HELD:-}" == "1" ]] && exec "$@"
JOB_CMD="$*"

LOCK="${MDPRO_HEAVY_LOCK:-$HOME/.cache/mdpro-heavy.lock}"
MAX_WAIT="${MDPRO_HEAVY_LOCK_WAIT_SECS:-1800}"
POLL_SECS=5
KILL_GRACE_SECS="${MDPRO_HEAVY_LOCK_KILL_GRACE_SECS:-10}"
HEARTBEAT_SECS=60
TAG="[heavy-lock]"
GUARD="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/load-guard/guard.py"
SAMPLE_SECS="${MDPRO_LOAD_GUARD_INTERVAL_SECS:-5}"
budget_gib="$(python3 "$GUARD" budget "$JOB_CMD")"
# Sampling and monitoring share this wrapper's job/lock state.
source "$(dirname "$GUARD")/runtime.sh"
mkdir -p "$(dirname "$LOCK")"

if [[ "${mode:-}" == "--hold" ]]; then
  ready="$(mktemp "${TMPDIR:-/tmp}/mdpro-keeper.XXXXXX")"
  rm -f "$ready"
  nohup "$0" --keeper "$keeper_label" "$ready" >/dev/null 2>&1 &
  keeper_pid=$!
  while kill -0 "$keeper_pid" 2>/dev/null; do
    if [[ -e "$ready" ]]; then rm -f "$ready"; exit 0; fi
    [[ "$(ps -p "$keeper_pid" -o stat= 2>/dev/null | tr -d ' ')" == Z* ]] && break
    sleep 0.1
  done
  rm -f "$ready"
  exit 75
fi
if [[ "${mode:-}" == "--release" ]]; then
  owner_pid="$(sed -n 's/^pid=//p' "$LOCK/owner" 2>/dev/null | head -n 1)"
  [[ -n "$owner_pid" ]] || exit 1
  grep -q "^cmd=--keeper $keeper_label " "$LOCK/owner" || exit 1
  owner_start="$(sed -n 's/^process_start=//p' "$LOCK/owner" | head -n 1)"
  [[ -n "$owner_start" ]] || exit 1
  grep -q "^cmd=--keeper $keeper_label " "$LOCK/owner" || exit 1
  python3 "$GUARD" signal-pid "$owner_pid" "$owner_start" TERM || exit 1
  for ((i=0; i<100; i++)); do
    [[ -d "$LOCK" ]] || exit 0
    sleep 0.05
  done
  exit 75
fi

holder_desc() { tr '\n' ' ' <"${1:-$LOCK}/owner" 2>/dev/null || echo "(no owner file)"; }
pid_in() { sed -n 's/^pid=//p' "$1/owner" 2>/dev/null | head -n 1 || true; }

try_acquire() {
  mkdir "$LOCK" 2>/dev/null || return 1
  printf 'pid=%s\nstarted=%s\nprocess_start=%s\ncwd=%s\ncmd=%s\n' \
    "$$" "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$(ps -p $$ -o lstart= | awk '{$1=$1;print}')" "$PWD" "$*" >"$LOCK/owner"
}

# Rename first (atomic), then re-check the moved owner: if a peer reclaimed and
# re-acquired in between, put its live lock back instead of deleting it.
reclaim() {
  local expect="$1" why="$2" grave="$LOCK.stale.$$"
  mv "$LOCK" "$grave" 2>/dev/null || return 0
  if [[ "$(pid_in "$grave")" != "$expect" ]]; then
    [[ -e "$LOCK" ]] || mv "$grave" "$LOCK" 2>/dev/null || true
    return 0
  fi
  echo "$TAG reclaiming $why lock $LOCK: $(holder_desc "$grave")" >&2
  rm -rf "$grave"
}

waited=0
started_clock="$(python3 "$GUARD" clock)"
next_heartbeat=$HEARTBEAT_SECS
ownerless_polls=0
while [[ "$GUARD_ONLY" == 0 ]] && ! try_acquire "$@"; do
  pid="$(pid_in "$LOCK")"
  if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
    reclaim "$pid" "stale (owner pid $pid is dead)"
    continue
  fi
  # A peer is ownerless only between mkdir and writing owner (microseconds);
  # ownerless across two polls means it died there.
  if [[ -z "$pid" && -d "$LOCK" ]]; then
    ownerless_polls=$((ownerless_polls + 1))
    if ((ownerless_polls >= 2)); then
      reclaim "" "ownerless"
      ownerless_polls=0
      continue
    fi
  else
    ownerless_polls=0
  fi
  if ((waited == 0)); then
    echo "$TAG waiting for $LOCK, held by: $(holder_desc)" >&2
  elif ((waited >= next_heartbeat)); then
    echo "$TAG still waiting (${waited}s), held by: $(holder_desc)" >&2
    next_heartbeat=$((next_heartbeat + HEARTBEAT_SECS))
  fi
  if ((waited >= MAX_WAIT)); then
    echo "$TAG gave up after ${waited}s (MDPRO_HEAVY_LOCK_WAIT_SECS=$MAX_WAIT); held by: $(holder_desc)" >&2
    exit 75
  fi
  nap=$((MAX_WAIT - waited < POLL_SECS ? MAX_WAIT - waited : POLL_SECS))
  sleep "$nap"
  waited=$((waited + nap))
done

# Admission uses the same total deadline as lock acquisition. Unreadable
# readings fail closed. Pressure 2 or 4 never admits.
admission_logged=0
admission_cpu_streak=0
while :; do
  read_sample
  if [[ "$pressure" == unreadable ]]; then
    if [[ "${MDPRO_GUARD_TEST:-}" == 1 && -n "${MDPRO_LOAD_GUARD_TEST_OS:-}" ]]; then
      guard_os="$MDPRO_LOAD_GUARD_TEST_OS"
    else
      guard_os="$(uname -s)"
    fi
    if [[ "$guard_os" != Darwin ]]; then
      log_guard note unreadable
      break
    fi
    log_guard warn unreadable
  fi
  if [[ "$busy" != unreadable ]] && awk "BEGIN {exit !($busy > 95)}"; then admission_cpu_streak=$((admission_cpu_streak + 1)); else admission_cpu_streak=0; fi
  if ((admission_cpu_streak == 3)); then log_guard warn cpu; fi
  if [[ "$pressure" == 1 && "$free_gib" != unreadable ]] && ge "$free_gib" "$(awk "BEGIN {print $budget_gib + 1}")" && ((admission_cpu_streak == 0)); then
    log_guard admission admitted
    break
  fi
  if ((admission_logged == 0)); then log_guard warn admission; admission_logged=1; fi
  if elapsed_ge "$(python3 "$GUARD" clock)" "$started_clock" "$MAX_WAIT"; then
    if [[ "$GUARD_ONLY" == 0 && "$(pid_in "$LOCK")" == "$$" ]]; then
      rm -f "$LOCK/owner"
      rmdir "$LOCK" 2>/dev/null || true
    fi
    exit 75
  fi
  sleep "$SAMPLE_SECS"
done

child=""
keeper_sleep=""
release() {
  [[ "$GUARD_ONLY" == 1 ]] && return 0
  if [[ "$(pid_in "$LOCK")" == "$$" ]]; then
    rm -f "$LOCK/owner"
    rmdir "$LOCK" 2>/dev/null || true
  fi
}
group_alive() { kill -0 -- "-$child" 2>/dev/null; }
# TERM the child's whole process group (rustc, vitest workers, not just the
# direct child), give it KILL_GRACE_SECS, then KILL; only then may the lock go.
stop_group() {
  local ticks=0
  python3 "$GUARD" signal "$child" "$child" "$child_start" TERM 2>/dev/null || return 0
  while group_alive && ((ticks < KILL_GRACE_SECS * 10)); do
    sleep 0.1
    ticks=$((ticks + 1))
  done
  if group_alive; then
    echo "$TAG job ignored TERM for ${KILL_GRACE_SECS}s; sending KILL" >&2
    python3 "$GUARD" signal "$child" "$child" "$child_start" KILL 2>/dev/null || true
    while group_alive && ((ticks < (KILL_GRACE_SECS + 5) * 10)); do
      sleep 0.1
      ticks=$((ticks + 1))
    done
  fi
}
# Bash defers traps while a foreground child runs, so the child runs in the
# background and we `wait` (interruptible). Both signals are forwarded to the
# child's group as TERM.
on_signal() {
  [[ -n "$child" ]] && stop_group
  if [[ -n "$keeper_sleep" ]]; then
    kill "$keeper_sleep" 2>/dev/null || true
    wait "$keeper_sleep" 2>/dev/null || true
  fi
  release
  trap - "$1"
  kill "-$1" $$
}
trap release EXIT
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

if [[ "$KEEPER" == 1 ]]; then
  touch "$keeper_ready"
  while :; do
    sleep 60 &
    keeper_sleep=$!
    wait "$keeper_sleep" || true
    keeper_sleep=""
  done
fi

if [[ "$GUARD_ONLY" == 0 ]]; then
  export MDPRO_HEAVY_LOCK_HELD=1
else
  unset MDPRO_HEAVY_LOCK_HELD
fi
if [[ "$JOB_CMD" == *cargo* && "$JOB_CMD" == *test* ]]; then
  cargo_cap="$(python3 -c 'import os; print(max(1, (os.cpu_count() or 1) - 2))')"
  if [[ "${CARGO_BUILD_JOBS:-}" =~ ^[0-9]+$ && "${CARGO_BUILD_JOBS:-}" -lt "$cargo_cap" ]]; then
    cargo_cap="$CARGO_BUILD_JOBS"
  fi
  export CARGO_BUILD_JOBS="$cargo_cap"
fi
if [[ "$GUARD_ONLY" == 1 ]]; then
  export MDPRO_VITEST_WORKER_HEAP_MIB="${MDPRO_VITEST_WORKER_HEAP_MIB:-1024}"
else
  export MDPRO_VITEST_WORKER_HEAP_MIB="${MDPRO_VITEST_WORKER_HEAP_MIB:-2048}"
fi
set +e
# Job control gives the async child its own process group (pgid = $child), so
# stop_group can reach every descendant, even ones orphaned when the child dies.
set -m
"$@" <&0 &
child=$!
set +m
child_start="$(ps -p "$child" -o lstart= | awk '{$1=$1;print}')"
python3 "$GUARD" register "$child" "$child" "$*" "$PWD" >/dev/null 2>&1 || true
stop_marker="$(mktemp "${TMPDIR:-/tmp}/mdpro-load-stop.XXXXXX")"
rm -f "$stop_marker"
monitor &
monitor_pid=$!
wait "$child"
status=$?
wait "$monitor_pid" 2>/dev/null || true
python3 "$GUARD" unregister "$child" 2>/dev/null || true
if [[ -e "$stop_marker" ]]; then status=76; fi
rm -f "$stop_marker"
set -e
exit "$status"
