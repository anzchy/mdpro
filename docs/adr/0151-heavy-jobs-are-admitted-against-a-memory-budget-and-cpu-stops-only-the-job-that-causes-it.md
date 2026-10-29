# 0151. Heavy jobs are admitted against a memory budget, and a CPU overload stops only the job that causes it

## Status

**2026-10-29: partially superseded** (decision 1's "+ 4 GiB headroom" and 9 GiB placeholder) by [ADR-0153](0153-admission-needs-the-jobs-own-budget-plus-one-gib-free.md).

**Accepted, 2026-10-29. Decided by the user**, recorded by herdr-delegator (Claude route), on the delegator's revised
recommendation after a Codex second opinion. The user asked 「根据Fable和Codex的建议，你对之前的Memory cap和 CPU test cap有啥更新建议」
and chose 「Adopt all (Recommended)」 for memory and 「Attribute before stopping (Recommended)」 for CPU. The Fable
best-practice survey had not returned when the user ruled; if it contradicts a clause, a later record says so.

**Partially supersedes** [ADR-0150](0150-heavy-and-gui-runs-exclude-each-other-and-a-load-guard-stops-a-job-under-memory-or-cpu-overload.md)
decisions 2 (warn-level admission), 3 (the CPU clause) and 4 (the vitest worker cap), and
[ADR-0135](0135-one-heavy-lock-tool-serves-every-project-queues-in-arrival-order-and-admits-by-memory.md) decision 6's
"Warn (2): … then start with a logged warning". Everything else in ADR-0150 stands: the exclusion, the pressure-4
runtime stop, exit 76, the log, the backstop, the measurement, the phases.

## Context

- **cores − 2 is wrong for vitest.** ADR-0150 decision 4 caps parallelism at cores − 2, which is 8 on the 10-core mini.
  At about 3 GiB per vitest coverage worker that is about 24 GiB, above the 16 GiB of physical memory. It is right for
  picsee's compiles, whose cost is CPU, not memory.
- **The 2026-10-28 evidence.** Four `node` processes held 3.3 → 4.3 GiB each for 30 minutes with stable PIDs, started
  after 13:49. Vitest's `forks` pool with default isolation replaces a worker after every file
  (`createForksPool` sets `isolateWorkers`), so stable PIDs fit vitest main processes aggregating coverage, or another node
  service, better than per-file workers. The reports name no command line, so which program they were is unknown.
- **Codex's review (2026-10-29, read-only):**
  - large build systems (Bazel resource flags, Buck2, Microsoft BuildXL/CloudBuild) declare a CPU and memory budget per
    action and admit against it, with bounded parallelism and sharding, rather than react to one machine-wide percentage;
  - Vitest's plain `forks` pool has no memory-based worker recycling like Jest's `workerIdleMemoryLimit`;
    `poolOptions.forks.execArgv` reaches the workers, so `--max-old-space-size` caps each worker's V8 heap (not its
    resident memory);
  - starting a job after five minutes at warn pressure is risky on this machine;
  - whole-machine CPU above 95 % on a 4P + 6E machine shared by two projects is often caused by another job, so stopping
    the guarded job on it stops the wrong one.

## Options considered

1. **Keep ADR-0150 as accepted.** Lost: its vitest cap admits more memory than the machine has, and its CPU stop can kill
   a healthy job for another job's load.
2. **CPU for admission only** (offered to the user). Lost to option 3: it leaves a runaway guarded job running on CPU
   alone.
3. **Memory budgets at admission, a memory-derived vitest cap, never starting at warn, and a CPU stop that requires the
   guarded job to be the cause.** Chosen.

## Decision

1. **Per-job memory budgets.** Each heavy job class declares a resident-memory budget: the full vitest coverage lane,
   `cargo test`, picsee's SwiftPM and App xctest lanes, `tauri build`, a GUI batch. Holding the lock, the wrapper admits a
   job only when free memory (free plus inactive plus purgeable, from `vm_stat`) is at least the budget plus **4 GiB**
   headroom, and the pressure level is 1. The first budgets come from ADR-0150 decision 7's measured run (peak plus 20 %);
   until measured, the vitest coverage lane's budget is 9 GiB.
2. **Warn pressure never starts a job.** At pressure 2 the wrapper keeps waiting; at its deadline it exits 75 without
   running the job. This replaces ADR-0135 decision 6's start-after-five-minutes rule and ADR-0150 decision 2's copy of it.
3. **The vitest worker cap is set by memory, not cores.** The locked full lane runs **2 workers** by default, raised to at
   most 3 only when the measured peak per worker times the count, plus the main process, fits decision 1's budget. Each
   worker runs with `poolOptions.forks.execArgv: ["--max-old-space-size=2048"]`. A worker that exceeds it fails its file,
   which is reported as a failure, not passed over. The main process's resident memory is sampled and logged with the
   workers'. picsee's cores − 2 (`-j 8`, `-jobs 8`) stands.
4. **CPU: attribute before stopping.** Whole-machine CPU busy above 95 % for 3 consecutive samples:
   - always pauses new admissions and writes a log line;
   - stops the guarded job only when its own process group accounts for more than **80 %** of the busy CPU over those
     samples (summed `ps` CPU of the group against the machine total);
   - otherwise logs the top consumers (ADR0150-WI1 addendum 2's snapshot) and leaves the guarded job running. The
     backstop still applies its allowlist to unregistered test runners.
5. **After an exit 76.** No immediate retry. A caller records it as an infrastructure stop, never a pass or a test
   failure. At most one retry is allowed, after pressure has been 1 for 10 minutes, with fewer workers or a smaller shard.
   A second stop goes to the item's owner and the delegator.

## Consequences

- **Gained.** A job starts only when its measured need fits, the vitest lane can no longer ask for more memory than the
  machine has, and a guarded job is not stopped for another project's load.
- **Costs.**
  - The full lane at 2 workers runs roughly twice as long as at 4 or 5.
  - A 2048 MiB heap limit may fail a large file that ran before; that file then needs splitting, or the limit raising,
    with a measurement.
  - Budgets are numbers to maintain: a job that grows past its budget waits at admission until someone re-measures it.
  - Waiting at warn pressure may hold heavy work back for long stretches on a busy day.
  - CPU attribution needs a per-group CPU sum every sample, which adds cost to the sampler; a job whose load sits in a
    child outside its process group is not attributed to it.
