# UI redesign plan — Stage 0

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks.

## Stage 0 — Inventory, baseline, plan approval (no code edits)

**Entry:** this plan exists; the working tree is otherwise as at the baseline.

### WI-0.0 — Local test toolchain and baseline calibration (E11, E27, E28, E29) — M
A separate chore PR on master that lands **before** Stage 0 begins. It changes no product code.

**Scope narrowed 2026-09-12 by explicit user decision.** CI trigger restoration and branch protection — the two bullets marked **[DEFERRED]** below — were removed from this work item and moved to a separate follow-up PR. What remains is entirely local: the coverage denominator, `tests/` type checking, Testing Library, the Stryker decision, the tdd-guardian v1→v2 migration, and the G0 file-check rewrite. E25 no longer belongs to this item.

**Consequence, stated plainly so no later gate misreads it: after this PR there is still no merge gate.** `required_status_checks` remains `null`, CI still triggers only on `v*` tags, and the guardian config lands with both enforcement switches off. Everything delivered here is *runnable local verification*, not enforcement. Any criterion phrased as "a failing check blocks a merge" belongs to the deferred follow-up and must not be ticked on the strength of this work item.
- **CI (E25) — [DEFERRED to the follow-up PR; not part of this work item]:** restore the `pull_request` and `push: master` triggers in `.github/workflows/ci.yml`. macOS stays gated on `refs/tags/v` — the matrix at `:17` and `:45` already does this — so the restored gate runs Linux only. Split `cargo install cargo-audit --locked` (`:81`) out of the `cargo test` job or cache the binary; today it compiles from source on every run. Keep the dependency caches and cancel superseded pull-request runs. Job timeouts are **already set** — `timeout-minutes: 30` at `:13` and `:41` — so that part of this bullet is done; do not re-do it. Any path filtering sits behind an always-running required gate rather than skipping the workflow.
  - **Restoring the triggers restores no merge gate by itself.** Verified against the live API, not just `4f81703`'s message: `gh api repos/:owner/:repo/branches/master/protection` returns `required_status_checks: null` and `enforce_admins: false`. Master today has **no required checks at all**. Re-adding branch protection is therefore a separate, explicit step in this PR, and it is not done until a deliberately failing check is shown to block a merge.
  - **[DEFERRED with the bullet above.]** **Only two checks may be required:** `frontend` (`ci.yml:12`) and `rust-test` (`:40`), under their matrix-expanded names. **Never re-require `ai-verifier`** — `ai-verifier.yml` is `on: workflow_dispatch:` only and its own header states it "is no longer a required status check on master", so requiring it would block every PR permanently.
- **Coverage (E27):** set `coverage.include` to `src/**/*.{ts,tsx}` and `all: true` in `vitest.config.ts`, add a `coverage` script that CI can call, then re-read all four metrics and set thresholds at the measured floor, rounded down to avoid display-rounding failures.
- **Test type checking (E28):** add `tests/` to a tsconfig with JSX enabled — `tsconfig.json:23` includes only `["src"]`, so no test file is type-checked today — widen `vitest.config.ts:6` to `.test.{ts,tsx}`, and add `tests/setup.ts` with an explicit `afterEach(cleanup)`.
- **Testing Library (E7, E28):** add the four devDependencies at the E28 floors, and prove the setup with one discovered `.test.tsx` that renders a real component, performs a keyboard interaction and verifies cleanup.
- **Mutation (E29):** declare the Stryker scope explicitly in `stryker.config.json` and wire a real script, or record that it stays unwired until its allowlist modules have behavior tests. Do not strip the exclusions and run it repository-wide.
  - **First: there is no Stryker on master.** `stryker.config.json` is **absent from HEAD** and present only as an untracked local file; `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` (`^10.0.0`) are uncommitted `package.json` additions with 1337 uncommitted `pnpm-lock.yaml` lines behind them. This PR's first decision is therefore whether Stryker enters the repository at all. If yes, the config, both devDependencies and the lockfile land together and get reviewed as one unit. If no, delete the local files and say so in the plan. Do not describe the untracked config as if it were repository state — that error is what this bullet is correcting.
  - **RESOLVED 2026-09-12: Stryker does not enter the repository.** `stryker.config.json` stays out, both `@stryker-mutator/*` devDependencies and the 1329 lockfile lines behind them were dropped rather than committed, and the migration lands with `requireMutation: false` and no `mutationCommand`/`mutationGateOn`. The deciding reason is **not** that coverage is too low for mutation testing — that argument was raised and is wrong. It is that E29's precondition is unmet: this PR ships test *infrastructure* and has not delivered behavior tests for the allowlist modules, so there is nothing for a mutation run to be meaningful against. Revisit only when those tests exist.
  - **An earlier claim in this bullet — that committing the migration "arms a push gate" — was false, and is withdrawn.** Verified against the plugin's real hook: `enforceOnTaskCompleted` and `blockCommitWithoutFreshGate` are both `false`, and `pretool_guard.js:104`/`:106` return before any lane or `gateOn` value is consulted. The migration arms nothing on any trigger. The contradiction E29 warned about was still worth avoiding, but not for the stated reason.
