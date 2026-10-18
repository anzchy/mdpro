# Gap analysis: "How the Claude Code team does code review" against rule 70's audit order

Date: 2026-10-18 · mdpro-delegator · The proposal behind [ADR-0121](../adr/0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md)

**Source:** <https://claude.dev/blog/solving-code-review-at-anthropic/> (Osmani, Westlee Lunt and Wang,
2026-10-15). **The user's request:** 「according to this, see how to improve our auditing principle, policy, etc.」

## What the post describes

The post's tiers decide how many **human approvals** a change needs. They do not decide whether
automated review runs: every PR still gets the AI review and the security review.

| Tier | Approvals | Examples |
|---|---|---|
| Low | 0 | docs, copy |
| Medium | 1 | ordinary product changes, plus sensitive areas such as caching, the auto-updater and system prompts |
| High | 2 | the highest-risk paths, which always need two people |

- **Pre-existing** is an attribution label. A bug the PR did not introduce is not shown as the
  author's fault.
- **Re-review**: rounds are capped at three. After the first few passes only the new diff is
  re-reviewed. Findings name the class of bug, and a finding is never repeated.
- **`REVIEW.md`** sets out what failure looks like in each area, asks for file:line evidence,
  and puts the count first in the summary.
- **Measuring the reviewer**:
  - past incidents become an eval set that runs daily;
  - noise is measured by what the author did with each comment;
  - rounds-to-pass is tracked alongside recall.

## Comparison with our order, as put to the user

| Theme | Post | Us before ADR-0121 |
|---|---|---|
| Round cap | 3, then step back | 3, then the user rules (ADR-0120) ✔ |
| Findings checked before they block | Several agents vote | Two blind auditors, and a one-sided finding is challenged ✔ |
| Approval tied to one commit | Re-approve after a push | Tree identity, and re-push to the PR head ✔ |
| Check against main as it will be | Merge queue | ff-only after a rebase, plus `ci-gate` ✔ |
| Effort by risk | Tiers set by the change | Every WI gets the same two-auditor audit ✘ |
| Bugs the PR did not introduce | Tagged Pre-existing | They block as High (D261's backend residual) ✘ |
| Re-review converges | New diff only, flag the class | Confirms are scoped to findings, but D277 was fixed one instance at a time ✘ |
| Reviewer instructions | `REVIEW.md` per area | Rule 60's one generic checklist ◐ |
| Feedback loop | Incident eval, noise, rounds | Nothing measured ✘ |
| Review before the PR | Fresh-context review | tdd-guardian lanes only ◐ |
| Security | A separate review that can block | Folded into the audit ◐ |

## The six proposals, as put to the user

1. **Pre-existing tag**: a Critical or High proven unchanged from the parent becomes a D item and
   does not block, unless the PR makes it reachable or worse.
2. **Risk tiers set by path**:
   - Low: docs, test-only and CSS-only changes, audited by one Codex mini;
   - Medium: today's audit;
   - High: two full audits plus `/security-review`.
3. **Convergent confirms**: review the fix diff only, name the class and every instance, and never
   re-post a finding.
4. **`REVIEW.md`**, or rule 60 split by area.
5. **Measure the auditors**: an outcomes log, rounds-to-pass, and an eval set of escaped defects.
6. **A fresh-context `/code-review` by the implementor before handoff.**

The user's answer: 「1+2+3 core (Recommended), 5 Measure auditors, 4 REVIEW.md」. Item 6 was not
chosen.

The ADR's first draft was reviewed by Codex (`review-plan`) and by Opus (`mdpro-fable-auditor`,
plan mode). Both returned NEEDS REVISION on drafts one and two. In later drafts:
- item 1 covers proven pre-existing Highs only, and a pre-existing Critical goes to the user;
- item 2 tiers tests by what they guard;
- item 3 drops the out-of-scope deferral.

The ADR's Status lists these as revisions after review, for the user to accept explicitly.
