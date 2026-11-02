# Auditor

What `gpt-auditor` and `opus-auditor` do with an audit, confirm, challenge or plan-review request. The request names the
range, the pinned master `<M>` and blob `<B>` of the dimension file, the tier and the difficulty; this file is the
standing part (D355, ADR-0147 WI-1). The dimension file holds the sets, severity, evidence and report shape.

<!-- read-every-session:begin -->
- [docs/agents/audit-dimensions.md](audit-dimensions.md)
<!-- read-every-session:end -->

## Dimensions

Use the set the dimension file's [§ Which set](audit-dimensions.md#which-set) names for the range, at the blob `<B>` the
request pins, one pin for the whole review (ADR-0146). Mediums are listed, Lows counted, and the report ends with the
count line in [§ Report shape](audit-dimensions.md#report-shape).

## Read barrier

<!-- moved-from: rule 71 § Fresh context (ADR-0147) -->
- **Read barrier, by phase, for gpt-auditor:**

  | Phase | May read | Must not read |
  |---|---|---|
  | Round one (`audit`, `plan` round one) | the range, the brief, the handoff, `REVIEW.md` | PR comments, `herdr-spike/delegator/` |
  | `confirm`, `plan` confirm | the files the request names: earlier reports, the delegator verdict, counter-proofs | unrelated report folders |

## Downgrades

A Critical or High is lowered only with a reproduction or a counter-proof
([§ Evidence for a blocker](audit-dimensions.md#evidence-for-a-blocker), "Lowering"; ADR-0085, user decision 2026-10-16:
「后续每次降级都附上复现或者反证」). You report to the delegator, not to the implementor.

## Tiers

The delegator names the ADR-0121 tier in the request, and you may raise it. The tier list, the base, confirm scope and the
records are in [landing-and-audit.md](../../.agents/skills/mdpro-delegator/references/landing-and-audit.md#tiers).

## Pre-existing

A High tagged Pre-existing stops blocking only with ADR-0121 decision 3's proof, the other auditor's confirmation and a
linked issue or D row with an owner ([landing-and-audit.md](../../.agents/skills/mdpro-delegator/references/landing-and-audit.md#tiers);
[§ Evidence for a blocker](audit-dimensions.md#evidence-for-a-blocker)).

## Confirms

A confirm reviews the fix diff (a `git range-diff` across a rebase) and every open finding by id; a Critical or High that
any commit in the range introduced blocks, whatever round finds it ([landing-and-audit.md](../../.agents/skills/mdpro-delegator/references/landing-and-audit.md#requests)).

## Count line

`COUNT C<n> H<n> M<n> L<n> · BLOCKING C<n> H<n>`; the gate reads the blocking count
([§ Report shape](audit-dimensions.md#report-shape)).
