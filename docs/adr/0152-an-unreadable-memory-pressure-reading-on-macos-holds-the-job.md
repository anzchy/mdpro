# 0152. An unreadable memory-pressure reading on macOS holds the job

## Status

**Accepted, 2026-10-29. Decided by the user**, recorded by herdr-delegator (Claude route), on picsee-delegator's
proposal. The user's words: 「Split by OS (Recommended)」. **Partially supersedes**
[ADR-0135](0135-one-heavy-lock-tool-serves-every-project-queues-in-arrival-order-and-admits-by-memory.md) decision 6's
"Unreadable (any non-macOS host, CI included): start, with a logged note", for macOS hosts only. It applies to the
load guard of [ADR-0150](0150-heavy-and-gui-runs-exclude-each-other-and-a-load-guard-stops-a-job-under-memory-or-cpu-overload.md)
and [ADR-0151](0151-heavy-jobs-are-admitted-against-a-memory-budget-and-cpu-stops-only-the-job-that-causes-it.md).

## Context

- `kern.memorystatus_vm_pressure_level` returns the libdispatch constants NORMAL 1, WARN 2, CRITICAL 4 (SDK
  `dispatch/source.h`). It exists on every macOS host; on Linux, including CI's runners, it does not.
- ADR-0135 starts a job on an unreadable reading everywhere, so CI is never blocked. On the Mac mini, though, an
  unreadable or unexpected value means the sampler is broken, and starting blind is how a guard fails open on the one
  machine it exists to protect.
- picsee-delegator proposed treating any unreadable value as WARN everywhere; that would hold every CI lane on Linux to
  its deadline and fail it with 75.

## Options considered

1. **Keep ADR-0135: start with a note everywhere.** Lost: fails open on the mini.
2. **Treat unreadable as WARN everywhere** (picsee's wording). Lost: blocks CI on Linux.
3. **Split by OS.** Chosen.

## Decision

1. **On macOS (Darwin),** a reading that is missing, unparseable, or not 1, 2 or 4 is treated as WARN: the job does not
   start; the wrapper waits and, at its deadline, exits 75 without running it. Each such sample logs one line with
   `pressure=unreadable` and the raw value. A running job is not stopped on an unreadable sample alone.
2. **On any other OS,** an unreadable reading starts the job with one logged note, as ADR-0135 decision 6 says.
3. Both wrappers (mdpro and picsee) behave the same way.

## Consequences

- **Gained.** A broken sampler on the mini holds heavy work instead of letting it run unguarded.
- **Costs.** A sampler fault on the mini stops all heavy work in both projects until someone fixes it; the log line is
  the only signal, so the deadline exit 75 must be read as "check the sampler", not as a busy machine.
