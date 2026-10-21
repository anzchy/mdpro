# 0120. A pre-landing audit runs at most three rounds, then the user rules

## Status

Accepted, 2026-10-17. Decided by the user, recorded by mdpro-delegator. The user's words:
「规定以后codex audit最多2个round」. On the two questions the delegator put back, the user answered
「Audit + 2 confirms」 for what counts as a round, and 「Both auditors; D277 lands after FIX-3
(Recommended)」 for scope.

Partially supersedes [ADR-0115](0115-every-pre-landing-audit-runs-twice-codex-and-fable-on-the-same-dimensions.md)
and [ADR-0085](0085-a-branch-is-audited-before-it-is-fast-forwarded-onto-master.md), for the
unbounded "fix, then confirm again" loop. Everything else in them stands: two blind auditors, merging,
challenges, and zero Critical and zero High to land.

Partially superseded (2026-10-18) by [ADR-0121](0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md): Decision 1's round is Codex alone plus any Fable
challenge in the Low tier; Decision 2's escalation concerns open blocking findings. The cap and the
user's authority to rule are unchanged.

Partially superseded (2026-10-21) by [ADR-0129](0129-a-high-that-survives-the-audit-cap-is-classified-tracked-and-expires.md): Decision 2 (what a ruling shows and records) and
Decision 3 (a post-cap fix now gets a scoped confirm by its raisers).

## Context

Since ADR-0085, a Critical or High finding goes back to the owner, and the auditors confirm the fix.
Nothing bounded how many times that could repeat. On 2026-10-17, D277 (a z-index guard test) went
through a first audit and two confirms. Each round closed the reported class of bypass, and Codex's
next probe found another: a URL hiding an inline `zIndex`, then quoted keys and other file kinds,
then runtime-built property names and XML character references. Codex itself said the loop would
not converge, because a static scan cannot prove the absence of runtime-built names, and asked for a
scope ruling. The user gave that ruling (「Accidental drift only (Recommended)」) and then capped the
loop for every PR.

Each round costs a fix, two confirms, often a full unit lane, and an implementation slot held
for the whole time (ADR-0119).

## Options considered

1. **No cap (the status quo).** Lost: D277 showed it can run indefinitely on a guard whose
   remaining gaps nobody would write by accident.
2. **Two rounds: an audit and one confirm, then the user rules.** It was put to the user, who chose
   one more confirm. The user's first words said "2 rounds", but the answer to the clarifying
   question settled it at three.
3. **An audit and one confirm, then Fable decides alone.** Lost: it removes the second-model check
   at exactly the contested point.
4. **An audit and two confirms, then the user rules (chosen).**
5. **Cap Codex only, and leave Fable uncapped.** Lost to the user's choice: one cap for both
   auditors.

## Decision

1. A PR gets at most **three audit rounds**: round one is the blind first audit, and rounds two and
   three are confirms on fix SHAs. The cap counts rounds, not runs. A round is Codex and Fable
   together, and a challenge inside a round does not count as a round of its own.
2. If the merged verdict still has an open Critical or High finding after round three, there is no
   round four. The delegator brings the open findings to the user, with each auditor's evidence. The
   user rules: land as is, fix without re-audit (the verifier and CI still gate), defer with a D
   number, or something else. The user's words go in the row. The gate never passes without that
   ruling.
3. A fix made after the cap, on the user's word, lands after the verifier and `ci-gate` pass, with no
   further audit round.
4. **D277**, the case that prompted this: it has used three rounds. FIX-3, the `@keyframes` prelude
   and the pipe-less or headerless table row (within the scope ruling 「Accidental drift only
   (Recommended)」), lands after the verifier and CI, with no fourth round.

## Consequences

- A PR's audit cost is bounded: three rounds, then a ruling.
- **Cost**: a High still open after round three can land on the user's word without a second model
  confirming the fix. A fix in round three's wake is checked only by the owner's tests, the verifier
  and CI.
- **Cost**: the user is interrupted whenever round three ends with an open finding. Before, the loop
  went on without asking.
- **Cost**: an auditor that knows the cap could defer findings to a late round. Round one is still
  blind and full-scope, which is the main defence.
- Rule 70 item 4 changes in the same commit as this record.
