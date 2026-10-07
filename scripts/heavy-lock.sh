#!/usr/bin/env bash
# heavy-lock.sh — run a heavy job under one machine-wide lock.
#
# Purpose: serialise heavy jobs (vitest --coverage, cargo test, tauri build)
#   across every mdpro checkout and worktree on this machine, so concurrent
#   sessions queue instead of overloading CPU and memory together.
#
# Usage: scripts/heavy-lock.sh <command...>
# Env:
#   MDPRO_HEAVY_LOCK            lock dir (default $HOME/.cache/mdpro-heavy.lock),
#                               outside the repo so all worktrees share it.
#   MDPRO_HEAVY_LOCK_WAIT_SECS  max wait for the lock (default 1800); exit 75.
#   MDPRO_HEAVY_LOCK_HELD=1     exported to the child; a nested call runs directly.
#
# Key decisions: macOS has no flock(1), so the lock is an atomic `mkdir` dir
#   holding an `owner` file (pid, start time, cwd, command). An owner pid that
#   fails `kill -0` is stale and reclaimed. The child's exit code propagates
#   exactly; the lock is released on EXIT/INT/TERM.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: $0 <command...>" >&2
  exit 64
fi
[[ "${MDPRO_HEAVY_LOCK_HELD:-}" == "1" ]] && exec "$@"

LOCK="${MDPRO_HEAVY_LOCK:-$HOME/.cache/mdpro-heavy.lock}"
MAX_WAIT="${MDPRO_HEAVY_LOCK_WAIT_SECS:-1800}"
POLL_SECS=5
HEARTBEAT_SECS=60
TAG="[heavy-lock]"
mkdir -p "$(dirname "$LOCK")"

holder_desc() { tr '\n' ' ' <"${1:-$LOCK}/owner" 2>/dev/null || echo "(no owner file)"; }
pid_in() { sed -n 's/^pid=//p' "$1/owner" 2>/dev/null | head -n 1 || true; }

try_acquire() {
  mkdir "$LOCK" 2>/dev/null || return 1
  printf 'pid=%s\nstarted=%s\ncwd=%s\ncmd=%s\n' \
    "$$" "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$PWD" "$*" >"$LOCK/owner"
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
next_heartbeat=$HEARTBEAT_SECS
ownerless_polls=0
until try_acquire "$@"; do
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

child=""
release() {
  if [[ "$(pid_in "$LOCK")" == "$$" ]]; then
    rm -f "$LOCK/owner"
    rmdir "$LOCK" 2>/dev/null || true
  fi
}
# Bash defers traps while a foreground child runs, so the child runs in the
# background and we `wait` (interruptible). Async children of a non-interactive
# shell ignore SIGINT, so both signals are forwarded to the child as TERM.
on_signal() {
  [[ -n "$child" ]] && kill -TERM "$child" 2>/dev/null
  release
  trap - "$1"
  kill "-$1" $$
}
trap release EXIT
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

export MDPRO_HEAVY_LOCK_HELD=1
set +e
"$@" <&0 &
child=$!
wait "$child"
status=$?
set -e
exit "$status"
