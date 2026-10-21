# 0125. Frontend RED receipts run one validated test file, not the full coverage lane

## Status

Partially superseded (2026-10-21): Decision 5's "verifier's full re-run on the SHA", by [ADR-0128](0128-the-coverage-gate-runs-in-ci-and-the-verifier-stops-repeating-the-full-lane.md), once its parity proof passes.

Accepted, 2026-10-20, by the user: 「Accept, fix Mediums first」. Drafted by herdr-delegator; the
user chose the route 「ADR + tooling item, queued (Recommended)」 after asking 「let codex weigh in
first」. Codex's deliberation is in
`~/.mdpro-redesign/herdr-spike/gpt-auditor/unit-red-lane-deliberation.md`.

Review (rule 71 § Audits under herdr: gpt-auditor and an Opus reviewer, blind, three rounds under
ADR-0120):
- Round 1 raised two Highs, both confirmed on challenge. Nothing tied a GREEN to its RED's
  selection, and stripping ANSI does not make Vitest's summary parseable.
- Round 2 closed both. The Opus reviewer raised a new High: a "one focused receipt pending at a
  time" limit rested on a misreading and could lock verification.
- Round 3 closed it after the limit was dropped: C0 H0 from both.

The open Mediums were then folded in at the user's direction, without a further round: clearing a
stale receipt, the bare manual run, the parser picking an earlier line, the lock, and the missing
verifier test. Reports: `~/.mdpro-redesign/herdr-spike/gpt-auditor/ADR0125-r{1,2,3}.md` and
`ADR0125-challenge.md`.

## Context

`receipt.js record --lane unit --files <f>` runs the whole `unit` lane. That is the full Vitest
suite with coverage, about 800 files, roughly 6 minutes, under the machine-wide heavy lock. `--files`
only chooses which files are fingerprinted; a lane command is a fixed string
(`lib/lanes.js runLane(lane, cwd)`).

On 2026-10-20 this cost became visible:
- With two implementors sharing the lock, one M3b receipt waited about 25 minutes before it ran.
  The user asked why the CLI had been running for 30 minutes.
- Every RED-first acceptance criterion costs one full coverage run.

The receipts this produces are also weak evidence:
- The CLI can't parse counts from a full coverage run, so every recent receipt is
  `opaque-failure` / `weak-red`. The verifier flagged this on M3a and on WI-4.3b.
- tdd-guardian 0.10.2 classifies any non-zero run it can't parse as a valid RED (`exec.js:66-74`,
  `verification.js:57,117-131`).
- So a full run that fails for an unrelated reason, or a run that found no test files, records as a
  RED. Codex confirmed both cases against the installed pure functions.

Rule 10 already says RED→GREEN runs "only the affected files … coverage off", and the full lane
with coverage runs once per commit. The receipt CLI was the exception.

The user asked whether a focused lane is best practice and whether it weakens coverage
(「这个符合相关最佳实践吗？会不会coverage test不太彻底」).

## Options considered

1. **Keep the full `unit` lane for receipts.** This lost.
   - It does have a real strength: its selection can't drift through an environment variable, and
     it is the simplest thing to maintain.
   - But it never proved that the target assertion caused the RED, it accepts unrelated failures,
     and it costs a locked coverage run per AC.
2. **A bare shell lane reading `RED_FILES`.** This was the delegator's first proposal, and it lost.
   - A missing variable (exit 2), or vitest's "No test files found" (exit 1), would both be
     recorded as a valid opaque RED.
   - The GREEN `verify` wasn't bound to the RED's selection.
3. **A tracked tdd-guardian patch** that passes each receipt's id and files to the lane and fixes
   the summary parser. The repo already keeps one such patch,
   `.claude/tdd-guardian/patches/tdd-guardian-0.9.1-exec-counts-and-exit101.patch`, which fixed the
   `todo` segment that turned receipts opaque. It is not reapplied automatically, which is likely
   why receipts went opaque again after the upgrade to 0.10.2. This option lost for that reason:
   an upgrade silently drops it. A repository script survives upgrades, and its rollout tests run
   after each one.
4. **A sanctioned entry script with a validated, selection-bound focused lane (chosen).** These are
   Codex's five conditions, made concrete after review.

## Decision

1. **One sanctioned entry script owns the whole cycle.** A repository script under `scripts/` is
   the only supported way to record or verify a frontend RED. It calls tdd-guardian; tdd-guardian
   does not call it.
   - It requires a receipt id for both `record` and `verify`. It refuses an unscoped `verify`.
   - It takes explicit test files (one per receipt by default; a small reproducing set if needed)
     and validates each as a canonical path under `tests/`. It refuses empty input, whitespace,
     directories, globs, options and slow-tier files. Every check fails with exit 64 before
     anything runs or settles.
   - It hands the validated list to the lane child through a controlled environment variable
     (`exec.js` inherits `process.env`), and to `receipt.js` as the matching `--files`, from one
     variable, so the two cannot diverge.
   - The lane, `unit-red`, runs a lane-child wrapper that keeps the repo's Vitest config and at
     most 2 workers. It runs exactly the files in that variable and checks that each was collected
     and ran tests. Run without that variable (a bare manual gate run, say), it exits 64 with a
     message naming the entry script. That is an environment error, not a red.
   - A focused run is an unlocked partial run under rule 10: at most 2 workers, outside
     `scripts/heavy-lock.sh`. The full lanes keep the lock.
   - **Clearing a stale receipt.** A record that isn't a valid RED (environment or green kind,
     exit 64) is still stored by `receipt.js`. The entry script's `discard --id ID` removes one
     receipt from `receipts.json`, and only when all of these hold:
     - its lane is `unit-red`;
     - it is unsettled;
     - it was recorded on the current branch, not inherited from master.

     It prints what it removed, and the handoff names every discarded id. A settled receipt, or one
     from master, is never discarded.
