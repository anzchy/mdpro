# 0115. Every pre-landing audit runs twice, Codex and Fable, on the same dimensions, and the delegator merges them

**Status**: Accepted (2026-10-16). Decided by the user, recorded by
mdpro-delegator. The user's words: 「更改 rule 70 audit 规则，对于每一个 pr，在
merge 之前，除了让 codex-audit 来启用 codex Audit 之外，还应当由 subagent 启动
fable 进行 Audit，维度参考 Codex audit 的维度，保持维度相同，才能互相 challenge，
对于 critical,high findings 进行重点审核，最后你要综合两个 Auditing results
做汇总」; on the four points the delegator put back: 「1. delegator，2. 不能
，先各自单独审 … 4. 加上 fable」, and on the confirm round 「Both, scoped
(Recommended)」. Partially supersedes
[ADR-0085](0085-a-branch-is-audited-before-it-is-fast-forwarded-onto-master.md)
Decisions 1 and 2, where "the audit" and "the auditor" meant the Codex audit
alone. Everything else in ADR-0085 stands.

## Context

- Since ADR-0085 (2026-10-12) one Codex audit (`/cc-suite:audit --mini`,
  `gpt-6.1-sol`, effort `high`) gates every landing: zero Critical and zero
  High, or the branch goes back to its owner.
- A single model's blind spots pass straight through that gate. On 2026-10-16
  D214 needed four Codex rounds (H-A and H-B, then the no-candidate open, then
  the rename variant), each a variant the previous round had not looked for.
  A second auditor might have found some of them in round one.
- ADR and plan reviews were ad hoc. ADR-0114 went through three Codex
  `review-plan` rounds (C0 H4 M7, then C0 H1 M5, then C0 H0) before the user
  accepted it. That process had no second reviewer and no written rule.
- The delegator already dispatches `mdpro-landing-verifier` as a subagent on
  the handoff SHA, so a second read-only subagent fits the same moment.

## Options considered

- **A. Keep the Codex audit alone** (ADR-0085). Lost: the user asked for a
  second auditor that can challenge the first.
- **B. A Fable subagent on the same dimensions, independent in round one, with
  the delegator merging the two** (chosen). The two verdicts are comparable
  finding by finding, because they share a range, a dimension set and a
  severity scale.
- **C. Fable reviews Codex's findings instead of auditing.** Lost: the user
  ruled 「不能，先各自单独审」. An auditor that starts from the other's list
  anchors on it and stops finding what the other missed.
- **D. The auditor session (mdpro-codex-audit) dispatches the Fable run.**
  Lost: the user chose the delegator (「1. delegator」). It also keeps both
  verdicts reaching the delegator by separate paths, and spares the auditor a
  second job in its queue.
- **E. Fable on first rounds only, with Codex alone confirming fixes.** Lost:
  the user chose 「Both, scoped (Recommended)」. A finding only Fable raised
  would otherwise be closed by the model that never saw it.

## Decision

1. **Two audits per handoff.** When a handoff passes the ancestry and scope
   check, the delegator sends the Codex audit request to mdpro-codex-audit, as
   in ADR-0085. In the same message it dispatches the `mdpro-fable-auditor`
   subagent (`model: fable`) in `audit` mode, with the same range
   `<parent>..<sha>` and the same dimension set (mini's five unless the request
   names full's nine). This is the one named exception to rule 70's
   "every subagent runs on Opus".
2. **Round one is blind.** Neither auditor sees the other's verdict until both
   are in. The Fable auditor reads no PR comment, Codex job or report. The
   delegator does not forward one auditor's findings to the other before
   merging.
3. **The delegator merges, finding by finding, Critical and High only:**
   - **Both raise it** (the same defect, even if worded differently): it stands
     and goes to the owner.
   - **Only one raises it**: it is challenged. The other auditor gets that one
     finding (Fable in `challenge` mode, Codex through
     `/cc-suite:continue` on the audit's thread) and returns CONFIRMED or
     REFUTED. A refutation needs a reproduction or a counter-proof, the same
     bar as rule 70's downgrade rule. Without one, the finding stands at its
     severity. With one, the delegator weighs the two traces. If the
     disagreement still stands, the finding stands: the gate fails closed.
   - **Medium and Low** stay counts from both auditors, never registered.
4. **The gate** is the merged count: zero Critical and zero High after the
   challenges. The delegator posts the merged verdict on the PR: both count
   lines, each challenged finding with its outcome, and the merged count.
5. **Confirm rounds run on both.** After a fix, both auditors re-check, on the
   new SHA, every open Critical or High from either side (Fable in `confirm`
   mode). Each reports CLOSED / PARTIAL / OPEN per finding, plus any new
   Critical or High the fix introduced. One auditor's OPEN or PARTIAL is
   challenged as in 3.
6. **What gets audited.** Code changes under `src/` or `src-tauri/`, tests,
   and tooling (`scripts/`, `.github/`, `.claude/hooks`): both audits. Docs-only
   commits and device-check records: neither, as before (ADR-0085 Decision 4).
   **An ADR before the user is asked to accept it, and a plan before its first
   `impl` grant**: Codex `/cc-suite:review-plan` and the Fable auditor in
   `plan` mode, blind and merged the same way. The verdict is READY or not
   instead of a landing gate.
7. **In-flight work.** A handoff whose audit was requested before this record
   (D214 at `bb688100`) finishes under ADR-0085.

## Consequences

- **Gives:** two models on every landing, and a disagreement now costs a
  challenge instead of passing silently. Findings both models raise carry
  more weight, and a finding one model raises alone has to survive the other
  model's rebuttal.
- **Costs:**
  - Every handoff spends a Fable subagent's tokens on top of the Codex job,
    and every fix round spends two. The subagent starts on a cold cache.
  - Landing waits for the slower of the two, plus a challenge round trip
    whenever they disagree on a Critical or High.
  - The delegator's merge is new work and a new place to make a mistake. The
    merged verdict on the PR is what keeps it checkable.
  - Failing closed on a standing disagreement means one auditor's false
    positive can hold a branch until the delegator rules, or until the user
    defers it in the row's own words.
  - ADR and plan reviews become mandatory before acceptance or a grant, where
    they were ad hoc.
- **Forecloses:** landing on one auditor's clean verdict while the other's is
  missing. A missing verdict is a missing gate input, not a pass.
- ADR-0085's Status line carries the forward link. Rule 70 § Commits and
  branches item 4, its Sessions paragraph on subagent models, and CLAUDE.md
  § Plan Status Tracking change in the same commit as this record.
