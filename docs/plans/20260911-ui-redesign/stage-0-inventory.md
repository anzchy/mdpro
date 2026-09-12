# UI redesign plan — Stage 0

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks.

## Stage 0 — Inventory, baseline, plan approval (no code edits)

**Entry:** this plan exists; the working tree is otherwise as at the baseline.

### WI-0.0 — Tooling and CI chore PR (E11, E25, E27, E28, E29) — M
A separate chore PR on master that lands **before** Stage 0 begins. It changes no product code.
- **CI (E25):** restore the `pull_request` and `push: master` triggers in `.github/workflows/ci.yml`. macOS stays gated on `refs/tags/v` — the matrix at `:17` and `:45` already does this — so the restored gate runs Linux only. Split `cargo install cargo-audit --locked` (`:81`) out of the `cargo test` job or cache the binary; today it compiles from source on every run. Keep the dependency caches and cancel superseded pull-request runs. Job timeouts are **already set** — `timeout-minutes: 30` at `:13` and `:41` — so that part of this bullet is done; do not re-do it. Any path filtering sits behind an always-running required gate rather than skipping the workflow.
  - **Restoring the triggers restores no merge gate by itself.** Verified against the live API, not just `4f81703`'s message: `gh api repos/:owner/:repo/branches/master/protection` returns `required_status_checks: null` and `enforce_admins: false`. Master today has **no required checks at all**. Re-adding branch protection is therefore a separate, explicit step in this PR, and it is not done until a deliberately failing check is shown to block a merge.
  - **Only two checks may be required:** `frontend` (`ci.yml:12`) and `rust-test` (`:40`), under their matrix-expanded names. **Never re-require `ai-verifier`** — `ai-verifier.yml` is `on: workflow_dispatch:` only and its own header states it "is no longer a required status check on master", so requiring it would block every PR permanently.
- **Coverage (E27):** set `coverage.include` to `src/**/*.{ts,tsx}` and `all: true` in `vitest.config.ts`, add a `coverage` script that CI can call, then re-read all four metrics and set thresholds at the measured floor, rounded down to avoid display-rounding failures.
- **Test type checking (E28):** add `tests/` to a tsconfig with JSX enabled — `tsconfig.json:23` includes only `["src"]`, so no test file is type-checked today — widen `vitest.config.ts:6` to `.test.{ts,tsx}`, and add `tests/setup.ts` with an explicit `afterEach(cleanup)`.
- **Testing Library (E7, E28):** add the four devDependencies at the E28 floors, and prove the setup with one discovered `.test.tsx` that renders a real component, performs a keyboard interaction and verifies cleanup.
- **Mutation (E29):** declare the Stryker scope explicitly in `stryker.config.json` and wire a real script, or record that it stays unwired until its allowlist modules have behavior tests. Do not strip the exclusions and run it repository-wide.
  - **First: there is no Stryker on master.** `stryker.config.json` is **absent from HEAD** and present only as an untracked local file; `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` (`^10.0.0`) are uncommitted `package.json` additions with 1337 uncommitted `pnpm-lock.yaml` lines behind them. This PR's first decision is therefore whether Stryker enters the repository at all. If yes, the config, both devDependencies and the lockfile land together and get reviewed as one unit. If no, delete the local files and say so in the plan. Do not describe the untracked config as if it were repository state — that error is what this bullet is correcting.
  - **Committing the tdd-guardian migration is what arms a mutation gate, so scope Stryker in the same PR.** On master today no gate exists: `requireMutation`, `mutationCommand` and `mutationGateOn` are all absent from `git show HEAD:.claude/tdd-guardian/config.json`. The uncommitted v2 config sets `"requireMutation": true`, `"mutationCommand": "pnpm exec stryker run"` and `"mutationGateOn": ["push"]` — so the moment that migration lands, an unscoped Stryker run becomes a push gate. "Record that it stays unwired" is therefore not a no-op in this PR. Either scope Stryker properly, or land the migration with `requireMutation` set to `false`. Do not land the two in contradiction.
- **tdd-guardian config migration (E27) — previously unassigned:** `.claude/tdd-guardian/config.json` is modified but uncommitted, and the two versions differ in shape, not just values. HEAD is v1 (`testCommand`, `coverageCommand`, `thresholds`, `enforceRedGreenRefactor`, `blockCommitOnFailure`, `stack`, `packageManager`); the working tree is v2 (`schemaVersion: 2`, a `lanes` array, `coverageThresholds`, `coverageMode`, the mutation keys). This PR owns committing that migration. Review it as a real diff rather than dropping the working copy in — the v1 `thresholds` are the uncalibrated 40/45/35/40, and the E27 bullet above re-derives those numbers from measurement, so the two must agree in the final commit.
- **Plan corrections:** already applied to the plan docs in this review round — the CI claim and the "`lanes` is absent" note, both under `baseline-protocol.md` § Gates and tools, are corrected — so this PR carries no doc fix (E11, E25).
- **Verify:** the pull request shows the required gate actually running `pnpm build`, `pnpm test:run` and `cargo test`; `pnpm coverage` prints the four corrected metrics; the seeded `.test.tsx` is both discovered and type-checked. Additionally, `gh api repos/:owner/:repo/branches/master/protection` must stop returning `required_status_checks: null`, and a throwaway PR carrying a deliberately failing check must be observed to actually block — a green run on an unprotected branch proves nothing. Note `enforce_admins: false`: a restored required check still would not stop an admin merge, so "configured" is not the criterion, "observed to block" is. Finally, `git show HEAD:.claude/tdd-guardian/config.json` must come back in the v2 shape, proving the migration was committed rather than left in a working tree.

