# 0085. A branch is audited before it is fast-forwarded onto `master`, and lands only with no Critical or High finding

**Status**: Accepted (2026-10-12). Partially superseded (2026-10-16) by
[ADR-0115](0115-every-pre-landing-audit-runs-twice-codex-and-fable-on-the-same-dimensions.md):
Decisions 1 and 2's single Codex audit and its confirm round become two
audits, Codex and Fable, merged by the delegator. Partially superseded (2026-10-17) by
[ADR-0120](0120-a-pre-landing-audit-runs-at-most-three-rounds-then-the-user-rules.md):
the fix-and-confirm loop is capped at three rounds, then the user rules. User's words: 「只有分支branch 经过Codex audit
并且修复，没有critical / high severity findings之后，才允许ff 到master」, given
when asked whether rule 70 already said so (it did not). Decided by the user,
recorded by mdpro-delegator. Partially supersedes
[ADR-0083](0083-master-is-the-single-integration-trunk.md) Decision 5 ("rule
70's landing protocol is unchanged"): the audit moves from after the landing to
before it. Replaces the post-landing clause of the 2026-10-10 standing order in
rule 70 § Commits and branches, item 4; the rest of that order (no human in the
loop, `gpt-6.1-sol` at effort `high`, Critical and High only) stands.

## Context

Since 2026-10-10 every landed work item has gone to `mdpro-codex-audit` for a
`/cc-suite:audit --mini` **after** the delegator's `git merge --ff-only`. The
auditor reports Critical and High findings to the delegator, which registers
each as a new D item for the owner; the landed commit is never reopened. In the
two days since, the audits of D171 (b79) and D111 (b80) each produced a High
that became a D item (D178, D179), and three audits (b84, b85, b86) were
outstanding on commits already on `master` when this record was written.

Forces as understood on 2026-10-12:

- With `master` now the single trunk ([ADR-0083](0083-master-is-the-single-integration-trunk.md))
  and pushed after every landing (「落地即推」), a High found after landing is
  on `origin/master` within the minute, and every peer rebases onto it.
- The audit is read-only, needs no `heavy-lock`, and runs in a separate session,
  so it can run alongside `mdpro-landing-verifier` on the same SHA.
- The auditor is one session. Audits queue behind each other; three were pending
  at once on 2026-10-12.
- A pre-landing finding is fixed on the branch that caused it, by the owner who
  still has the context. A post-landing finding becomes a separate D item and
  waits its turn.
- The audit's wall time per item has not been measured; the three pending
  requests give the first figures.

## Options considered

**A. Keep the post-landing audit** (status quo since 2026-10-10). Landing is
never delayed by the auditor; findings become D items. Lost: the user ruled
that a Critical or High must be fixed before the branch reaches `master`, and
under A it is on `origin/master` before anyone reads it.

**B. Audit the branch SHA before the fast-forward; zero Critical and zero High
is a landing condition** (chosen). The delegator dispatches the verifier and
the audit together on the handoff SHA; a finding goes back to the owner on the
same branch; the auditor confirms the fix, the verifier re-checks by tree
identity, then the delegator lands.

**C. Pre-landing audit only for BLOCK and MUST items, post-landing for SHOULD.**
Lost: it adds a severity judgement before the audit that the audit exists to
make, and the two Highs that motivated this record (b79, b80) both came from
items whose own rows were not BLOCK.

**D. Make the owner run the audit before handoff**, as part of its gates. Lost:
the audit's value is that it is not run by the author; rule 70 already keeps
the auditor reporting to the delegator, not the implementor, for this reason.

## Decision

1. **The audit is a landing gate.** After the ancestry and scope check passes,
   the delegator sends the auditor the branch SHA, its parent, the WI or D id
   and the owner, at the same time as it dispatches `mdpro-landing-verifier`.
   `git merge --ff-only` runs only when the verifier says PASS **and** the
   audit verdict counts zero Critical and zero High findings.
2. **A Critical or High goes back to the owner on the same branch.** The owner
   fixes it there (a new SHA, rebased if `master` moved, decisive tests re-run
   by the rule 10 table), the auditor confirms the fix on the new SHA (scoped to
   its findings, not a fresh full audit), and the verifier re-checks by tree
   identity. A partial fix does not land. Deferring a Critical or High instead
   of fixing it needs the user's word, quoted in the row.
3. **What the auditor reports is unchanged**: Critical and High findings in
   full; Medium and Low as a count in one line, never registered as D items
   (user decision, 2026-10-10). The verdict ends with one line counting all
   four severities so the delegator can read the gate off it.
4. **Exemptions are unchanged**: the delegator's docs-only commits and
   device-check records are not audited.
5. **Audits already requested on landed ranges** (b84, b85, b86 on
   2026-10-12) finish under the old order: a Critical or High there gets a D
   number and goes to the owner; the landed commit is not reopened.

## Consequences

- **Nothing on `master` after 2026-10-12 carries a known Critical or High.**
  That is the gain, and the only one.
- **Every landing waits for the auditor.** The verifier takes about two
  minutes; the audit's wall time is unmeasured and is the new critical path.
  With one auditor session, handoffs queue behind each other's audits, and a
  held handoff (two on the same parent) waits for the first one's audit too.
  The first week records the wall times in the delegator's log; if they make
  the queue the bottleneck, a second auditor session is the remedy, not a
  shorter audit.
- **A finding now costs a round trip on the branch** (fix, scoped re-audit,
  tree-identity re-verify) instead of a new D item. The owner keeps the
  context, but the item's row stays 未落地 for longer, and the owner cannot
  start the next item's commit until this one lands.
- **The auditor becomes a gatekeeper.** Its verdict format is part of the
  protocol: a verdict without the four-severity count line is incomplete and
  the delegator asks for it rather than reading the gate off prose.
- **ADR-0083 Decision 5 is no longer true as written**; its Status line
  carries the forward link. Rule 70 § Commits and branches, items 2 and 4,
  are rewritten in the commit that accepts this record.
- **Foreclosed**: landing first and auditing later, including "land now, audit
  at the release gate". The release-gate regression is a device check, not a
  code audit, and does not replace this one.
