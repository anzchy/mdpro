# Step 5: coverage self-check

Ported from tdd-guardian's `coverage-auditor` and `coverage-gate`. This is your own check before the
landing verifier's. It writes `<item>-coverage.md` and edits nothing.

## Run once

The full unit lane with coverage, under the lock. This is the same run Step 7 needs, so run it once
and reuse it if the tree doesn't change in between:

```sh
scripts/heavy-lock.sh pnpm exec vitest run --coverage
```

It writes `coverage/coverage-summary.json` (totals and per file). If `coverage/coverage-final.json`
is absent (the repo's reporter set may not include `json`), say that statement-map inspection was
unavailable. Don't infer uncovered line ranges from the summary alone.

## Check

1. **Global thresholds** from `.claude/tdd-guardian/config.json` → `coverageThresholds` (read the
   file; don't copy numbers from here). Compare `total.lines/functions/branches/statements.pct`
   against them.
2. **Critical paths** from `criticalPaths[]`. Each glob must match at least one file in the summary,
   and each match must meet that entry's thresholds. A glob matching nothing is a FAIL.
3. **Changed files.** For every `src/` file your diff changes (`git diff --name-only <base>`), report
   lines and branches as covered/total and %. Then list the uncovered line ranges that fall inside
   your changed hunks, read from `coverage-final.json` when it exists's `statementMap`/`s` and
   `branchMap`/`b`. Each one is either closed with a test (Step 4 rules), or justified as
   unreachable with the reason.
4. **`v8 ignore`** in changed files: only the range form, each with a reason.
5. Rust has no coverage lane here. State "Rust: not measured".

Report counts, not just percentages: `97.4%` hides whether 3 lines are missing or 300.

## Verdict

- **FAIL** if a global threshold or a critical path is missed.
- **WARN** if an uncovered line inside a changed hunk is left without a reason.
- **PASS** otherwise.

## Report

```markdown
# Coverage — <item> @ <tree or "working tree">
Gate: PASS | WARN | FAIL
| Metric | Actual (covered/total) | Threshold | Status |
| Critical path | Lines | Branches | Status |
| Changed file | Lines | Branches | Uncovered in hunks (with reason or "closed by case n") |
Mutation: NOT CONFIGURED (requireMutation false, E29)
```
