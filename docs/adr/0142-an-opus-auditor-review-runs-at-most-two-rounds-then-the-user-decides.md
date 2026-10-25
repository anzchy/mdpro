# 0142. An opus-auditor review runs at most two rounds, then the user decides whether to continue

## Status

Accepted, 2026-10-25. Decided by the user, recorded by herdr-delegator (Claude route). The user's words:
「opus-auditor 最多2个round，之后如果还有critical/high，交给user来抉择是否继续」.

Partially supersedes [ADR-0120](0120-a-pre-landing-audit-runs-at-most-three-rounds-then-the-user-rules.md),
decisions 1 and 2, for opus-auditor only: its cap of three rounds becomes two. gpt-auditor keeps ADR-0120's three
rounds. ADR-0129 (what a ruling shows and records, how a post-cap fix is confirmed) applies unchanged.

## Context

- **Where opus-auditor stands.** Since 2026-10-24 opus-auditor runs only on the Claude route, on the user's explicit
  request (rule 71 § Delegator runtime route). On 2026-10-25 Codex usage ran out and the user made it the only
  reviewer: 「codex uasge is out, now only opus-auditor」.
- **What prompted this.** ADR-0141's review used all three ADR-0120 rounds (r1 C0 H3, r2 C0 H2, r3 C0 H0). Each round
  is a fresh Opus pane reading the whole document set, and Claude usage is the scarce budget opus-auditor spends.
- **ADR-0120's cap** counts the first audit and two confirms, and sends anything open after round three to the user.

## Options considered

1. **Keep three rounds for opus-auditor.** Lost: the user set two.
2. **Two rounds, then the gate fails closed until the findings are fixed.** Lost: the user wants to choose whether to
   continue, not an automatic stop.
3. **Two rounds, then the user decides.** Chosen; the user's words.

## Decision

1. **An opus-auditor review runs at most two rounds**: round one is the blind first review or audit, round two a
   confirm on the fix. This covers PR audits and ADR or plan reviews alike.
2. **After round two, if a Critical or High is still open,** the delegator stops and brings the open findings to the
   user, with opus-auditor's evidence and the fix it suggests. The user decides, among:
   - a third round (one more confirm after a fix), which the user may grant once per review;
   - fix without a further round (for a PR, the verifier and `ci-gate` still gate);
   - land or accept with the finding open (for a PR, ADR-0129's record: D row, fix-by, Known issues line);
   - stop the item or change its scope.

   The user's words go in the record (the audit-log row for a PR, the Status of an ADR). The gate never passes
   without them.
3. **Counting.** A round is one opus-auditor request in a fresh pane (rule 71 § Fresh context). A challenge request
   within a round does not count.
4. **gpt-auditor is unchanged.** When both auditors run on one PR, each keeps its own cap. The merged verdict needs
   both halves closed or ruled on, so after opus-auditor's second round its open findings go to the user even while
   gpt-auditor still has a round left.

## Consequences

- **Gained.**
  - Opus usage per review is bounded at two panes, unless the user buys a third.
  - The user sees a stuck review one round earlier, while the fix is still fresh.
- **Costs.**
  - Findings a third round would have closed now cost a user question.
  - When opus-auditor is the only reviewer, a review that needs three rounds now always interrupts the user.
  - The two auditors run on different caps, which the delegator has to track per auditor.
- **Unchanged.** ADR-0120 for gpt-auditor, ADR-0121's tiers, ADR-0129's ruling record, and rule 71's conditions for
  using opus-auditor at all.
- **Foreclosed.** A third opus-auditor round without the user's word.
