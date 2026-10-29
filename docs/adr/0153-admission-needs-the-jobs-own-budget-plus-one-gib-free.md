# 0153. Admission needs the job's own budget plus 1 GiB free

## Status

**Accepted, 2026-10-29. Decided by the user**, recorded by herdr-delegator (Claude route). The user's words:
「Budget + 1 GiB, smaller placeholders (Recommended)」. **Partially supersedes**
[ADR-0151](0151-heavy-jobs-are-admitted-against-a-memory-budget-and-cpu-stops-only-the-job-that-causes-it.md)
decision 1: its "+ 4 GiB headroom" and its 9 GiB placeholder. The rest of ADR-0151 stands.

## Context

- While implementing ADR-0150 WI-1, the implementor's real sampler read **6.4 GiB** of free + inactive + purgeable
  memory with the agents running (6.3 GiB in the delegator's own `vm_stat` reading the same hour). ADR-0151 admits a job
  only when that figure is at least its budget + 4 GiB, and the vitest placeholder budget is 9 GiB: 13 GiB, which this
  machine never has free. As written, no heavy job could start.
- The 4 GiB was counted twice. ADR-0151's 9 GiB came from "16 GiB − about 4 GiB of agents − about 3 GiB of system",
  so the agents and the OS were already excluded; and the agents' memory is not in the free figure anyway.
- With ADR-0151 decision 3's heap caps, a 2-worker vitest lane is bounded near 2 × 2 GiB of worker heap plus about
  1 GiB for the main process.

## Options considered

1. **Keep 13 GiB** and close agent sessions to free memory. Lost: it stops heavy work whenever the roster is up.
2. **Admit on pressure alone until measured.** Lost: it drops the one check that would have refused last night's state.
3. **The job's own budget plus a 1 GiB margin, with placeholders sized to the caps.** Chosen.

## Decision

1. A job is admitted when the pressure level is 1 **and** free + inactive + purgeable memory is at least **its budget +
   1 GiB**. The 1 GiB is a margin for the sampling interval, not headroom for agents or the OS.
2. **Placeholder budgets until measured:** the full vitest coverage lane **5 GiB** (2 workers × 2 GiB heap cap + about
   1 GiB main process); every other class, mdpro's and picsee's, **4 GiB**. A measured peak + 20 % replaces a placeholder.
3. Measured budgets are recorded in the guard's one budget table (ADR0150-WI1 addendum 3), keyed by class, for both
   projects.

## Consequences

- **Gained.** One heavy job can start on the machine as it normally runs (about 6 GiB free admits a 5 GiB lane); a second
  heavy job, or one started while memory is short, waits.
- **Costs.** The margin is thin: a job whose real peak exceeds its placeholder can still push pressure up, and only the
  runtime stop (pressure 4) catches it; the measured run must come soon. On a day with more agent sessions open, even one
  lane may wait.
