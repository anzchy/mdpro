---
name: mdpro-planning
description: Use when creating or revising mdpro implementation plans, Work Items, acceptance criteria, test plans, rollout plans, or plan verification handoffs.
---

# mdpro Planning

Use this skill for plan files and plan-quality work in mdpro. It imports the useful `.claude/skills/planning` guidance and adapts it for Codex.

## Mode

Choose the lightest mode:

- `quick-plan`: small or medium change, no migration, no public contract change.
- `full-plan`: persistence/API changes, multi-phase roadmap, public tool/schema change, risky UI behavior, or performance-sensitive work.

## Workflow

1. Clarify outcomes, constraints, non-goals, and gaps.
2. Inventory current behavior from entry points through stores, side effects, IPC, persistence, and docs.
3. Define target rules with precedence, exclusions, failure modes, and edge cases.
4. Add a decision log with options considered and rejected.
5. Break work into sequential `WI-###` items.
6. For each WI, include goal, acceptance, tests first, touched areas, dependencies, risks, rollback, and estimate.
7. Add testing procedures and manual checks.
8. Save the plan under `docs/plans/` unless the user asks for a different location.

Use `templates/plan-template.md` for full-plan mode.

## Requirements

- Every WI must include test intent and file paths when possible.
- Acceptance must be measurable.
- Map every identified gap to a WI or explicitly out of scope.
- Include edge cases: empty input, null/undefined, malformed data, Unicode/CJK, large files, rapid repeated actions, concurrent access, permissions, and I/O failures.
- If persisted data changes, include data model, migration, rollback, compatibility, and validation checks.
- If behavior is user-visible or risky, include rollout and revert strategy.

## Plan Verification Handoff

End each plan with:
- evidence to collect per WI
- required fixtures or sample data
- exact commands to run
- manual test checklist

