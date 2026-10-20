# 0119. Four implementation slots machine-wide

## Status

Accepted, 2026-10-17. Decided by the user, recorded by mdpro-delegator. The user's words:
「slot increase to 4 now, so that mdpro-design can continue doing its work」.

Partially superseded 2026-10-20 by [ADR-0124](0124-two-implementation-slots-and-a-herdr-mixed-model-roster-overlays-rule-70.md): "four machine-wide" becomes two.

Partially supersedes [ADR-0118](0118-three-implementation-slots-and-opus-reviews-adrs-and-plans.md)
decision 1, "three machine-wide" (the per-session cap of one, and everything else in ADR-0118,
stand).

## Context

ADR-0118 raised the machine-wide cap from two to three the same day, as a trial. By the evening
the three slots were held by D261-WI-1 (mdpro-a6), ADR-0047 WI-009 (adr047-verify) and D241 + D273
(mdpro-a3), and mdpro-design, which had just landed D278, had no slot to work in. Nothing was
measured between the two decisions: the third slot had run for a few hours, during which D278
landed after five audit rounds and no lock or rebase overload was reported.

## Options considered

1. **Keep three.** Lost: mdpro-design would sit idle until one of the three items lands.
2. **Four (chosen).** One slot per active implementing session today (a3, a6, adr047-verify,
   mdpro-design).
3. **No machine-wide cap.** Not on the table: the user named four.

## Decision

The cap is one unlanded implementation item per session and **four** machine-wide. ADR-0097's
counting rules and ADR-0118 decisions 2 and 3 (ADR and plan reviews by Codex and Opus; Fable on PRs
only) are unchanged.

## Consequences

- Every implementing session can hold an item at once, so none waits for a slot.
- **Cost**: four unlanded branches mean more rebases after each landing and more heavy-lock
  contention; a rebase that changes `src/` or `tests/` costs a full lane run.
- **Cost**: four concurrent audits per round for mdpro-codex-audit and the Fable auditor, and four
  handoffs for the delegator to sequence.
- **Cost**: the number is still unmeasured; ADR-0118's trial had not run long enough to say whether
  three overloaded anything. If lock waits or rebase churn grow, a later ADR lowers it.
- Rule 70 changes in the same commit as this record.
