# 0128. The coverage gate runs in CI, and the verifier stops repeating the full lane

**Status**: Accepted (2026-10-21, by the user after review rounds 1–3: 「Accept with the r3 fixes (Recommended)」). Partially superseded: Decision 1 (single unsharded job) and Decision 3's CI half (single report) by [ADR-0130](0130-ci-coverage-runs-in-shards-workers-follow-load-and-test-timeouts-are-liveness-bounds.md) (2026-10-21). Partially supersedes:
- [ADR-0125](0125-frontend-red-receipts-run-one-validated-test-file-not-the-full-coverage-lane.md)
  Decision 5, the clause "the verifier's full re-run on the SHA";
- [ADR-0095](0095-pull-request-ci-is-a-landing-gate.md) Decision 1 (the frontend job's command)
  and Decision 7 ("no check moves into the PR run"), for the coverage gate only.

Every other clause of both stays.

## Context

The user asked (2026-10-21) whether running `pnpm test:heavy` for every landing is best practice,
then asked for this record: 「把『覆盖率门禁移到 CI、本地少跑一遍』写成 ADR 草稿，然后交给 auditor
review，看看是否是最佳实践」.

How a frontend landing is tested today:

| Where | What runs | Coverage | When |
|---|---|---|---|
| Implementor, local | `scripts/heavy-lock.sh pnpm -s test:heavy` (all files) | yes | once before the handoff (rule 10) |
| `mdpro-landing-verifier`, local | the same lane, again, in `verify-<sha7>` | yes | once per handoff and per fix round (ADR-0125 Decision 5 keeps it) |
| CI `frontend (ubuntu-latest)` | `pnpm test:run` (`.github/workflows/ci.yml:107`) | **no** | on the PR; `ci-gate` is required (ADR-0095) |

So coverage is checked only locally. The critical-path thresholds (three files at 100 % lines and
branches in tdd-guardian's `config.json`) are checked only by the local plugin, and the verifier
never reads them: it judges a lane by its exit code.

Both reviewers judged the direction to be general good practice: one authoritative, reproducible
pre-merge run on a clean runner, plus local feedback for the author. They named three facts that
make today's CI **not** equivalent to the local run:
- **19 test files skip on CI.** 14 of them need the tdd-guardian plugin installed under
  `~/.claude/plugins/cache`, for example `tests/tooling/red-receipt.test.ts:11–16`; together they
  are ADR-0125's whole receipt-gate suite. 5 more are macOS-only (`tests/support/buildMacHarness.ts:44`,
  and the `procfacts` files). They pass silently. `scripts/tdd/**` is outside coverage `include`
  (`vitest.config.ts:46`), so no coverage number drops either.
- **CI checks out the PR's merge commit** by default, not its head.
- **The verifier and the audits are dispatched together**, and CI finishes after the verifier. A
  verifier that waited on CI would block every first round.

The evidence on the day: PR #518's verifier run (`7367a22a`) failed the local lane twice with
`[vitest-worker]: Timeout calling "onTaskUpdate"`. All tests passed, at a machine load of 16. CI's
`frontend` job passed the same tree.

## Options considered

- **A. CI runs the coverage gate; the verifier runs only what CI cannot.** (Proposed, below.)
- **B. Keep today's split.** It costs nothing to change, but leaves the duplicated local run and
  the local-only critical-path check.
- **C. Move every full run to CI, the implementor's included.** Lost: a Codex implementor cannot
  push, so its first full-suite feedback would come after an audit had started.
- **D. Add coverage to CI and keep both local runs.** The safest, and the most expensive. Lost:
  it adds load, the opposite of what was asked.
- **A′. A, with the tdd-guardian plugin pinned and installed in CI**, so nothing skips. Not chosen
  now: the plugin is not a package dependency, and installing a user-cache plugin on a hosted
  runner is unproven. It stays open as a later replacement for Decision 3.

## Decision (proposed)

1. **CI runs the coverage gate.** `.github/workflows/ci.yml`'s `frontend` job:
   - checks out the PR **head** SHA explicitly;
   - runs `pnpm exec vitest run --coverage`;
   - then runs a checked-in, tested checker that applies `config.json`'s `criticalPaths` to
     `coverage/coverage-summary.json`.

   The checker **fails closed**: on a missing or malformed summary, on a glob that matches no
   file, or on any metric below its threshold. Either step failing fails `ci-gate`. A prose-only
   green (ADR-0095 Decision 2) stays an exemption, not coverage evidence.
2. **The verifier does not read CI.** `ci-gate` green on the PR head stays the delegator's own
   third landing condition (rule 70 item 2). From now on that condition includes coverage. The
   verifier's PASS means "every local check passed".
3. **The verifier runs locally only what CI cannot run, and both halves prove execution per
   test.**
   - **The unit is the test, not the file.** Vitest 3.2.4's JSON reporter marks a file `passed`
     even when some or all of its tests were skipped. Only `assertionResults[].status` shows
     `skipped`, which covers `skipIf` and a runtime `ctx.skip()`. A file counts as having a skip
     when any of its tests has status `skipped`. `todo` is ignored. A test left uncollected
     counts as missing, not as passed.
   - **The inventory** is a checked-in list of test ids. An id is the array
     `[file, ...ancestorTitles, title]`, never a joined string, and both comparators reject a
     duplicate id. Each entry is tagged with its prerequisite:
     - the tdd-guardian plugin;
     - macOS;
     - a local hook token (for example `d177-no-secrets-scan`);
     - rustfmt (`d187-receipt-rustfmt-guard`).

     It also lists the approved exclusions, each with its reason. Gating is allowed only through
     `skipIf`, `runIf` or `ctx.skip()`, so that a gated test is always collected. A small lint
     rejects a test registered conditionally, such as `if (plugin) it(…)`.
   - **The CI half.** The `frontend` job writes a fresh JSON test report beside the default
     reporter (`--reporter=default --reporter=json --outputFile=…`). It is a step of that job, so
     `ci-gate` already depends on it.
     - Each matrix leg first computes its **runner profile**: which prerequisites this runner has.
       For example, the Ubuntu PR leg has none of the four, and the macOS leg on a `v*` tag has
       macOS.
     - From that, a leg expects an inventory test to **skip** only when its prerequisite is
       missing on that runner, and expects it to **run and pass** when its prerequisite is
       present.
     - A checked-in comparator then fails the leg on any of these:
       - a missing or malformed report, or a partial one, meaning a test still `pending`
         (running or queued);
       - any `skipped` test not expected to skip on this profile;
       - any inventory test that passed on a profile that lacks its prerequisite, because the
         entry is then stale.
   - **The local half.** The verifier runs every inventory file under heavy-lock, without
     coverage, with the JSON reporter, after checking that each prerequisite is present. A
     missing prerequisite is a failure, not a skip. The verifier's comparator then fails on any of
     these:
     - an inventory test that was not collected;
     - an inventory test that was skipped or failed;
     - a report that is missing or malformed.

     The verifier also runs:
     - the decisive files for the change;
     - typecheck and build;
     - the receipt checks;
     - `ledger:check`;
     - the rust lanes when `src-tauri/` changed.

   **The invariant:** every test executes and passes on at least one of CI and the verifier, or
   is an approved exclusion.
4. **The verifier's full lane is retired only after a parity proof**, on the rollout SHA, in tests
   of both comparators and in one real run of each:
   - a comparator matrix test: an inventoried macOS test that skips on the Ubuntu profile and
     passes on the macOS profile is accepted in both, and an unexplained skip fails in both;
   - an unlisted `it.skipIf(true)` added to a file that otherwise runs on CI makes CI fail;
   - a duplicate id, and a conditionally registered test, each make the check fail;
   - a runtime `ctx.skip()` that is not in the inventory makes CI fail;
   - a missing or malformed report makes each comparator fail;
   - an inventory entry whose file is deleted makes the verifier fail;
   - an unavailable prerequisite, for example the plugin path hidden, makes the verifier fail;
   - deliberately breaking one test of each prerequisite group makes the verifier fail;
   - dropping coverage on a critical path makes CI fail;
   - the union of CI's executed tests and the verifier's executed tests, on that SHA, equals the
     full collected set minus the approved exclusions;
   - one real landing shows CI's tested tree equal to the landing tree.

   Until all of these pass, today's full verifier run stays.
5. **Unchanged:**
   - the implementor's single local full run before the handoff (rule 10);
   - receipts and `check-pending`;
   - the rust lanes;
   - the two audits;
   - strict ancestry;
   - heavy-lock for every heavy local command;
   - D196's single rerun in CI.

## Consequences

- **One full local run fewer per landing and per fix round.** It is replaced by a short local
  run of the inventory, about 19 files, and an uncontended coverage verdict.
- **CI gets slower.** Coverage instrumentation adds time to a job that took about 10 minutes on
  PR #518. Its 30-minute timeout needs watching.
- **Coverage is measured on Linux only.** macOS-only branches count as uncovered there. Today's
  margin (93.17 % branches against 91) absorbs that, but a close call can now fail on CI where it
  passed locally.
- **New repo code to maintain:** the critical-path checker and two inventory comparators (CI and
  verifier), each with its own tests, plus the inventory itself. A new plugin-gated, macOS-only
  or token-dependent test must be added to the inventory, or CI fails. A test that starts
  running on CI must leave the inventory, or CI fails.
- **A CI outage blocks landing**, as it already does under ADR-0095. Nothing new is lost there.
- **Rules 10 and 70 and `.claude/agents/mdpro-landing-verifier.md` change** in the rollout commit,
  with forward links added to ADR-0125's and ADR-0095's Status lines.
- ADR-0125's safety net ("the full lane at handoff and the verifier still catch it") now rests on
  three things: the implementor's run, CI's full run, and the verifier's inventory run.
