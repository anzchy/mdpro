# 0150. Heavy and GUI runs exclude each other, and a load guard stops a job under memory or CPU overload

## Status

**2026-10-29: partially superseded** (decisions 2, 3 (CPU clause) and 4 (vitest worker cap)) by [ADR-0151](0151-heavy-jobs-are-admitted-against-a-memory-budget-and-cpu-stops-only-the-job-that-causes-it.md).

**Accepted, 2026-10-29. Decided by the user**, recorded by herdr-delegator (Claude route), with picsee-delegator's
agreement. The user's words:
- the requirement: 「你和picsee商量一个方法，不能同时跑GUI test或者全量的unit lane，跑测试的时候，实时监控Mac Mini的CPU负载情况，一旦超过95%，停下跑测试」;
- the metric: 「CPU busy % (Recommended)」 (total utilisation, sustained over 3 samples);
- the CPU rule as revised with picsee: 「Memory stop + CPU cap (Recommended)」;
- the path: 「Fast: your word + PR audit (Recommended)」: accepted now, the plan review is folded into the implementing
  PR's High-tier audit by both auditors, and rule 12 does not apply (process tooling, no app behaviour);
- the slot: 「Park WI-1」.

Extends [ADR-0135](0135-one-heavy-lock-tool-serves-every-project-queues-in-arrival-order-and-admits-by-memory.md)
(Accepted 2026-10-23, not yet built as D312): its decision 6 (memory admission) is pulled forward into phase 1 here, and
this record adds what it does not have, a stop for a job that is already running.

## Context

- **The crash.** The Mac mini (10 cores, 16 GiB) froze on 2026-10-28 and rebooted at 23:23. `/Library/Logs/DiagnosticReports`:
  Jetsam (memory-pressure kills) every few minutes from 22:01 to 22:32; a WindowServer user-space watchdog timeout at
  22:29; a kernel panic at 23:24, "watchdog timeout: no checkins from watchdogd in 94 seconds".
- **What held the memory.** From 22:01 four `node` processes grew from 3.5 to 4.3 GiB each: the workers of an mdpro vitest
  coverage lane (gpt-imple-1, ADR-0147 WI-1). By 22:30 there were five large `node` processes, about 20 GiB, beside
  picsee's xctest, a `swiftpm-testing-helper` that crashed at 22:26, and `com.apple.Virtualization` (1.3 GiB).
- **What the locks did and did not do.** Locked jobs queued correctly (the WI-1 log shows `heavy-lock still waiting … held
  by pid=5302`). But rule 10 lets unlocked ≤2-worker runs go beside a locked lane, a GUI run holds only
  `~/.cache/desktop-gui.lock`, and neither lock reads CPU or memory, at admission or while a job runs. ADR-0135's memory
  admission would have delayed a start but would not have stopped a lane that grew after starting.
- **CPU alone would not have caught it.** With 4–5 workers on 10 cores the machine ran out of memory, not CPU. A healthy
  Swift or xcodebuild compile also keeps every core above 95 % for minutes, so a bare CPU stop would kill normal builds
  (picsee-delegator, 2026-10-29).

## Options considered

1. **CPU stop only, exactly as first stated.** Lost: it misses the failure that happened (memory) and stops healthy
   compiles; the user chose option 4 instead.
2. **Build ADR-0135's shared tool (D312) first.** Lost for now: a larger item queued after 0.3.6; every heavy and GUI run
   in both projects is paused until a guard exists. Phase 2 below still builds it.
3. **Wrapper-only guard, no machine-wide backstop.** Lost: picsee implementors sometimes run `swift test` or
   `xcodebuild build-for-testing` directly, and mdpro's partial runs start outside the lock.
4. **One exclusion for heavy and GUI work, memory admission, a runtime memory stop, the CPU rule with capped parallelism,
   and a launchd backstop.** Chosen.

## Decision

1. **One exclusion.** At most one of {full unit lane, `xcodebuild test`/`swift test` lane, `cargo test`, `tauri build`,
   GUI batch} runs on the machine. A GUI run takes the shared heavy lock (`~/.cache/mdpro-heavy.lock`) **and**
   `~/.cache/desktop-gui.lock`, in that order (picsee takes its own flock first), and holds both for the run.
2. **Admission (ADR-0135 decision 6, phase 1 form).** Holding the lock, the wrapper reads
   `kern.memorystatus_vm_pressure_level` before it starts the job: 1 starts; 2 waits up to 5 min, then starts with a
   logged warning; 4 waits and never starts; the wrapper's existing deadline exits 75.
3. **Runtime stop.** While the job runs, the wrapper samples every 5 s:
   - **memory:** pressure level 4 for **2 consecutive samples**;
   - **CPU:** total busy % (100 − idle) above **95 % for 3 consecutive samples**.

   Either stops the job: TERM to its process group, KILL after the existing grace, lock released after the group exits
   (D75 unchanged). The wrapper exits **76** ("stopped by load guard"), distinct from 75 (lock timeout), and logs one
   JSON line to `~/.cache/load-guard.log` (time, project, job command, cwd, the readings, the reason). Callers report
   exit 76 as stopped, never as a test failure or a pass.
4. **Capped parallelism, so a healthy job stays under the CPU rule.** mdpro's locked vitest lane runs at most cores − 2
   workers, lower if the phase-1 measurement (decision 7) shows a worker's resident memory times the worker count can
   exceed physical memory; `cargo` gets `-j` cores − 2. picsee passes cores − 2 to `swift -j` and `xcodebuild -jobs`.
5. **Unlocked runs are guarded too.** mdpro's ≤2-worker RED/GREEN runs (rule 10) go through the same guard without the
   lock (`scripts/heavy-lock.sh --guard-only`), and do not start while the pressure level is 4.
6. **Machine-wide backstop.** One launchd agent, owned by mdpro (`scripts/load-guard/`), applies decision 3's thresholds to
   jobs started outside either wrapper. It may TERM only test-runner process groups (vitest workers, xctest,
   swift-testing helpers, `cargo test` binaries); never a build, signing, `Picsee.app` (any copy), an agent, an editor or
   a GUI app. It logs to the same file. Both repos document it.
7. **Measure once.** The implementing item runs one full mdpro coverage lane with per-worker resident memory sampled, and
   records the peak per worker and in total, to set decision 4's worker cap and whether a per-worker heap limit is needed.
8. **Phase 2.** D312's shared heavy-lock tool (ADR-0135) absorbs decisions 1–5 when it is built; until then the two repos'
   wrappers carry them, mirrored by picsee from mdpro's diff.
9. **The pause ends** when the mdpro wrapper and backstop have landed and picsee's mirror is in place, each project
   confirming to the other.

## Consequences

- **Gained.** Last night's sequence cannot repeat silently: a growing lane is stopped at critical memory pressure before
  Jetsam reaches WindowServer, a GUI run never overlaps a heavy lane, and every stop leaves a readable log line.
- **Costs.**
  - A stopped lane loses its run; a long job may be stopped repeatedly on a busy machine and need a rerun at a quiet time.
  - Capped parallelism makes the full lanes and picsee's builds slower.
  - A GUI batch now blocks every heavy lane in both projects for its length; picsee will keep probes short and split.
  - The backstop is a long-running process with kill rights over test runners: a wrong match could stop a legitimate
    run. Its allowlist is the only thing between it and the user's apps, so the PR audit reads it as a security surface.
  - Two hand-mirrored wrappers can drift until phase 2.
  - The plan review is folded into the PR audit, so a design flaw is found later than a separate review would find it.