2. **The RED and the GREEN use the same selection, and nothing else settles.**
   - At `verify --id ID`, the entry script reads that receipt's `test_files` from
     `receipts.json` and uses them as the selection. A selector passed on the command line that
     differs from them is refused with exit 64.
   - Only an id-scoped verify is safe. An unscoped `verify` settles every unsettled receipt whose
     lane name went green (`verification.js` `verifyAll`). `verify --id` narrows the store to that
     one receipt, runs its lane, and writes back only that receipt (`receipt.js:331`, `:342-344`,
     `:360-364`). Refusing the unscoped form (Decision 1) is therefore the whole guard. Other
     pending `unit-red` receipts don't block anything.
   - After `verify`, the entry script reads the target receipt's verdict and exits non-zero unless
     it is `SEPARATION-HELD`.
3. **Only a counted assertion failure is a RED.**
   - Vitest's own summary line does not always parse: `exec.js` needs an `N passed` clause and
     knows no `todo`. So `Tests  2 failed (2)`, a failure with skipped tests, and a failure with
     todo tests all record as `opaque-failure` / `weak-red`, with or without ANSI codes.
   - The lane-child wrapper therefore runs Vitest with its JSON reporter as well, and prints one
     canonical line the installed parser accepts: `Tests  F failed | P passed (T)`, with
     `0 passed` written out when nothing passed. The counts come from the JSON report, never from
     the exit status.
   - The parser takes the first line that matches, so a test's own output could outrank the
     canonical line. The wrapper therefore sends all of Vitest's human output to a log file and
     prints only the canonical line. The log path goes in the handoff.
   - A setup, collection or runner error, an unreadable report, or zero executed tests exits 64.
     That is an environment error, never a RED or a GREEN. Nothing is synthesised for it.
   - The entry script requires the stored RED to be `assertion-failure` with a positive failed
     count. `SEPARATION-HELD` alone is not enough: an opaque RED still settles as HELD.
   - Any change to the plugin itself is a tracked patch, never an unrecorded cache edit.
4. **The lane is manual-only and has no coverage.** It has `gateOn: ["manual"]` and
   `coverage: "none"`, and doesn't touch `coverage/coverage-summary.json`. Commit and push gates
   never depend on it.
5. **Final evidence is unchanged.**
   - The implementor's full `unit` lane with coverage before handoff, the verifier's full re-run on
     the SHA, and CI's `ci-gate` all stay as they are.
   - Rust REDs keep the `rust` lane.
   - Rules 10 and 71 say which script records and verifies a frontend red. Rule 71's receipt
     bullet and its "under `scripts/heavy-lock.sh`" line are updated in the tooling item's commit,
     and `mdpro-landing-verifier` gains the unsettled-`unit-red` check.
   - Before rollout, the scripts are tested through the sanctioned workflow, checking the
     persisted RED kind and the verdict, on:
     - empty input, a typo, a directory, a glob, and one good plus one missing file;
     - an all-skipped file, and a file with no tests;
     - all tests failing; a failure with skipped tests; a failure with passed and todo tests; each
       with and without ANSI;
     - a runner or setup error;
     - `verify` with no id;
     - `verify --id B` given A's files;
     - RED on A+B, then a selector of A alone at verify;
     - a second unrelated `unit-red` receipt pending, which must stay unsettled after `verify --id`
       of the first;
     - a test that prints a fake `Tests … passed` line before the summary;
     - a bare run of the lane with no selection, which exits 64;
     - `discard` of an unsettled branch receipt (removed), a settled one (refused) and one from
       master (refused);
     - the landing verifier's new check, red with one unsettled `unit-red` receipt left on the
       branch and green with none;
     - a clean same-selection cycle.
   - The tests re-run after every tdd-guardian upgrade.

## Consequences

- **A RED takes seconds instead of a 6-minute locked run**, and the lock is no longer the queue
  between implementors.
- **REDs become stronger evidence.** A counted assertion failure in the named file replaces an
  opaque full-suite failure.
- **Cost: more tooling to maintain.** That is the entry script, the lane-child wrapper with its
  JSON-to-summary adapter, and their tests. A tdd-guardian upgrade can change `exec.js` or
  `verification.js` underneath them, so their tests must run after every plugin upgrade.
- **Cost: an unsettled receipt can linger.** A record that isn't a valid RED is still stored, and
  `receipts.json` is tracked, so a stale `unit-red` receipt can reach master. The landing verifier
  adds one check: no unsettled `unit-red` receipt at handoff.
- **Cost: a focused RED can miss a failure that only appears together with other files.** The
  full lane at handoff and the verifier still catch it before landing, but later.
- **Receipts recorded before this lands stay as they are.** Their `opaque-failure` findings are not
  backfilled.
- This is a tooling item and needs an implementation slot. It is queued after D293.
