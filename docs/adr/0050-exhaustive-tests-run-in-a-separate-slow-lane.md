# 0050. Exhaustive tests run in a separate slow lane

**Status**: Proposed (2026-10-07)

## Context

The tdd-guardian `unit` lane runs the whole Vitest suite with coverage on every
`taskCompleted` and `commit`. On 2026-10-07 (4439 tests, coverage on), 11 tests
took 2 s or more and 24 took 1 s or more. The 2 s group falls into two kinds:

- **Exhaustive, property and cost enumerations** from the D12 table work. These
  sweep every offset of a 400-document corpus through both line adapters, or a
  50,000-row cost document: CAO-6 (5.5 s), LOC-2 (4.9 s), the CONF
  capture/locate twins (5.2 s), CUR-1 (3.8 s), CUR-3 (2.5 s) and REUSE-1
  (2.4 s). They are slow by construction. They pin laws whose failure modes are
  also covered, at fixture scale, by faster cases in the same suites.
- **Others.** These are the `useMenuEvents` A9 random-lifecycle property
  (9.4 s), the D3 logging sweep (8.5 s), and three `wysiwyg-edit-persistence`
  real-Milkdown integration cases (2.1–5.0 s).

Under worker contention these run past Vitest's 5 s default, so their files
carry per-test or per-file timeout overrides. Removing the eight enumeration
tests did not move coverage: it stayed at 73.96 / 91.43 / 80.97 / 73.96 against
thresholds of 73 / 91 / 80 / 73. They add CPU and contention to every commit
without adding any line the gate measures.

## Decision

A test belongs to the slow tier when it takes **≥ 2,000 ms under the
coverage-instrumented unit run** (40% of the default timeout, the point where
contention starts producing timeout verdicts) **and** it is an exhaustive,
property or cost enumeration.

- Slow tests live in `tests/**/*.slow.test.{ts,tsx}`. `vitest.config.ts`
  excludes that glob, so no list has to be maintained.
  `vitest.slow.config.ts` collects only that glob, with a 180 s timeout and no
  coverage thresholds. The commands are `pnpm test:slow` and the tdd-guardian
  lane `slow` (`gateOn: ["push", "manual"]`, coverage `none`, via
  `scripts/heavy-lock.sh`).
- Moved whole: `source-table-span-reuse`, `source-table-cursor-cost` and
  `source-table-relocate-cost` (all cost or property files).
- Split, keeping the fixture-level cases in the unit file: CAO-6
  (`table-cell-at-offset`), LOC-2 (`table-locate`) and the capture/locate twins
  (`table-line-source-conformance`). The split halves share their domain
  through `tests/support/tableOffsetDomain.ts`, never through a copy.
- Stay in the unit lane: D3, because D4 asserts over every log line in its file,
  D3's included, so splitting it would change D4's domain. Also
  `wysiwyg-edit-persistence`, a data-loss integration guard, not an enumeration.
  A9 stays too: its `vi.hoisted` / `vi.mock` harness cannot be shared without
  duplicating about 270 lines, and it remains the largest single cost.

Measured after the change: the unit lane runs 318 files and 4414 tests at
101.5 s wall, and coverage is unchanged (lines 73.96, branches 91.42, functions
80.97, statements 73.96; `linkSafety`, `useMilkdownLinkClickGuard` and
`headingCoordination` at 100% lines and branches). The slow lane runs 6 files
and 25 tests in 4.9 s wall (13.9 s of test time). Together that is the original
4439 tests.

## Consequences

- **Slow tests no longer gate every commit.** A change that breaks only an
  exhaustive law can be committed green. It is caught at push, or on a manual
  `pnpm test:slow`, not at the commit that introduced it. The fixture-level
  cases left in each unit file narrow the gap but do not close it.
- The wall-time gain on the unit lane is modest, about 4 s, because the
  slowest file (A9) stays. The bigger gain is about 20% less summed test CPU
  per commit, which matters most when several sessions share the machine.
  Measured wall times varied by more than 15 s between runs depending on load.
- The slow lane does not contribute coverage. If a future slow test becomes the
  only cover for some line, the unit lane will fail its threshold. That is the
  intended signal to move the test back or add a fast case, not to merge
  coverage.
- `.slow.test.ts` is a naming contract. Renaming a file into or out of the
  tier silently changes which gate runs it.
- Moving a test is a judgment call against a measured number. The ≥ 2 s figure
  is machine-dependent and will drift.
