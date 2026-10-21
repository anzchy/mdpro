# 0130. CI coverage runs in shards, workers follow load, and test timeouts are liveness bounds

## Status

Accepted, 2026-10-21. Decided by the user, recorded by herdr-delegator. The user's words:
「直接采纳分片，才外：worker 数随负载调整，超时只判断是否卡死，并把用到的时间上限集中定义在一处，这三个也借鉴到我的里面」.

It partially supersedes
[ADR-0128](0128-the-coverage-gate-runs-in-ci-and-the-verifier-stops-repeating-the-full-lane.md):
- Decision 1, which has one `frontend` job run `vitest run --coverage` and then the checker;
- Decision 3's CI half, where it assumes a single JSON report.

Every other clause of ADR-0128 stays, including the parity proof and the invariant.

The rule 10 clause "an unlocked partial run takes at most 2 workers" (D147, user decision
2026-10-11) stays as a ceiling. Decision 2 below only lowers the count beneath it.

## Context

The user asked how xiaolai/vmark runs its heavy tests (2026-10-21):
「看看xiaolai vmark中关于 pnpm heavy test 是怎样的设置，和我的一样吗？」. The comparison, read
from vmark's `main` on GitHub, found three practices that mdpro lacks:

1. **Sharded CI coverage.** vmark's CI splits the suite into 4 shards. Each shard runs
   `vitest run --coverage --shard=N/4` with a blob reporter and all thresholds set to 0. A
   `fe-coverage` job then merges the reports (`vitest --merge-reports --coverage`) and applies the
   real thresholds. Its comment says a serial run took about 22 minutes, and that gating each
   shard alone would fail, because a shard sees only part of the code.
2. **Load-aware workers.** `maxWorkers()` = `max(4, round((cores − loadavg1) × 1.6))`.
3. **Liveness timeouts in one place.** `vitest.shared.ts` defines `LIVENESS_TIMEOUT_MS = 300_000`
   with the note that a test timeout answers "did this hang", not "was this fast". Wait budgets
   live in one module, sized by measurement.

mdpro today:
- ADR-0128 is moving coverage into CI's `frontend` job as a single unsharded run. Its rollout,
  with gpt-imple-1, is in flight. ADR-0128's own consequences say CI gets slower against a
  30-minute timeout.
- Workers are fixed: 2 outside `heavy-lock.sh` and `50%` inside it (`vitest.workers.ts`, D147).
- Test timeouts are scattered. 75 files under `tests/` carry their own literals, from 10 s to
  120 s (most often `timeout: 60_000`, 27 times, and `}, 15_000);`, 18 times). The default
  `testTimeout` is Vitest's 5 s. The slow config has its own constant, and the perf config has a
  literal 600 s.

The D302 diagnosis (2026-10-21, `~/.mdpro-redesign/herdr-spike/gpt-imple-1/D302-diagnosis.md`)
matters to Decision 2. Under ten CPU burners the `onTaskUpdate` timeout still occurred **with one
worker**, and the worker was blocked in synchronous child-process spawns. Load-aware workers
therefore reduce contention but do not fix D302.

Before the user's ruling, the delegator had recommended waiting for ADR-0128's measured CI time
before sharding. The user chose to adopt sharding directly.

## Options considered

- **A. Copy vmark exactly**, with a floor of 4 workers and an oversubscription ratio of 1.6.
  Lost: mdpro shares one machine across several sessions. A floor of 4 and an oversubscribed
  count would raise load, which is the opposite of D147.
- **B. Adopt all three, adapted to a shared machine.** Workers may only go down from today's
  ceilings. (Chosen.)
- **C. Shard only once CI nears its timeout.** This was the delegator's recommendation. Lost: the
  user ruled to adopt it now.
- **D. Shard with a threshold per shard.** Lost: each shard measures only part of the code, so
  the gate would fail falsely. Lowering the thresholds to compensate would weaken the gate.

## Decision