- **tdd-guardian config migration (E27) — previously unassigned:** `.claude/tdd-guardian/config.json` is modified but uncommitted, and the two versions differ in shape, not just values. HEAD is v1 (`testCommand`, `coverageCommand`, `thresholds`, `enforceRedGreenRefactor`, `blockCommitOnFailure`, `stack`, `packageManager`); the working tree is v2 (`schemaVersion: 2`, a `lanes` array, `coverageThresholds`, `coverageMode`, the mutation keys). This PR owns committing that migration. Review it as a real diff rather than dropping the working copy in — the v1 `thresholds` are the uncalibrated 40/45/35/40, and the E27 bullet above re-derives those numbers from measurement, so the two must agree in the final commit.
  - **Why this migration is worth committing, verified against the plugin's real loader rather than assumed.** Loading HEAD's v1 config through `0.9.1`'s `lib/config.js` produces **zero errors and zero warnings** — but `migrate()` never maps v1's `thresholds` key, so `:313` spreads `DEFAULT_THRESHOLDS` (`:53`) and the live gate silently becomes **100% on all four metrics**. A fresh clone does not get the 40/45/35/40 the file appears to declare; it gets an unannounced 100% against a floor near 31%. Committing v2 is what closes that gap — which is a stronger justification than "the working tree already has it".
  - **Thresholds must be written in two places, not one.** Putting them in the guardian JSON does not make `pnpm coverage` fail: the command has to perform the comparison itself. `vitest.config.ts` gets the same calibrated four values under `coverage.thresholds`, and the two must not drift.
- **Plan corrections:** the CI claim and the "`lanes` is absent" note, both under `baseline-protocol.md` § Gates and tools, were corrected in an earlier review round. **The claim that "this PR carries no doc fix" is now false and is withdrawn:** the narrowed scope carries several, all in the plan docs — the G0 file-set rewrite (item 1.9), the withdrawal of the "arms a push gate" claim, the v2 shape after the mutation keys were removed, the 100%-default loader finding, and the Stryker resolution (E11, E27, E29).
- **G0 file-check rewrite (item 1.9) — must land before WI-0.1.** The old check compared `git status --porcelain` against one global baseline; since every file this plan touches is already dirty, editing one changed no line of that output and the check passed by construction. Rewritten under `baseline-protocol.md` § *Common gate G0* to record a start SHA, dirty-change **content** and untracked inventory, to give every work item its own start point, and to compare by content diff. WI-0.1 depends on this.
- **Verify — acceptance contract, revised 2026-09-12 for the narrowed scope.** The merge-gate criteria below moved to the deferred follow-up PR, and this item may **not** be marked complete against them. What must hold here, all locally:
  - `pnpm build` exits 0 — confirming `tests/` type checking sits **outside** the build path, so a drifted fixture can never block a release.
  - `pnpm test:run` exits 0, and the seeded `.test.tsx` is **discovered** (it appears in `pnpm exec vitest list`), performs a real keyboard interaction, and its cleanup is asserted rather than assumed.
  - `pnpm typecheck:tests` exits 0, proving files under `tests/` are now type-checked at all.
  - `pnpm coverage` prints the four corrected metrics **and fails on its own** when one falls below threshold.
  - **Three independent negative proofs**, because every check above is a green-path assertion and a green path proves only that nothing objected. Each must be demonstrated and then reverted: a deliberately wrong assertion makes the test command exit non-zero; a deliberate type error under `tests/` makes `pnpm typecheck:tests` exit non-zero; a threshold raised above the measured value makes `pnpm coverage` exit non-zero.
  - The committed config validates through the plugin's **actual loader** with zero errors, and the lanes it declares are shown to run.
  - `git show HEAD:.claude/tdd-guardian/config.json` comes back in the v2 shape, proving the migration was committed rather than left in a working tree.
  - **Deferred to the follow-up PR (do not tick here):** `gh api repos/:owner/:repo/branches/master/protection` no longer returning `required_status_checks: null`, and a throwaway PR with a deliberately failing check observed to actually block. Note `enforce_admins: false` — a restored required check still would not stop an admin merge, so "configured" is not the criterion, "observed to block" is.

