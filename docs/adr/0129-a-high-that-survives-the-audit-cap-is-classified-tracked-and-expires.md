# 0129. A High that survives the audit cap is classified, tracked, and expires

## Status

Accepted, 2026-10-21. Decided by the user, recorded by herdr-delegator. The user's words: 「采纳 (Recommended)」.
Reviewed before acceptance by Opus (`plan` mode, three rounds, final READY C0 H0) and by gpt-auditor (`review-plan`,
two rounds, final READY C0 H0); merged record `~/.mdpro-redesign/herdr-spike/delegator/merged-ADR0129.md`.

It partially supersedes:
- [ADR-0120](0120-a-pre-landing-audit-runs-at-most-three-rounds-then-the-user-rules.md):
  - Decision 2: what the user is shown, and what a ruling records;
  - Decision 3: a fix made after the cap gets no further audit.
- [ADR-0121](0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md):
  - Decision 3: a pre-existing High's D row also carries a fix-by, and is listed at release
    checkpoints;
  - Decision 6: how a user ruling on a disputed finding is counted.
- [ADR-0115](0115-every-pre-landing-audit-runs-twice-codex-and-fable-on-the-same-dimensions.md)
  Decisions 3 and 5, rule 70 item 4, and ADR-0121 Decision 2's challenge of a `/security-review`
  finding. These apply after the cap only. There, a fix is confirmed by the finding's raiser(s),
  with no merge challenge and no both-auditor confirm.

Every other clause stays. That includes the three-round cap, the user's authority to rule, the
pre-existing proof and confirmation, and the blocking count.

## Context

The user asked (2026-10-21): 「三轮之后还有high没关，用subagent 搜索一下Claude、codex等相关最佳实践是怎样的，high默认存在，然后safe to merge吗」.
Then, after the answer: 「把这些缺口写成新 ADR，交给 auditor 审」.

The research is recorded in
[`docs/reference/20261021-open-high-at-merge-practice.md`](../reference/20261021-open-high-at-merge-practice.md).
Its finding is that **no source lets an open High merge by default.** Practice allows a merge with
a known High only after a recorded human decision, and only in three cases:
- **refuted:** closed with a written reason. This is the primary source, Anthropic's internal rule.
- **pre-existing:** tracked separately, with an owner. This is the primary source, Claude Code
  Review's Pre-existing tag.
- **risk accepted:** NIST SSDF RV.2 allows "other risk responses" besides a fix. That much is
  primary. The details of how an exception is handled — someone signs, a deadline is set, a
  compensating control is named — come from third-party practice. The GitLab handbook was read only
  as a search snippet.

At the cap, Anthropic's practice is to "step back and reconsider the approach" (primary).

ADR-0120 already refuses a default pass. Measured against practice, it and ADR-0121 have six gaps:
1. "Land as is" needs no D row and no owner.
2. No accepted, deferred or pre-existing High has a fix-by. No release step looks at them again, and
   ADR-0121 says "a release can carry a known High".
3. A ruling is not asked to classify the High.
4. No compensating control is asked for.
5. "Reconsider the approach" is not an option.
6. A fix after the cap is checked by no second model.

There are two post-cap cases so far. Both were ruled 「Land now, defer as a D item」:
- #508 (F508-1b → D293);
- #516 (F516-1's remainder → D301).

A third, D290, was given a fourth round as an exception.

**The release checkpoints that exist.** G0 (`.claude/skills/release-gate/SKILL.md`) runs after
every work item and never sees a version. The places where a version is actually cut are:
- the sequencing doc's per-version gate paragraph (`#release-0xy-gate`);
- the release runbook's "Before dispatching" step, which locks the SHA
  (`docs/guide/release-runbook.md`);
- a `release/x.y` hotfix (ADR-0083).

## Options considered

- **A. Keep ADR-0120 as it is.** Lost: the six gaps stay.
- **B. Forbid landing with any open High.** Lost: it removes the user's authority, which ADR-0120
  kept on purpose. D277 is a guard whose remaining gaps nobody would write by accident.
- **C. Day-based deadlines.** Lost: mdpro ships by version, not by calendar. A version-based fix-by
  is checkable at a step that already exists.
