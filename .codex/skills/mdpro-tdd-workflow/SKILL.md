---
name: mdpro-tdd-workflow
description: Run mdpro's strict TDD workflow for one granted item (a D item, WI or fix round from a herdr-delegator brief) as a Codex implementor. Chains plan, test matrix, an independent spec-adversary subagent attack, per-WI red receipts and red-green-refactor, a coverage self-check, a reviewer subagent, the gates and the self-acceptance handoff. Halts on the first gate failure. Self-contained port of /tdd-guardian:workflow for rule 71. Use when a brief tells you to run $mdpro-tdd-workflow, or when implementing any granted item.
---

# mdpro TDD workflow (Codex)

The Codex port of tdd-guardian's `/tdd-guardian:workflow` (plugin 0.10.2), adapted to mdpro rules
10 and 71. Everything you need is in this folder and in `.codex/agents/`. You don't load the plugin's
skills. You only call its receipt CLI, which is a plain Node script.

The source was ported 2026-10-20 at the user's request: 「创建 .codex/skills/mdpro-tdd-workflow/，
尽可能将当前 /tdd-guardian:workflow 中的迁移过去，使得这个skill self-contained, test-matrix attack
仍然由对应的Implementor 用subagent来产生」.

## What this replaces, and what it doesn't

| tdd-guardian step | Here | Who runs it |
|---|---|---|
| plan (`tdd-planner`) | Step 1: turn the brief's ACs into WIs | you |
| design-tests (`tdd-test-designer`) | Step 2: the test matrix | you |
| spec-adversary | Step 3: the attack | **subagent `mdpro-spec-adversary`**, read-only, fresh context |
| implement (`tdd-implementer`) | Step 4: red, receipt, green, refactor, verify | you |
| audit-coverage | Step 5: coverage self-check | you |
| audit-mutation | not configured (`requireMutation: false`, plan decision E29) | — |
| review (`tdd-reviewer`) | Step 6: review | **subagent `mdpro-tdd-reviewer`**, read-only |
| gate | Step 7: the brief's gates | you |
| — | Step 8: self-acceptance handoff (rule 71) | you |

Nothing here replaces the delegator's checks. After your handoff, it re-reads your table, the
landing verifier re-runs your lanes and receipts, and two auditors audit the range. This workflow
exists so that those checks find nothing.

## Mandatory rules

1. **The brief is the spec.** Its Background, Scope, ACs, Out of scope and Gates bind every step.
   Where this skill and the brief differ, the brief wins; note the difference in the handoff.
2. **Stop at the first gate failure.** Don't cascade.
   - A lane that ran zero tests is a failure.
   - An environment failure (missing module, OOM, timeout, lock wait) stops the step and never
     triggers a code change.
3. **Scope lock.** Edit only the brief's granted paths. A needed path outside them means: stop,
   write why in your final message, and wait for a revised grant.
4. **No `git push`, no PR actions, no commit on `master`.** You commit on your own branch only, at
   the end, if the brief says so, staging named paths only. Never stage `AGENTS.md` or `.codex/`
   in a worktree copy.
5. **Every step leaves a file** in `~/.mdpro-redesign/herdr-spike/<your agent name>/`, named
   `<item>-<step>.md`. The delegator reads files, not your pane.
6. **Heavy commands go through `scripts/heavy-lock.sh`** (rule 10): coverage runs, `tsc`,
   `pnpm build`, `cargo test`, receipt record and verify on the old CLI. A focused, unlocked run uses
   at most 2 workers: `VITEST_MAX_WORKERS=2`.
7. **Keep replies short and write long material to files.** An output limit once stalled an
   implementor for two days.

Before Step 1, read `references/policy.md`. It holds the test-quality rules every step applies.

## Step 1: Plan

Read the brief in full, then every file its Background names. Write `<item>-plan.md`:
- one `### WI-n: <title>` per independently testable behaviour. Its receipt id is
  `<ITEM>-WI-n` (for example `D290-WI-6`); never a bare `WI-n` (rule 70).
- for each WI: the ACs it covers, the source files it changes, the test files it adds or
  extends, and its risks;
- a Deferred section naming what the brief's Out of scope excludes.

