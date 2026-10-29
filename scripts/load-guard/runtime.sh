#!/usr/bin/env bash
# Purpose: sampling, JSON logging, and threshold monitoring for heavy-lock.sh.
# Sourced after wrapper configuration; stop_group owns TERM/grace/drain.
# Streak continuity expires after interval +2s, including clock rollback.
# The monitor runs in a subshell and communicates exit 76 by stop_marker.
elapsed_ge() { awk "BEGIN {exit !(($1 - $2) >= $3)}"; }
ge() { awk "BEGIN {exit !($1 >= $2)}"; }
sample() {
  if [[ -n "${MDPRO_LOAD_GUARD_SAMPLER:-}" ]]; then
    "$MDPRO_LOAD_GUARD_SAMPLER" 2>/dev/null || echo unreadable
  elif [[ "${MDPRO_GUARD_TEST:-}" == 1 ]]; then
    echo "1 0 16"
  else
    python3 "$GUARD" sample
  fi
}
read_sample() {
  local output
  output="$(sample)"
  sample_time="$(python3 "$GUARD" clock)"
  read -r pressure busy free_gib sample_group_cpu vm_free_gib memory_level <<<"$output"
  if [[ -n "${vm_free_gib:-}" && -z "${memory_level:-}" ]]; then
    memory_level="$vm_free_gib"
    vm_free_gib="$sample_group_cpu"
    sample_group_cpu=""
  fi
  raw_pressure="$pressure"
  [[ "$pressure" == unreadable && -n "${sample_group_cpu:-}" ]] && raw_pressure="$sample_group_cpu"
  [[ "$pressure" =~ ^[124]$ && "$busy" =~ ^[0-9]+([.][0-9]+)?$ && "$free_gib" =~ ^[0-9]+([.][0-9]+)?$ ]] || { pressure=unreadable; busy=unreadable; free_gib=unreadable; }
  [[ "${sample_group_cpu:-}" =~ ^[0-9]+([.][0-9]+)?$ ]] || sample_group_cpu=""
  [[ "${vm_free_gib:-}" =~ ^[0-9]+([.][0-9]+)?$ ]] || vm_free_gib=unreadable
  [[ "${memory_level:-}" =~ ^[0-9]+$ ]] || memory_level=unreadable
}
log_guard() { MDPRO_LOAD_GUARD_RAW_PRESSURE="${raw_pressure:-}" python3 "$GUARD" log "$1" "$2" "$pressure" "$busy" "$JOB_CMD" "$PWD" "$free_gib" "$vm_free_gib" "$memory_level"; }

sample_continues() {
  [[ -n "$1" ]] && awk "BEGIN {d=$sample_time-$1; exit !(d >= 0 && d <= $SAMPLE_TOLERANCE)}"
}

monitor() {
  local memory_streak=0 cpu_streak=0 cpu_busy_sum=0 cpu_group_sum=0 cpu_logged=0 group_cpu previous_sample=""
  while group_alive; do
    sleep "$SAMPLE_SECS"
    group_alive || break
    read_sample
    if ! sample_continues "$previous_sample"; then
      memory_streak=0; cpu_streak=0; cpu_busy_sum=0; cpu_group_sum=0; cpu_logged=0
    fi
    previous_sample="$sample_time"
    if [[ "$pressure" == 4 ]]; then memory_streak=$((memory_streak + 1)); else memory_streak=0; fi
    if [[ "$busy" != unreadable ]] && awk "BEGIN {exit !($busy > 95)}"; then
      cpu_streak=$((cpu_streak + 1))
      group_cpu="${sample_group_cpu:-$(python3 "$GUARD" group-cpu "$child")}"
      cpu_busy_sum="$(awk "BEGIN {print $cpu_busy_sum + $busy}")"
      cpu_group_sum="$(awk "BEGIN {print $cpu_group_sum + $group_cpu}")"
    else
      cpu_streak=0; cpu_busy_sum=0; cpu_group_sum=0; cpu_logged=0
    fi
    if ((cpu_streak >= 3)) && ! awk "BEGIN {exit !($cpu_group_sum > $cpu_busy_sum * .8)}"; then
      if ((cpu_logged == 0)); then log_guard warn cpu; cpu_logged=1; fi
    fi
    if ((memory_streak >= 2)) || { ((cpu_streak >= 3)) && awk "BEGIN {exit !($cpu_group_sum > $cpu_busy_sum * .8)}"; }; then
      local reason=cpu
      ((memory_streak >= 2)) && reason=memory
      log_guard stop "$reason"
      stop_group
      touch "$stop_marker"
      break
    fi
  done
}