- **D. Classify, record, list the High at every release checkpoint, add "reconsider", and give
  each finding one post-cap fix with a scoped confirm.** (Proposed, below.)

## Decision

1. **Scope.**
   - Decisions 2–7 apply when any Critical or High is still open after round three.
   - Decisions 4 and 5 also apply to every pre-existing High that ADR-0121 lets through, in any
     round.
   - Decision 8, on gate exceptions, applies whenever one is granted, whatever the round or the
     count.
   They apply whatever the ruling is called: "land as is", "defer as a D item", or something else.
   A pre-existing High that passes ADR-0121 Decision 3 **does not block**, and that clause is
   unchanged. It takes part only through its D row's fix-by (Decision 4) and the release listing
   (Decision 5). A Critical is handled the same way as a High, with two additions: its fix-by is
   always the lowest version not yet released when the ruling is made, and it is never carried
   (Decision 5).
2. **The ruling request classifies each finding first.** For each finding it gives:
   - **origin:** introduced by a commit in `base..sha`, or pre-existing;
   - **evidence:** reproduced (the command and its decisive output), or disputed (each auditor's
     evidence);
   - **area:** product code (code a user runs) or tooling/test;
   - **impact:** what the user would see, whether data can be lost, the trigger path, and how likely
     it is.
3. **Options.** Each comes with its cost:
   - **fix, with a scoped confirm** (Decision 6);
   - **narrow or revert** the part of the PR that carries the finding;
   - **reconsider the approach.** The PR goes back to its plan. The resulting branch is a new
     range, and it gets three new rounds.
   - **refuted.** The finding is closed with the user's written reason.
   - **land with it open.**
4. **Landing with an introduced or disputed Critical or High open needs a record. Without it, the
   finding keeps blocking.** This covers every ruling except "fixed and confirmed" and "refuted".
   A pre-existing High needs only the D row, the owner and the fix-by, all set by the delegator
   when it registers the row (ADR-0121). It does not need the user's words in order to stop
   blocking. The full record has:
   - a D row with an owner;
   - a **fix-by**, written as a version number such as `0.3.7`, never as "next";
   - a **compensating control**, or "none" with the reason;
   - for product code, a `CHANGELOG.md` **Known issues** line under `## [Unreleased]`:
     - it states what the user would see, not how to trigger it;
     - it is removed in the commit that fixes the finding;
   - the user's words, quoted in the row, in `docs/audit/audit-log.md`, and on the PR.

   **How the fix-by is set:**
   - The delegator proposes it, and the user's ruling fixes it.
   - For a pre-existing High, the delegator sets it when it registers the D row. The first
     release checkpoint at which it is due puts it to the user.
   - A **reproduced data-loss finding in product code** gets the lowest version number not yet
     released when the ruling is made.
5. **Every release checkpoint assesses every tracked finding against the locked SHA.** A
   tracked finding is any D row created under Decision 4 or ADR-0121 Decision 3. It stays tracked
   even after it is closed on `master`, because an older release line may still carry the fault.
   The checkpoints are:
   - the version's `#release-0xy-gate` paragraph;
   - the runbook's SHA lock;
   - a `release/x.y` hotfix.

   **Each finding is assessed against the code at that SHA, not against commit ancestry.** The D
   row keeps two things:
   - **a presence check**: the file:line of the code at fault, plus a command that shows the fault.
     The command is preferably the finding's regression test run against that tree.
   - **its fix evidence**, for each release line: the fix commit or the cherry-pick.

   At the checkpoint, the delegator runs the presence check on the locked SHA and records one of
   three results:
   - **present**: the check shows the fault;
   - **absent**: the check passes at that SHA, whether through the fix, a backport or code that
     never had the fault;
   - **unknown**: the check cannot run there. This counts as present until the finding is
     assessed.

   Ancestry can suggest where to look, but it never proves a finding absent. These four cases are
   the acceptance examples:
   - a hotfix that carries a cherry-picked fault: present;
   - an old tag that predates the base where a pre-existing fault was found: still present;
   - a cherry-picked fix on a release line: absent;
   - a fix that was later reverted: present.

   A finding found present or unknown is **due** when its fix-by is at or below the version being cut, and also when
   that fix-by names a version that was skipped or renumbered. For each due finding the user rules
   on one of three outcomes:
   - it is fixed in this release;
   - it is carried to a named later version, which is a new fix-by, quoted. A Critical cannot be
     carried.
   - the release waits.

   A finding that is not due is shown for information only. Active gate exceptions are listed as
   well, under Decision 8.

   The rule is added to the runbook's "Before dispatching" step. From the next version on, every
   new `#release-0xy-gate` paragraph carries the list. It does not go into G0, and the user's own
   pending edits to the release-gate skill are left as they are.