### WI-0.1 — Readiness and baseline gates — S
- Run `/tdd-guardian:status`. If the config is missing, disabled, or has no runnable lane, **stop and ask the user to run `/tdd-guardian:init`**. **Read HEAD, not the working tree, when judging this.** `git show HEAD:.claude/tdd-guardian/config.json` has no `schemaVersion` and no `lanes`; it still carries `testCommand` and the uncalibrated `thresholds` block. The v2 shape exists only as an **uncommitted local change**, so a fresh clone of master gets the v1 config. WI-0.0 must land that migration (below); until it does, this step may find a v1 config on any clean checkout.
- Run G0 on the untouched tree and record pre-existing failures, so they are not blamed on this work.
- Save `git status --porcelain` to `$TMPDIR/mdpro-redesign/git-status-baseline.txt`. G0's file-set check compares against it.
- Re-verify every Baseline fact in [`baseline-protocol.md`](baseline-protocol.md) and note discrepancies in [Appendix A](appendices.md).
- List every test that reads app CSS from disk, since Stage 1 will move those files: `grep -rln "\.css" tests`.

### WI-0.2 — Literal inventory and classification — M
- For every non-token value in the tokenized categories, record file:line, selector, property and value.
- Put each value in a class:
  - **(a)** an existing or proposal token with the same value exists
  - **(b)** tokenizing it changes the rendered value (e.g. sub-12px chrome sizes, the `:1032`/`:1747` accent fills, 0.05s/0.2s/0.3s transitions)
  - **(c)** it needs a new token or an exception (feeds Q6–Q10)
- Write the result to Appendix A.

### WI-0.3 — QA surface matrix — S
- Fill Appendix B with every surface × {light, dark}.
- Mark each row "has reference" (drawn on a proposal board) or "no reference".

### WI-0.4 — Baseline snapshots and screenshots — M
- Write the computed-style snapshot script, and record baseline JSON for every `pnpm dev` surface × theme (E5).
- Capture every matrix cell per the visual evidence protocol.
- Record the paths, window size and scale in Appendix B.
- Capture the main window at 400×640 with the sidebar shown and hidden, and the Settings dialog at 400×640 (DR16).
- Capture the main window 900px wide with the sidebar shown, to confirm the layout bug WI-4.8 fixes.

### WI-0.5 — CSS file map and rule 33 edit proposal — S
- Read every section banner in `globals.css`. The list observed so far is incomplete: `.toast` at `:819` sits between the link modal and Settings banners.
- **Confirm the recent-files CSS is dead; WI-1.2 removes it** (Stage 0 changes only this plan):
  - The `.toolbar-recent*` rules (from `globals.css:397`) have no consumer in `src/` or `tests/`. Recent files are only the native "Open Recent" submenu (`menu.rs:73-96`).
  - WI-1.2 deletes these rules and the stale "Recent dropdown" row in rule 31's z-index table, in one commit before the move, so no partial receives them.
- Propose the partial file map (WI-1.1). Any section longer than about 300 lines (Settings spans `:858-1435`) splits along its sub-banners.
- Draft the exact rule 33 spec-column edit (DR15), without applying it.

### WI-0.6 — Plan design review — S
- Run `/plan-design-review` on this plan.
- Fold non-controversial findings into this file. List the rest as open questions.

### Stage 0 acceptance criteria
- [ ] WI-0.0 landed on master: the CI gate runs on pull requests and pushes to master, `pnpm coverage` reports the corrected four metrics with thresholds set, and a `.test.tsx` is discovered and type-checked
- [ ] tdd-guardian readiness confirmed, or the user was asked to run `/tdd-guardian:init` (the stage does not pass until it is ready)
- [ ] Baseline G0 results recorded, including pre-existing failures
- [ ] Appendix A lists every non-token value in the tokenized categories with file:line and class a/b/c; the counts reconcile with the Baseline table, or the discrepancy is explained
- [ ] Appendix B lists every surface × theme with a reference flag, including the review §4 surfaces (recent files, which is a native submenu; disabled-with-reason button; the external-change dialog, formerly a banner; drag-and-drop target; empty/no-tabs state)
- [ ] Every Appendix B cell has a baseline screenshot path, or a "could not capture" mark with the user asked
- [ ] Every `pnpm dev` surface × theme has baseline computed-style JSON, and the baseline `git status --porcelain` is saved
- [ ] The CSS file map is decided: every partial is ≤ ~300 lines and its import position is listed
- [ ] The rule 33 edit is drafted (text only)
- [ ] `/plan-design-review` findings are recorded
- [ ] **Gate:** the user explicitly approves the plan and answers or waives A1–A12 and Q1–Q14

**Rollback:** nothing to roll back; Stage 0 changes only this plan document.
