#!/usr/bin/env bash
# Purpose: owner publication, identity-only diagnostics and guarded stale reclaim.
# Sourced by heavy-lock.sh; keeper UUID and pid/start identity protocols stay intact.
holder_desc() { python3 "$(dirname "$GUARD")/owner.py" describe "${1:-$LOCK}/owner"; }
pid_in() { sed -n 's/^pid=//p' "$1/owner" 2>/dev/null | head -n 1 || true; }
owner_start_in() { sed -n 's/^process_start=//p' "$1/owner" 2>/dev/null | head -n 1 || true; }

try_acquire() {
  mkdir "$LOCK" 2>/dev/null || return 1
  local summary
  summary="$(python3 "$(dirname "$GUARD")/owner.py" summary "$*" "$KEEPER" "${keeper_label:-}")"
  printf 'pid=%s\nstarted=%s\nprocess_start=%s\ncwd=%s\ncmd=%s\n' \
    "$$" "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$(ps -p $$ -o lstart= | awk '{$1=$1;print}')" "$PWD" "$summary" >"$LOCK/owner"
}

# Rename first, then re-check both observed identity fields before deleting.
# A peer's changed owner is restored rather than reclaimed on an old observation.
reclaim() {
  local expect="$1" why="$2" expect_start="${3:-}" grave="$LOCK.stale.$$"
  mv "$LOCK" "$grave" 2>/dev/null || return 0
  if [[ "$(pid_in "$grave")" != "$expect" || "$(owner_start_in "$grave")" != "$expect_start" ]]; then
    [[ -e "$LOCK" ]] || mv "$grave" "$LOCK" 2>/dev/null || true
    return 0
  fi
  echo "$TAG reclaiming $why lock $LOCK: $(holder_desc "$grave")" >&2
  rm -rf "$grave"
}