6. **One post-cap fix per finding, with a scoped confirm.**
   - The fix lands after three checks pass:
     - the verifier;
     - `ci-gate`;
     - a confirm by **each detector that raised the finding**, reviewing only the fix diff and
       that finding. For a `/security-review` finding, the detector is the delegator's
       `/security-review` fork, re-run on the fix diff.
   - This confirm is not a fourth round.
   - It lands only if **every** raiser marks it CLOSED. It goes back to the user once if any of
     these is true:
     - a raiser marks it OPEN or PARTIAL;
     - the raisers disagree;
     - the fix diff introduces a new Critical or High.

     The options at that point are narrow or revert, reconsider, or land with the record
     (Decision 4). A second "fix" is not offered, so the loop is bounded.
   - **Narrow or revert after the cap** lands under the same three checks. Each raiser's scoped
     confirm judges that the code at fault is gone, or is no longer reached.
7. **Disputed findings are attributed.** When the user rules on a disputed finding, the row names
   whose claim was accepted. ADR-0121 Decision 6 counts it that way: a confirmed finding for the
   auditor whose claim was accepted, or a false positive for the auditor who raised it.

8. **Gate exceptions are registered whenever they are granted.** A gate exception is a user ruling
   that lets a landing pass a gate it would otherwise fail: a lane result, a receipt verdict, or a
   check that cannot run. Each one gets a row in a **Gate exceptions** table in
   `docs/audit/audit-log.md`. The row holds:
   - an id (`G<PR>-<n>`);
   - the gate that was waived;
   - the scope: either **this landing only**, naming the PR and its SHA, or **until** a named
     condition holds, usually a D row being fixed;
   - an owner, for an "until" exception;
   - the user's words, quoted.

   A this-landing-only exception closes when that landing lands. An "until" exception is listed at
   every release checkpoint while its condition is unmet. It is not judged by code ancestry: the
   checkpoint asks whether the condition now holds. The register starts with the exceptions already
   granted on 2026-10-21:
   - #518: the D302 lane, until D302 is fixed. Owner gpt-imple-1: D302 was folded into the ADR-0128
     rollout on 2026-10-21.
   - #518: the WI-1/2/3 receipt lines, this landing only;
   - #519: the D299 receipts, this landing only, if it lands.

The commit that accepts this record also makes these changes:
- rule 70 item 4;
- rule 60's severity rubric line on BLOCK;
- the runbook's "Before dispatching" step;
- forward links on the Status lines of ADR-0115, ADR-0120 and ADR-0121;
- the Gate exceptions table in `docs/audit/audit-log.md`, with its first three rows.

## Consequences

- **Every Critical or High that lands open has an owner, a version, and a place where it is looked
  at again.** "A known High in a release" stops being a silent default. The user chooses it again
  at every release.
- **Cost: ruling requests get longer.** Each finding needs a classification and an impact.
- **Cost: release checkpoints grow a list.** Due findings can make a release wait. That is the
  point, but it can delay a version that would otherwise ship.
- **Cost: a post-cap fix waits for its raisers' confirm.** It also spends auditor budget that
  ADR-0120 had saved.
- **Cost: a Known issues line publishes the defect.** The changelog feeds the in-app update notes
  (`latestJson.mjs`), so users read it. The line states the impact, not how to trigger it.
- **Cost: "reconsider" restarts the three rounds.** A PR can therefore take more than three rounds
  in total. The cap still binds each range.
- **Foreclosed:** landing an introduced or disputed Critical or High with no D row, no fix-by,
  or no quoted ruling; landing a pre-existing High with no D row or fix-by; and carrying a due
  finding through a release without a ruling. Day-based deadlines are not adopted.