1. **CI coverage runs in shards and is gated once, after merging.**
   - The PR leg of the `frontend` job runs as N shards, starting at N = 4. Each shard runs
     `vitest run --coverage --shard=<i>/<N>`, writes a blob report and a JSON test report, and
     gates nothing on coverage.
   - One merge job then:
     - merges the blob reports and applies the coverage thresholds;
     - runs ADR-0128's critical-path checker on the merged summary;
     - runs ADR-0128's CI comparator on the **union** of the shard JSON reports. A test missing
       from every shard counts as missing, and a test reported by two shards is a duplicate and
       fails.
   - `ci-gate` needs the merge job. A shard that fails, or a shard whose report is missing,
     fails the merge job.
   - The macOS `v*` tag leg follows the same rule, or stays unsharded. The rollout brief decides
     which, by measurement.
   - The parity proof of ADR-0128 Decision 4 is re-run on the sharded job. Its union-equals-
     collected-set check is the one that proves no test was dropped between shards.
2. **Worker count follows load, downward only.** `vitest.workers.ts` computes
   `free = max(1, cores − loadavg1)` and returns `min(ceiling, round(free))`. The ceiling is
   today's value: 2 outside the lock, `50%` of the cores inside it. An explicit
   `VITEST_MAX_WORKERS` still wins. The chosen count and the load it was computed from are logged
   at the start of each run, so that a slow or failed run can be read against them. CI runners
   are unshared, so CI keeps whatever count its job sets.
3. **A test timeout is a liveness bound, and every time bound lives in one module.**
   - One module under `tests/support/` defines:
     - the liveness `testTimeout` and `hookTimeout`, which all three configs import;
     - the named wait budgets that tests use for slow imports, child processes and polling.
   - Values are set by measurement in the rollout, not copied from vmark's 300 s.
   - Numeric timeout literals in `tests/**` are replaced by those names. A lint rejects a new
     literal, and the module itself is the only exception.
   - A test timeout never asserts speed. A speed claim belongs in `tests/perf/`, which keeps its
     own thresholds as named constants in the same module.
   - Vitest's RPC timeouts (birpc's `onTaskUpdate`) are not test timeouts. They stay untouched,
     as D302's Amendment 2 requires.
4. **Order.** The rollout starts after ADR-0128's rollout and D302 have landed, because it
   edits the same files: `ci.yml`'s `frontend` job, the comparators and the vitest configs. Its
   brief is reviewed as a plan (rule 70 item 4) before the grant. Rules 10 and 70 and the landing
   verifier's agent file change in its last commit.

## Consequences

- **Faster CI feedback.** The PR's coverage verdict arrives in roughly the time of the slowest
  shard plus the merge, instead of the whole suite.
- **Cost: more CI jobs.** Each shard repeats checkout, `pnpm install`, Vite transforms and setup,
  so total runner minutes rise. The repository is public, so standard GitHub-hosted runners cost
  nothing. Each PR holds about 5 jobs at once, against the account's concurrency limit (about 20
  on the Free plan). If the repository turns private, these minutes are billed.
- **Cost: more gate code.** The comparator must handle several reports, and the merge job is
  one more required link. A misconfigured shard count is a new way for the gate to break. The
  union check is what catches it.
- **Cost: run-to-run variation.** The local worker count now changes with machine load, so two
  runs of the same tree can take different times. The logged count is the mitigation. This does
  not fix D302.
- **Cost: hangs fail later.** A liveness bound longer than today's 5 s default means a genuinely
  hung test takes longer to fail. A test that relied on a short timeout to assert speed loses
  that check, and has to move to `tests/perf/` or lose it.
- **Cost: one large mechanical diff.** 75 test files change. This can disturb recorded receipts.
  Settled receipts on master are not re-checked, but the rollout lists every recorded file it
  touches.
- **Foreclosed:** per-shard coverage thresholds; raising workers above today's ceilings on a
  shared machine; new numeric timeout literals in tests.
