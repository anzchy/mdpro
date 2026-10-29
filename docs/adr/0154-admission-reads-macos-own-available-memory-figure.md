# 0154. Admission reads macOS's own available-memory figure

## Status

**Accepted, 2026-10-29. Decided by the user**, recorded by herdr-delegator (Claude route). The user's words:
「macOS's own estimate (Recommended)」, after asking 「Cached file 是否可以回收，当前Mac Mini主要是哪些进程/app站有」.
**Partially supersedes** the free-memory formula (free + inactive + purgeable from `vm_stat`) in
[ADR-0151](0151-heavy-jobs-are-admitted-against-a-memory-budget-and-cpu-stops-only-the-job-that-causes-it.md) decision 1
and [ADR-0153](0153-admission-needs-the-jobs-own-budget-plus-one-gib-free.md) decision 1. Their budgets, the 1 GiB
margin and the placeholders stand.

## Context

- On 2026-10-29 the guard's formula read about 5.2 GiB free on a healthy machine (pressure 1, swap 0, Activity Monitor
  green), below ADR-0153's 6 GiB for the vitest lane, so the measured run could not start.
- `vm_stat` showed 4.35 GiB of file-backed pages: about 1.3 GiB mapped into running processes (Google Chrome 735 MB, each
  Claude Code session 35–46 MB, each Codex about 35 MB) and about 3 GiB of unmapped cache of recently read files. Clean
  file cache is dropped without I/O when memory is needed; the formula counted only part of it.
- `kern.memorystatus_level` (printed by `memory_pressure` as "System-wide memory free percentage") read 68–71 %, about
  11 GiB of 16. It is the kernel's own estimate of available memory, the figure its pressure levels and Activity Monitor's
  gauge are built on, and it counts reclaimable cache.
- The 2026-10-28 crash came from anonymous memory (node heaps), which cache-dropping cannot free; the runtime stop on
  pressure 4 (ADR-0150 decision 3) and the heap caps (ADR-0151 decision 3) cover that.

## Options considered

1. **Keep the `vm_stat` formula.** Lost: it refuses jobs on a green machine.
2. **Add file-backed and speculative pages to the formula.** Lost: our own approximation of a number the kernel already
   computes.
3. **Read `kern.memorystatus_level`.** Chosen.

## Decision

1. On macOS, available memory is `kern.memorystatus_level` (an integer percentage) × `hw.memsize`. A job is admitted when
   the pressure level is 1 **and** available ≥ its budget + 1 GiB.
2. A missing, unparseable or out-of-range (not 0–100) `kern.memorystatus_level` is treated like an unreadable pressure
   reading under ADR-0152: no start on macOS, logged as `available=unreadable`.
3. Non-macOS hosts are unchanged (ADR-0152 decision 2).
4. Every admission, stop and warn log line records the level, the computed GiB, and the `vm_stat` free + inactive +
   purgeable figure beside it, so the two can be compared over time.

## Consequences

- **Gained.** Admission agrees with what the user sees in Activity Monitor and with the kernel's own pressure logic; a
  healthy machine admits one heavy lane.
- **Costs.** The kernel's figure counts cache that a busy job may need to read back, so a job admitted at the margin can
  slow the machine by evicting cache; the runtime stop on pressure 4 remains the backstop. The figure is an undocumented
  sysctl whose meaning could change across macOS releases; decision 4's paired logging is how a change would be noticed.