### WI-0.1 — Readiness and baseline gates — S
- Run `/tdd-guardian:status`. If the config is missing, disabled, or has no runnable lane, **stop and ask the user to run `/tdd-guardian:init`**. **Read HEAD, not the working tree, when judging this.** `git show HEAD:.claude/tdd-guardian/config.json` has no `schemaVersion` and no `lanes`; it still carries `testCommand` and the uncalibrated `thresholds` block. The v2 shape exists only as an **uncommitted local change**, so a fresh clone of master gets the v1 config. WI-0.0 must land that migration (below); until it does, this step may find a v1 config on any clean checkout. **Correction 2026-10-02:** the three sentences before this one are stale — WI-0.0 committed the migration, so HEAD is **v2** (`git show HEAD:.claude/tdd-guardian/config.json` returns `schemaVersion: 2` with lanes `unit` and `rust`; re-verified 2026-09-12 per the index's tdd-guardian bullet, and again by the 2026-10-02 WI-0.1 pre-run at `e471198`). The rule they illustrate — judge readiness from HEAD, not the working tree — still stands.
- Run G0 on the untouched tree and record pre-existing failures, so they are not blamed on this work.
- ~~Save `git status --porcelain` to `$TMPDIR/mdpro-redesign/git-status-baseline.txt`. G0's file-set check compares against it.~~ **Rewritten 2026-10-02** to match G0 as rewritten by WI-0.0 item 1.9 (`d6d8f38`), which this step had not followed: Record the global baseline per [`baseline-protocol.md`](baseline-protocol.md) § *Common gate G0*: the start SHA (`git rev-parse HEAD`), the content of the dirty changes (`git diff --binary > baseline.patch`, `git diff --cached --binary > baseline-staged.patch`), and the untracked inventory (`git status --porcelain --untracked-files=all`). This baseline is for the record only; every work item checks against its **own** start snapshot, never against this one.
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

**All ticked at stop point 1 (user approval, 2026-10-08).** Each box names its evidence.

- [x] WI-0.0 (narrowed) landed on master (`d6d8f38`, `16fb45c`, 2026-09-12, before the branch rule `0d025a8`): `pnpm coverage` reports the corrected four metrics with calibrated thresholds that actually fail the command, `pnpm typecheck:tests` exits 0, a `.test.tsx` is discovered and type-checked, and the three negative proofs were demonstrated. The later threshold recalibration `9633720` and the PR-trigger restoration `1925896` are on `frontend-backend-redesign` only. The negative proofs are attested only by the `16fb45c` commit message. **The CI gate is explicitly not part of this box** — it moved to the deferred follow-up PR, and Stage 0 may begin without it; CI and branch protection stay out of this box, so sequencing phase 1 stays 🔄
- [x] tdd-guardian readiness confirmed, or the user was asked to run `/tdd-guardian:init` (the stage does not pass until it is ready) — confirmed from the HEAD config ([`20261003-wi-0-1-baseline.md`](../20261003-wi-0-1-baseline.md) R1, `:25`); `/tdd-guardian:status` was deliberately not called, because it writes `state.json` (WI-0.1 R1, `:198`)
- [x] Baseline G0 results recorded, including pre-existing failures — `ddb1cfe` ([`20261003-wi-0-1-baseline.md`](../20261003-wi-0-1-baseline.md) §2, `:33-48`): all five commands exit 0, no pre-existing failures, the non-fatal warnings listed
- [x] Appendix A lists every non-token value in the tokenized categories with file:line and class a/b/c; the counts reconcile with the Baseline table, or the discrepancy is explained — `0acdb0d`, rulings `da8b8b8`; [Reconciliation](./appendix-a-literals.md#reconciliation-against-the-baseline-table) explains each difference
- [x] Appendix B lists every surface × theme with a reference flag, including the review §4 surfaces (recent files, which is a native submenu; disabled-with-reason button; the external-change dialog, formerly a banner; drag-and-drop target; empty/no-tabs state) — `cfbc5cd`; [Appendix B](./appendices.md) has a row for each §4 surface
- [x] Every Appendix B cell has a baseline screenshot path, or a "could not capture" mark with the user asked — before-shot paths filled on the Mac mini (WI-0.4); the two `NOT CAPTURED` cells (`appendices.md:54`, the "Saving…" reason) and the About offline state (`:52`, `NOT VERIFIED`) were accepted by the user on 2026-10-05
- [x] Every `pnpm dev` surface × theme has baseline computed-style JSON, and ~~the baseline `git status --porcelain` is saved~~ the global baseline (start SHA, dirty-change patches, untracked inventory) is saved *(rewritten 2026-10-02 to match G0, `d6d8f38`)* — post-merge JSON: MacBook Chromium 64/64 and mini WKWebView 6/6, each with an empty repeat diff (`630cb86`; paths per plan A4); the global baseline is in `ddb1cfe` ([`20261003-wi-0-1-baseline.md`](../20261003-wi-0-1-baseline.md) §3)
- [x] The CSS file map is decided: every partial is ≤ ~300 lines and its import position is listed — [`css-file-map.md`](./css-file-map.md) §3.1: 15 partials, the largest 220 lines, with an Import position column (`3f903bc`, re-based on `4ebfc89` in `95e7842`)
- [x] The rule 33 edit is drafted (text only) — [`css-file-map.md`](./css-file-map.md) §4; the rule file is unchanged
- [x] `/plan-design-review` findings are recorded — run 2 (at `630cb86`, recorded in `a00f089`, 4 decisions; ADR-0055/0056) in the plan's GSTACK REVIEW REPORT
- [x] **Gate:** the user explicitly approves the plan and answers or waives A1–A12 and Q1–Q14 — user approved 2026-10-08; A1–A12 per the plan's Assumptions table; Q1–Q16 closed

**Rollback:** nothing to roll back; Stage 0 changes only this plan document.