Every AC maps to at least one WI. An AC that needs no code change (for example "D171 still
passes unchanged") maps to a verification row, not a WI.

On a fix round, the WIs are the findings. Each finding becomes one WI, and the regression test is
the reproduction the auditor gave.

## Step 2: Test matrix

Follow `references/test-matrix.md`. Write `<item>-test-matrix.md`.

**Skip rule** (rule 71): a fix round whose brief says the matrix step is skipped, because the
brief fully specifies the regression tests, goes from Step 1 straight to Step 4. Record "matrix
skipped per brief" in the handoff. Steps 3 and 5–8 still run.

## Step 3: Attack the matrix with a subagent

The attack must come from a context that didn't write the matrix. **Spawn the custom agent
`mdpro-spec-adversary`** (defined in `.codex/agents/mdpro-spec-adversary.toml`, `gpt-6-astra` high) when the
brief's difficulty is `hard`, and **`mdpro-spec-adversary-std`** (`gpt-6-sol` medium) when it is `routine` or `standard`
(ADR-0138). Every grant is attacked. Give it:
- the brief path;
- the plan and matrix paths;
- the source files under change, and the existing tests nearby;
- the instruction: "Attack this matrix. Report only, per your instructions."

Then:
1. Write its report, verbatim, to `<item>-attack.md`.
2. For every gap, either add the missing case to the matrix (marked `[adversary gap n]`), or
   reject it in `<item>-attack.md` with a counter-proof. A counter-proof is an existing case that
   kills that wrong implementation, or the brief's Out of scope line. "Unlikely" is not one.
3. If gaps were added, spawn the adversary **once more** on the amended matrix: round two, appended
   to the same file.
4. Gaps still open after round two: don't implement silently. Stop, list them in your final message,
   and wait for the delegator.
5. **A gap that asks for more than the brief** (a stricter rule, a new path, a behaviour the brief
   doesn't state): stop and ask the delegator before adding it.

**If you can't spawn a subagent** (the agent type is missing, or spawning is disabled): don't run the
attack yourself, because an attack by the matrix's author is not independent. Write
`<item>-attack.md` with `ATTACK-NOT-RUN: <the error>`, stop, and say so. The delegator then has an
Opus adversary attack the matrix, which was the rule 71 route before this skill.

Only after Step 3 do you write any test or production code.

## Step 4: Implement, one WI at a time

Follow `references/implement.md` for each WI in plan order. Each WI is:
1. tests;
2. RED recorded;
3. minimal production change;
4. green;
5. refactor;
6. receipt verify.

Append a short `### WI-n` block to `<item>-implement.md` after each WI. A WI that is still red after
one retry is BLOCKED: stop, and don't start the next WI.

## Step 5: Coverage self-check

Follow `references/coverage.md`. Write `<item>-coverage.md`. A global or critical-path threshold
miss is a FAIL: add tests (Step 4 rules), or stop and report.

## Step 6: Review by a subagent

**Spawn the custom agent `mdpro-tdd-reviewer`** (`.codex/agents/mdpro-tdd-reviewer.toml`) with:
- the brief;
- the plan and matrix;
- `git diff --no-ext-diff <base>..HEAD` saved to a scratch file (or the working-tree diff, if
  uncommitted);
- the receipt ids.

Write its report to `<item>-review.md`. Then:
- **High findings:** fix them (Step 4 rules: a missed case gets a test first), then re-run the
  reviewer once.
- **Medium findings:** fix them if cheap, otherwise list them in the handoff.

If spawning fails, review the diff yourself against `references/review.md`. Mark the file
`SELF-REVIEW (subagent unavailable)`.

## Step 7: Gates

Run exactly the commands in the brief's Gates section, in order, under the lock where the brief
says so. Typically:
1. the full unit lane with coverage;
2. typecheck and build;
3. `pnpm ledger:check`;
4. the `rust` lanes if `src-tauri/` changed;
5. the slow lane if a `*.slow.test.*` file changed.

Record each command's decisive line. A red lane sends you back to the step that owns it. Never
"fix" a lane by editing a recorded assertion.

## Step 8: Commit and hand off

Commit on your branch if the brief says so. Use `type(scope): summary` with a body saying why,
stage named paths only, and don't push.

Then write `<item>-handoff.md` per `references/handoff.md`. It ends with the
`AC | evidence | decisive output | verdict` table. Reply with one line naming the file, then go idle.

## Failure modes

| Where | What you do |
|---|---|
| Brief unreadable, or the scope can't meet an AC | Stop before Step 1, and say what's missing |
| Adversary unavailable | `ATTACK-NOT-RUN`; stop |
| Gaps still open after round two | List them; stop |
| A gap beyond the brief | Ask the delegator; stop |
| RED not an assertion failure | Fix the test or runner and record again. Never edit production code to get a RED |
| Receipt shows `implementation-already-present` | Name it in the handoff; don't re-record to hide it |
| `SEPARATION-BROKEN` | Name each file and the reason. The delegator decides; don't re-record |
| Environment failure | Stop at that step and report it |
| Coverage below threshold | Add tests or stop |
| Reviewer High still open after one fix | List it; stop |
| Path outside scope | Stop; ask for a revised grant |
