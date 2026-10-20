# 0118. Three implementation slots machine-wide, and Opus, not Fable, reviews ADRs and plans

## Status

Accepted, 2026-10-17. Decided by the user, recorded by mdpro-delegator. The user's words:
「Slot 改为3个试试，目前有几个implementer，codex-audit因为用cli，可以同时接很多个需求，不会成为瓶颈。另外Fable只参与审计pr，不参与adr等其他的，adr原先由fable审计的，改为由opus审计。」

Decision 2 partially superseded 2026-10-20 by [ADR-0124](0124-two-implementation-slots-and-a-herdr-mixed-model-roster-overlays-rule-70.md), under herdr only: the Codex review of ADRs and plans is run by gpt-auditor, not mdpro-codex-audit.

Partially supersedes:
- [ADR-0097](0097-idle-sessions-pull-prep-from-a-queue-and-implement-only-under-a-grant.md),
  the Cap's "two machine-wide" (the per-session cap of one stays);
- [ADR-0115](0115-every-pre-landing-audit-runs-twice-codex-and-fable-on-the-same-dimensions.md),
  "the Fable auditor in `plan` mode" for an ADR before acceptance and a plan before its first
  `impl` grant. Fable keeps every PR audit, confirm and challenge.

Partially superseded, 2026-10-17: decision 1's "three machine-wide", now four, by [ADR-0119](0119-four-implementation-slots-machine-wide.md).

## Context

ADR-0097 capped unlanded implementation items at two machine-wide, "chosen as a conservative
start, not measured". On 2026-10-17 the user asked why mdpro-a3 and mdpro-a6 were both idle. The
two slots were held by D278 (mdpro-design) and, until ADR-0047 was accepted that day, candidate B's
spike, and the delegator had not released the spike's slot at once. A3's next items waited
behind both.

The cap rested partly on the review pipeline being a bottleneck. The user's view is that
mdpro-codex-audit drives Codex through the CLI and can take several requests at once, so the Codex
side does not limit how many items can be in flight. The heavy lock (rule 10) and the delegator's
landing order still serialise lane runs and landings.

ADR-0115 put the Fable auditor on ADR and plan reviews as well as PR audits. Its value is a second
model on code; the user wants Fable kept to PR audits, and an Opus reviewer on ADRs and plans
beside Codex `review-plan`.

## Options considered

1. **Keep two slots.** Lost: it left two implementors idle while independent work was queued, and
   the number was never measured.
2. **Three slots, as a trial (chosen).** One more item in flight; the user said 「试试」, so it can be
   revisited by a later ADR with what the trial showed.
3. **No machine-wide cap, only one per session.** Not on the table: the user named three, and the
   heavy lock and `App.tsx`-style collisions still argue for a ceiling.
4. **Keep Fable on ADR and plan reviews.** Lost to the user's choice: Fable only audits PRs.
5. **Codex `review-plan` alone on ADRs and plans.** Not chosen: the user named Opus as the second
   reviewer, which keeps two models and the blind-then-merge order.

## Decision

1. **Cap**: one unlanded implementation item per session and **three** machine-wide. Everything
   else in ADR-0097's cap (dirty, committed, waiting and fix work all count; audits do not) stands.
2. **ADR and plan reviews**: an ADR before the user is asked to accept it, and a plan before its
   first `impl` grant, get Codex `/cc-suite:review-plan` and an **Opus** reviewer, blind and merged
   as ADR-0115 describes. The delegator dispatches the `mdpro-fable-auditor` definition in `plan`
   mode with `model: "opus"`, so the dimensions and output contract stay the same; only the model
   changes.
3. **Fable** runs only on PRs: round-one `audit`, `confirm` and `challenge`, as ADR-0115 says.

## Consequences

- One more item can be in flight, so a3 or a6 waits less for a slot.
- **Cost**: more unlanded branches mean more rebases after each landing, and more heavy-lock
  contention; a rebase that changes `src/` or `tests/` costs a full lane run (rule 70 § Commits).
- **Cost**: the delegator's queue and claim bookkeeping grows with each slot.
- **Cost**: ADR and plan reviews lose the second-vendor check Fable gave; Opus is the same model
  family as the authors and the delegator, so a shared blind spot is likelier there than on PRs.
- The trial is not measured by any gate. If it shows overload (lock waits, rebase churn), a later
  ADR changes the number.
- Rule 70 changes in the same commit as this record.
