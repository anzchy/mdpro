# 2026-11-10: Audit rounds converge: CI before a confirm, instance sweeps, checked citations, sized tickets, round records

- **Decided:** 2026-11-10, by the user: 「接受 (Recommended)」. This follows plan review by both auditors:
  - round 1: NOT READY, C0 H5;
  - round 2: READY from both, gpt C0 H0 M3 and opus C0 H0 M3 L6.

  The cheap Mediums and Lows were folded in before commit.
- **Asked for:** on 2026-11-10 the user asked:
  - 「现在好像经常出现不断audit，不断fix，次数累计达4次及以上的，查一下同行，或者大厂(microsoft, Google, Meta, Amazon, Claude, Codex)相关最佳实践如何？」
  - then 「好的，按照建议写一份新 ADR 走评审」.

  On the delegator's correction that ADR-0165 puts process decisions in this log, the user chose
  「决定日志条目 (Recommended)」.
- **Decision:** five rules move findings out of the audit loop before a round starts. ADR-0143's two-round cap, the
  confirm scope of ADR-0121 decision 4, and every auditor request template stay as they are.
- **Why:**
  - **Rounds past the cap.** Items have gone beyond ADR-0143's two rounds through extra rounds, post-cap fixes and
    plan revisions:
    - F516-1 found a new triggering case of the same class in each of r1–r3;
    - MIG-002 r2 raised four new Highs, two of them a cited test that does not assert what the spec claims;
    - GH706 and GH727 each had a range-caused CI red that the auditors found themselves.
  - **Practice elsewhere.** Microsoft's CodeFlow work describes two to four iterations before check-in as not unusual
    ([Bosu, Greiler, Bird](https://www.microsoft.com/en-us/research/wp-content/uploads/2015/05/PID3556473.pdf)).
    Google keeps changes small ([small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)).
    Anthropic's loop guidance fixes "done" in advance and checks it outside the agent
    ([loops](https://claude.com/resources/articles/getting-started-with-loops)).
  - **Rejected: a narrower confirm scope.** It would let a late High on code the fix did not touch become an issue.
    This was considered and rejected again, on the facts on which ADR-0121's option 5 lost: a High that the PR
    introduced must not land because it was found late.
  - **Rejected: CI before every round-one audit.** This was revision 1, and it lost to the cheaper rule below. Round
    one stays parallel with CI, as ADR-0095 designed it.
- **The rules:**
  1. **CI is read before the merge, and is green before a confirm.**
     - Round one is unchanged: the verifier, CI and both audits start at once (§ Landing item 2).
     - Before the delegator merges round one, it reads `ci-gate` on that SHA. A range-caused red goes into the same
       fix brief as the findings, so it never costs a round of its own.
     - A confirm request goes out only when `ci-gate` on the fix SHA has finished green. The one exception is a red
       outside the range.
     - **Outside the range** means one of two things:
       - the same test fails on a recorded run at the base or at master `<M>`, and the request cites the run id;
       - or the test is a registered intermittent, and the request cites its issue or D row.

       Anything else is the range's red.
     - A red outside the range cited in three items' confirm requests gets an issue with an owner. An ADR-0129
       post-cap confirm follows the same rule.
     - Landing still needs a green `ci-gate` (ADR-0095 decision 5).
  2. **Instance sweep for every Critical and High.**
     - The fix brief names the finding's bug class.
     - The handoff's "Fix <n>" section has a sweep table. Its rows are instances: a site combined with a triggering
       case or input shape.
     - The table covers the whole class wherever the range reaches it, and is not limited to the changed lines.
     - Each row is either fixed, with its regression test, or not affected. A not-affected row carries a file:line
       trace, or a command and its output.
     - The auditors' confirm scope stays ADR-0121 decision 4's. The table is input they read with the handoff. A
       missed instance keeps the finding PARTIAL, as today.
  3. **Citation check for planner handoffs.** This applies to a spec, ticket or revision handoff from the planner.
     It does not apply to ADRs or to delegator-written entries.
     - The handoff lists every test, fixture and ADR clause it cites as evidence: the exact path and test name, or
       the decision number; whether it exists at the named master SHA; and the quoted assertion or sentence.
     - Before the plan review, the delegator checks that every test, fixture and ADR clause cited as evidence has a
       row, and sends a missing row back. It then checks every row that a normative clause rests on. It then checks
       randomly chosen other rows until five rows are checked in all, or every row when there are fewer than five.
     - **A row fails** when the quoted text is not at that path and name at `<M>`, or does not support the claim.
     - A failed row goes back to the planner before the review.
  4. **Ticket size budget.** The plan-review request names any ticket over the budget, with its reason. `/to-tickets` aims each ticket at no more than about 400 changed production lines,
     counted as `audit-dimensions.md` § Split recommendation counts them (its exclusions apply).
     - A ticket expected to go over says why in its scope, and the plan review checks the reason.
     - The number follows that split rule. A spec may tighten it; loosening it needs a new entry.
  5. **Round record.** Every row in `docs/audit/audit-log.md` § Ranges records three things: `Rounds` (`r1`, `r2`,
     `r2+extra`), `Days` from the first request to the outcome, and `Causes`. This covers landed, superseded and
     abandoned rows alike. The same three fields go in each plan review's merged-verdict file.
     - Each round after the first takes one cause from this list:

       | Cause | Meaning |
       |---|---|
       | `r1-findings` | the normal fix and confirm of round one's findings |
       | `late-finding` | names the auditor and why round one missed it |
       | `partial-class-fix` | an earlier fix missed an instance |
       | `ci-red` | a red on a fix SHA held a confirm |
       | `citation` | a cited source turned out wrong |
       | `disagreement` | the auditors disagreed |
       | `scope-change` | the item's scope changed |

     - A confirm held by a fix-SHA red takes `ci-red`, not `r1-findings`. A post-cap fix under ADR-0129 is recorded as
       `post-cap-fix` and not counted as a round.
     - In § Ranges, the three fields go in the existing `Rounds` cell, as `<rounds> · <days> d · <causes>`, so the table
       keeps its columns.
     - At each release checkpoint, the delegator reports to the user the slowest quarter of outcomes since the last
       checkpoint, grouped by cause. It also reports the share that reached C0 H0 by r2 with no post-cap ruling.
     - `docs/audit/escapes.md` and ADR-0121 decision 6's escape definition are unchanged: a late finding is not an
       escape.
- **changes:**
  - `.agents/skills/mdpro-delegator/references/landing-and-audit.md`: a new § Converging rounds, and one sentence in
    § Landing item 2 pointing to it.
  - `references/templates/fix-brief-template.md`: the AC for the sweep table.
  - `references/roster-and-routing.md` § Planner: the citation table and the size budget.
  - The ADR-0095 Status line gains "Consequences' 'in parallel with the verifier and the audit', for confirm
    rounds: folded and changed (2026-11-10) by `docs/agents/decisions/20261110-audit-rounds-converge.md`", following
    the 2026-11-08 precedent.
  - No `*-request-template.md` or `merged-verdict-template.md` changes, so ADR-0121 decision 6's replay is not
    triggered.
- **supersedes:** ADR-0095 § Consequences "A landing waits for CI … in parallel with the verifier and the audit.
  Usually it costs no extra time", for confirm rounds only. A confirm now follows a green or out-of-range `ci-gate`. Round one and every other ADR-0095
  clause stand. ADR-0121 decisions 4 and 6, ADR-0143, ADR-0129, and the 2026-10-10 rule (Mediums are listed, not
  registered) are unchanged.
- **Costs:**
  - A confirm waits for CI on the fix SHA, about 10–30 minutes.
  - The sweep table lengthens each fix.
  - The citation table and the spot check add work for the planner and the delegator.
  - The size budget may split a ticket that the graph would have kept whole.
  - The record adds three fields per row.
- **gate-sensitive:** yes. It adds a condition before every confirm request, and so a landing step. It edits
  `landing-and-audit.md`, which is gate text, but no gate-tooling file. Classified by herdr-delegator on 2026-11-10.
  Both auditors plan-review this entry and its rule edits before they land.
