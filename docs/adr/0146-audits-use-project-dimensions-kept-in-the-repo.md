# 0146. Audits use project dimensions kept in the repo, with a lifecycle check, a per-AC verdict and a trace bound on suspected Highs

## Status

**Accepted, 2026-10-27, by the user:** 「Accept (Recommended)」, asked with the replay verdict "insufficient evidence" and
without its numbers (ADR-0121 decision 6), and with decision 4's narrowing stated. Proposed earlier the same day;
drafted for herdr-delegator (Claude route). It covers items 2 and 7 of the picsee workflow
comparison ([`docs/knowledge/20261027-picsee-workflow-comparison.md`](../knowledge/20261027-picsee-workflow-comparison.md)).
The user adopted all seven recommendations: 「建议1-7 均采用」 (2026-10-27). The user settled the first draft's open
questions on 2026-10-27; see § User rulings.

**Revised after plan review round 1** (gpt-auditor C0 H7, opus-auditor C0 H3 M6 L3; reports
`herdr-spike/{gpt-auditor,opus-auditor}/ADR-0146-r1.md`, merged as A1–A7). See § Review round 1 dispositions.
**Revised after round 2**, the last round under ADR-0143 (gpt-auditor C0 H0 M1, opus-auditor C0 H1 M2 L4;
`ADR-0146-r2.md`). See § Review round 2 dispositions.

**Escape replay (ADR-0121 decision 6): run 2026-10-27, result "insufficient evidence".** Twelve runs (three escapes ×
gpt-auditor and opus-auditor × current and proposed form), scored by the criterion fixed in advance; scoring record
`~/.mdpro-redesign/herdr-spike/delegator/adr0146-replay/score.md`. Recorded here for the record only; the user decides
without these numbers.
- Recall, current form: gpt 0/3, opus 1/3 (e1, out-of-sample, as Medium). Proposed form: gpt 0/3, opus 1/3 (e3,
  in-sample, through a dimension-L platform-order entry at `menu_capture_state.rs:208`; borderline, since the fault's
  lines are `:187-201`; on the strict reading opus proposed is 0/3). High-recall 0/3 in every cell.
- No run's catch was voided by the read barrier. Recurring unexplained findings (e2: a refused close leaves the Rust
  state removed, 4 reports; e3: the menu mapper can fail silently, 3 reports) are listed in the scoring record, not
  judged refuted.
- Cost: gpt 3m50s–5m43s and 11–18k output tokens per run, the proposed form about the same; opus 4m47s–9m55s and
  27–51k output tokens per run, the proposed form about 20 % more.
- **The result is "insufficient evidence"** (three escapes, below five; ADR-0121 decision 6). The user decides without
  the numbers. The numbers are recorded here for the record only.
- **Escapes 2 and 3 are in-sample for decision 2's platform-order clause.** That clause was written after them, so a
  catch on them is expected by construction.
- **Escape 1 (D315) is the only out-of-sample escape.**

**Partially supersedes, by name** (each accepted body stays as written; forward links are added in the implementing
commit):
- **[ADR-0115](0115-every-pre-landing-audit-runs-twice-codex-and-fable-on-the-same-dimensions.md) decision 1**, where it
  defines the dimension set as cc-suite's "mini's five unless the request names full's nine". The two auditors still
  share one set, and that set is now the repo file (decision 1).
- **ADR-0115 decision 3**, the clause "Medium and Low stay counts from both auditors". Mediums are now listed
  (decision 6). "Never registered" stands.
- **[ADR-0121](0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md) decision 1**,
  in two places:
  - the Audit column now means the project file's mini or full set, including the two cross-tier dimensions;
  - the Low row's `docs/**` no longer covers the dimension file (decision 1).
- **[ADR-0085](0085-a-branch-is-audited-before-it-is-fast-forwarded-onto-master.md) decision 4, and rule 70's
  direct docs-only commits**, for `docs/agents/audit-dimensions.md` only. That file never changes by an unaudited
  docs-only commit (decision 1).
- **rule 70 Commits item 4**, four clauses:
  - "runs `/cc-suite:audit --mini`";
  - "mini's five unless the request names full's nine";
  - "both auditors on full's nine dimensions" in the High-tier bullet;
  - "reports only Critical and High findings and drops Medium and Low ones, keeping just their count".
- **rule 71 "A review with zero Critical and zero High does not block"**, narrowed for one case. A Medium `NOT PROVED`
  does not license landing the AC unmet (decision 4).
- **rule 71 § Briefs "sends the item back before any audit starts"**, which gains one exception: an unproved AC that the
  delegator accepted under decision 4 goes to audit.

**Unchanged:**
- the downgrade rule (rule 70 item 4, 2026-10-16); decision 5 only adds to it;
- the tiers, the pre-existing proof and the confirm scope (ADR-0121 decisions 1–4);
- the escape replay (ADR-0121 decision 6), which this ADR runs in full (decision 8);
- reading from the diff outward ([ADR-0138](0138-effort-follows-task-difficulty-and-audits-read-from-the-diff-outward.md)
  decision 4);
- two auditors and two rounds, with challenges inside a round
  ([ADR-0143](0143-every-audit-runs-gpt-auditor-and-opus-auditor-together-capped-at-two-rounds.md));
- device proof of `device` ACs ([ADR-0144](0144-behaviour-acs-are-proved-in-the-real-app-before-landing.md)).

## Context

Measured on 2026-10-27.

- **Races were found one per round.**
  - D290, WI-4.3b and D305 each took 3–5 audit rounds. Each round found one more "something happens during an `await`"
    case ([`20261027-repeated-development-and-token-cost.md`](../knowledge/20261027-repeated-development-and-token-cost.md):27,35).
  - Rework is about 30–40 % of all spend, and D305's share is 94 %.
  - Neither dimension set names lifecycle. ADR-0138 decision 4 asks for a lock, writer and lifecycle map, but no report
    line shows whether that map was built.
- **The audit does not check that the tests prove the ACs.**
  - mini skips test files "unless a finding depends on one".
  - full's "Testing & Validation" asks about coverage gaps.
  - The delegator's check under rule 71 § Briefs confirms only that each AC has evidence
    ([`20261027-acceptance-mechanism-vs-pstack.md`](../knowledge/20261027-acceptance-mechanism-vs-pstack.md):19-22).
- **Rule 71 § Briefs is inconsistent about unproved ACs.** It lets an implementor hand off with an AC it names
  unproved, and it also sends an AC with no evidence back "before any audit starts".
- **The dimensions live in two copies, and they have drifted.**
  - gpt-auditor's copy is `~/.mdpro-redesign/herdr-spike/gpt-auditor/BRIEF.md`. It is unversioned and outside the repo.
    It still speaks of `/new`, Fable and FIXED, and it says Mediums are counts only.
  - opus-auditor follows `.claude/agents/mdpro-fable-auditor.md` "in your worktree", a detached checkout at whatever SHA
    it was left on. That file has "A suspicion without a trace is at most Medium" (:85); gpt-auditor's brief does not.
- **picsee keeps one dimension file in its repo** (`picsee/docs/agents/audit-dimensions.md`). It puts concurrency and
  "do the tests prove each AC" on every tier, and requires a `COVERAGE` line and a per-AC verdict (:92-107). It caps
  an untraced suspicion at Medium (:66-68), suggests a split above about 400 production lines (:72), and makes "an AC
  claimed but not met" a High (:57).
- **Medium-only reviews land.** The user ruled on 2026-10-25: 「if no c and no h, only medium exists, merge it」 (rule 71).
- **The escape replay is required.** ADR-0121 decision 6 requires the current and proposed auditors to replay every
  escape, and it says the proposing ADR records their recall and cost. `docs/audit/escapes.md` has three rows:
  - 1, D315, `draft/protection.rs`;
  - 2, D319, `menu_target.rs`;
  - 3, D319 Fix 1+2, `menu_capture_state.rs`.

  Escapes 2 and 3 are AppKit-ordering faults that "a reader of the diff cannot see" (ADR-0144).

## Options considered

**Where the dimensions live**
1. **Keep the two copies** (today). Lost: they have drifted, and one is unversioned.
2. **`.claude/agents/mdpro-fable-auditor.md` as the single source.** Lost:
   - Claude Code loads every `.md` there as an agent;
   - it mixes Claude-only modes with shared rules;
   - Codex would read another runtime's agent file.
3. **A reference inside the delegator skill.** Lost: auditors would depend on a delegator-owned file, which ADR-0147 is
   filling with delegator-only text.
4. **`docs/agents/audit-dimensions.md`, pinned by blob id per review.** Chosen: it matches picsee, both runtimes can
   read it by path, and it is versioned.

**What the set contains**
1. **picsee's D1–D12 wholesale.** Lost: several of them are picsee-specific, and rule 60's Critical Pass is mdpro's
   High definition.
2. **One set on every tier, with depth set by tier.** Lost for now: it would mean nine dimensions on every Medium audit,
   against ADR-0121's cost tiers. This can be revisited with audit-log data.
3. **Keep mini and full, and add two cross-tier dimensions plus report lines.** Chosen.

**The trace bound**
1. **None** (gpt-auditor today). Lost: an untraced High still blocks.
2. **A cap on any High missing a trace element, applied by whoever reads it.** Lost in review: it can lower an observed
   or traced High without the counter-proof that rule 70 requires.
3. **Untraced suspicions are dropped.** Lost: they are the cheapest lead to the next race.
4. **A cap only on the raiser's untraced suspicion, with a same-round trace challenge on `hard` ranges.** Chosen.

## Decision

1. **One file, pinned per review.**
   - `docs/agents/audit-dimensions.md` holds:
     - the mini, full and plan sets;
     - L and A;
     - the severity table and the evidence rules (decisions 4–5);
     - the report shape (decision 3);
     - the High-tier security section that ADR-0143 decision 1 puts in both requests.
   - **Pinning.** Every request names a `master` SHA `<M>` and the file's blob id `<B>`, where
     `git rev-parse <M>:docs/agents/audit-dimensions.md` equals `<B>`. Each auditor:
     - reads `git cat-file -p <B>`;
     - reads its procedure source at `<M>`, never from a worktree:
       - opus-auditor reads `mdpro-fable-auditor.md` with `git show <M>:<path>`;
       - gpt-auditor takes its mode, read barrier and verdict tokens from the request (built from the templates at
         `<M>`) and its launch-only brief. It does not read the Claude agent file (Options, location 2);
     - echoes `<B>` in its report.

     A report with a different `<B>` is rejected and re-asked (decision 3).
   - **One pin per review.** Round one, its challenges, the confirm and the confirm's challenges all use round one's
     `<M>` and `<B>`.
   - **Bootstrap.** The implementing PR, which creates the file, is audited under the rules on `master` when it is
     requested (today's briefs and definition). Its draft file has already been reviewed (decision 8). The first
     request after it lands is the first pinned one.
   - **Changing the file.** A change goes in a PR, never in a direct docs-only commit. The PR is audited at High tier
     under the old pinned blob. Its proposed blob gets plan review by both auditors before it lands. A change to a
     dimension, a severity rule or the report shape also triggers ADR-0121 decision 6.
   - **`REVIEW.md`** (ADR-0121 decision 5, still unwritten) holds per-area examples of what failure looks like, once
     written. It never repeats the dimensions.
2. **Two dimensions on every tier**, added to mini and to full. Plan mode keeps its five.
   - **L. Lifecycle & concurrency.**
     - **Scope:** the `await`, lock, timer, listener, IPC round trip and queued-operation sites that the range adds or
       modifies, plus the sites on the ADR-0138 decision 4 map (acquirers of each lock it touches, writers and deleters
       of each persisted value it changes, callers, and window, close and quit lifecycles). Code reached only
       transitively beyond that map is out of scope.
     - **For each site, five cases:**
       - (1) the document closes, is replaced or is reopened;
       - (2) the window closes, or quit starts;
       - (3) a second event arrives part-way;
       - (4) a stale token or result returns;
       - (5) a Rust lock is held across a call that blocks or re-enters.
     - **Platform order:** whether a platform event order that a test assumes is backed by evidence. An assumed AppKit
       order needs a `device` AC (ADR-0144).
   - **A. Evidence proves each AC.** Its scope is the ACs in the brief, or in the request when there is no brief. With
     no ACs, the report says `A n/a: no ACs`, and the request must say so. What `PROVED` means depends on the evidence:
     - **Test.** The auditor names one plausible wrong implementation and the assertion in the cited test that fails on
       it (the spec-adversary's form, rule 71 § Briefs). The test reaches the behaviour through the entry path that the
       AC names. When the AC names none, it uses the brief's entry-path map or the matrix's "every caller or entry path"
       row.
     - **Command or lane.** The stated command, run at the SHA, exercises the behaviour, and the decisive output in
       the handoff is what that command prints. The auditor re-runs it only when the request allows.
     - **Docs or config.** The content at the SHA says what the AC requires.
     - **`device` AC.** `PROVED (unit part) · device → card <id>`. The verdict covers the code and the unit evidence
       only. A pending real-app half is never `NOT PROVED`, because ADR-0144's cards own it.
   - **On a confirm,** the auditor re-verdicts every AC the fix diff touches and every AC that was not `PROVED`. The
     others carry over by reference.
3. **Report lines.** These are added to the shape in both definitions:
   - **`COVERAGE`**, one entry per dimension, `ok` with what was read, or `n/a` with a reason.
     - **L's entry** lists each in-scope site against the five cases. Each case is marked handled (with the guard or
       test), a finding id, or `n/a` with a reason. A blanket `L ok` is a skipped dimension.
     - The two auditors' site lists can be compared. A site on one list but not the other is not a finding by itself.
   - **`AC`**, one line per AC: `PROVED`, `NOT PROVED` or `WRONG`, with the auditor's own evidence in decision 2's form.
   - **Re-asks.** The delegator rejects a report that:
     - has no `COVERAGE` line;
     - skips a dimension without a reason;
     - has an AC without a verdict;
     - names a blob other than `<B>`;
     - raises a traced runtime High without "why tests miss it".

     It re-asks in the same round. The re-ask goes to a fresh pane (ADR-0131), given that auditor's own report and
     asked only for the missing lines. Reading one's own report does not breach the round-one barrier, and the re-ask
     is not a new round.
4. **An AC that is not met is High** (user: 「WRONG and falsely-claimed are High (Recommended)」):
   - `WRONG` is High.
   - `NOT PROVED` is High unless the delegator accepted the AC as unproved before the audit.
   - **Accepting an unproved AC.**
     - **No silent acceptance.** An implementor that names an AC unproved in the handoff does not make it Medium by
       naming it. Rule 71 § Briefs sends the item back before audit unless the delegator records an acceptance and the
       audit request cites it.
     - **The delegator accepts only when one of these holds:**
       - (a) a revised brief moves the AC to a later item;
       - (b) it is the real-app half of a `device` AC. Decision 2 never marks that half `NOT PROVED`, so (b) only
         records the hand-off to ADR-0144's cards;
       - (c) the user waives it, recorded as an audit-log gate exception.
     - **With acceptance,** `NOT PROVED` is Medium. This does not license landing the AC unmet: the item lands only
       under (a), (b) or (c).
5. **Raising needs a trace; lowering needs a counter-proof.**
   - **What the bound caps.** It caps only the raising auditor's own suspected runtime defect, at the moment it is
     raised. A suspicion with no file:line and no ordered trace from an ordinary path is raised at most as Medium.
   - **Each kind of blocker has its own decisive evidence, and these are never capped:**
     - a failing test, failing command or failing device card: the output;
     - a reproduced defect: the reproduction;
     - an observed rule-60 Critical Pass violation: the file:line of the violation, because the rule is the proof;
     - a `WRONG` AC: the AC text plus the code or evidence that contradicts it.
   - **Traced runtime Highs.** These also state why existing tests miss them. If that is missing, the delegator re-asks
     (decision 3). The finding is never capped for that reason.
   - **Lowering is unchanged.** Once a report holds a Critical or High, nobody lowers it (not the delegator at merge,
     and not the other auditor) without a reproduction or a counter-proof (rule 70 item 4). "Unlikely" is not a
     refutation.
   - **Supplying the trace.** The raiser, the other auditor in a challenge, or the delegator (with a file:line trace,
     sent as a challenge) may supply a missing trace. The finding then stands as High.
   - **`hard` ranges.** Every untraced lifecycle Medium goes to the other auditor in the same round as a "trace this"
     challenge. If it is traced, it stands as High. Otherwise it stays a listed Medium. Like any challenge, this is not
     a round (ADR-0143).
6. **Mediums are listed, one line each.** Lows are counted only. Listing is what lets rule 71 record Mediums in the
   handoff, the PR and the audit log. An untraced lifecycle Medium names its site.
7. **A large range gets a split recommendation** (advisory; user: 「400 lines now (Recommended)」).
   - **Trigger:** more than about 400 changed production lines, counted as added plus deleted in
     `git diff --numstat base..sha`.
   - **Excluded:** `tests/`, `*_tests.rs`, inline `#[cfg(test)]` modules (estimated from the diff), `docs/`, lockfiles,
     `receipts.json` and the generated ledger.
   - **Counted:** `src/`, `src-tauri/src/`, `scripts/`, `.claude/` and `.agents/`.
   - **Result:** one Medium recommending a split. It does not block and opens no fix round. The threshold is revisited
     from audit-log data.
8. **The escape replay runs before acceptance, on all three escapes** (user: 「Replay escapes 2 and 3 (Recommended)」;
   escape 1 is included as ADR-0121 decision 6 requires).
   - **Proposed auditor.** The draft `audit-dimensions.md` and the revised briefs and definition, kept in the
     delegator's scratch area.
   - **Current auditor.** Today's definitions.
   - **Conditions.** Both models run on each escape's audited range at its pre-fix SHA `<pre-fix>`.
   - **Read barrier**, stated in every replay request:
     - code is read only with `git show <pre-fix>:<path>`;
     - the auditor does not read `docs/audit/`, the escape's D rows, ADR-0144, ADR-0146, or any commit after
       `<pre-fix>`;
     - the report lists every file it read, so the delegator can check the barrier held.
   - **Catch criterion, fixed in advance.** An escape is caught when any finding names the same file and the same fault:
     - a listed Medium counts;
     - an L entry that names the site and asks for a `device` AC for that ordering counts;
     - whether the catch was High (would have blocked) is recorded separately.
   - **Recorded in this ADR's Status block,** per auditor and per form:
     - the recall;
     - the High-recall;
     - findings the escape's fix does not explain, recorded separately; only a refuted one counts as a false positive
       (ADR-0121 decision 6);
     - the token and time cost.

     Escapes 2 and 3 are marked in-sample and escape 1 out-of-sample.
   - **Below five escapes, ADR-0121 decision 6 applies unchanged** (user: 「Follow ADR-0121 (Recommended)」). The
     result is "insufficient evidence", and the acceptance question states that verdict without the numbers.
   - **The replay is also the dry run.** It validates both request forms against both auditors' new contracts before
     anything is activated.

**Implementation** (one PR, High tier, after acceptance; bootstrap per decision 1):
- **Created:** `docs/agents/audit-dimensions.md`, the reviewed draft from decision 8.
- **Changed in the repo:**
  - `.claude/agents/mdpro-fable-auditor.md`:
    - the frontmatter `description`;
    - its input contract's mini/full wording;
    - the mini rule "skip test files" (A reads them);
    - § Dimensions, § Severity and § Output, which become a pointer to `<B>`.

    The modes and procedures stay.
  - The delegator templates under `.agents/skills/mdpro-delegator/references/templates/`. They gain `<M>`, `<B>`, the
    `COVERAGE` and `AC` lines and the acceptance citation from decision 4:
    - `audit-request-template.md`;
    - `confirm-request-template.md`;
    - `challenge-request-template.md`, which adds "trace this";
    - `plan-review-request-template.md`, which takes the plan set from the file;
    - `merged-verdict-template.md`, which adds listed Mediums, COVERAGE and AC verdicts, and both auditors.
  - `.agents/skills/mdpro-delegator/SKILL.md` step 7: the re-ask checks in decision 3, and the acceptance in decision 4.
  - rule 70 Commits item 4: the four superseded clauses.
  - rule 71:
    - § Audits under herdr: names the file;
    - § Briefs and self-acceptance: decision 4's acceptance;
    - the zero-C/H clause: the narrowing.
  - Forward links on ADR-0115's and ADR-0121's Status lines, and on ADR-0085's.
- **Changed outside the repo, coordinated with that PR but not part of it.** In the same delegator turn as the landing,
  the gpt-auditor and opus-auditor `BRIEF.md` files lose every protocol instruction, keeping only the pane, model, path
  and reset details:
  - the dimensions;
  - "Mediums are counts only";
  - "exactly one count line";
  - FIXED;
  - "in your worktree".

  The security section moves into the file. The new rules apply from the first request after that turn.

## Consequences

- **Gained.**
  - **One rule set.** It is versioned and pinned, so both auditors provably read the same rules.
  - **Every audit shows what it read.** L's per-site list makes the race check auditable.
  - **Unmet ACs block.** A wrong or unproved AC blocks, unless it was accepted on a stated ground.
  - **Speculative Highs stop costing fix rounds.** An observed or traced High is never capped.
- **Costs.**
  - Longer reports and more reading: L and A apply on Low and Medium tiers too, where most entries are `n/a`.
  - Decision 4 adds blocking findings, and fix rounds within ADR-0143's cap of two. Some will reach the user.
  - Decision 5's "trace this" challenges add work inside a round on `hard` ranges.
  - Decision 4's acceptance adds a delegator step before every audit that has an unproved AC.
  - The trace bound can still hold back a real race that neither auditor can trace. It surfaces as a listed Medium.
  - The replay costs about two auditor runs per escape per model before acceptance, for a result that stays
    "insufficient evidence".
  - Reading at a pinned `master` means a rule change applies only after it lands, and a dimension change costs a PR.
  - The off-repo briefs still exist, now only as launch notes. Their edit is a manual step in the landing turn.
- **Foreclosed.**
  - Auditor protocol outside the repo, or different between the two auditors.
  - Capping an observed or traced High.
  - Landing an AC that was named unproved without an accepted ground.
  - Silently dropping Mediums.

## User rulings (2026-10-27, before plan review)

1. **An unmet AC** (decision 4): 「WRONG and falsely-claimed are High (Recommended)」.
2. **The escape replay** (decision 8): 「Replay escapes 2 and 3 (Recommended)」.
3. **The split threshold** (decision 7): 「400 lines now (Recommended)」, advisory, to be revisited from audit-log data.
4. **Replay numbers below five escapes** (decision 8; 2026-10-27, after round 2): 「Follow ADR-0121 (Recommended)」.
   The result is "insufficient evidence", and the user decides without the numbers. The numbers are recorded in the
   Status block only.

**Note for the acceptance question.** After review, ruling 1 is narrower than given, in the safe direction. Its
Medium branch, for an AC the handoff names unproved, now also needs the delegator's acceptance, recorded before the
audit on ground (a), (b) or (c) of decision 4. Without that acceptance, `NOT PROVED` is High.

## Review round 1 dispositions

| Finding | Source | Changed clause |
|---|---|---|
| A1, trace bound lowering a real High | gpt H3, opus H3 | Decision 5: caps only the raiser's untraced suspicion; evidence forms for failed tests, cards, reproductions, rule-60 violations, WRONG ACs; lowering keeps rule 70's counter-proof; a missing "why tests miss" is re-asked, not capped; challenger or delegator may supply the trace; same-round "trace this" on `hard` ranges. Options: trace-bound option 2 added as the loser. |
| A2, unproved AC escapes as Medium | gpt H4, opus H2 | Decision 4: the delegator's recorded acceptance on ground (a), (b) or (c) before audit; otherwise `NOT PROVED` is High. A Medium never licenses landing the AC unmet. The supersession list narrows rule 71's zero-C/H clause; Context names the rule 71 inconsistency. |
| A3, replay timing and escape set | gpt H2, opus H1 | Decision 8: all three escapes (escape 1 included per ADR-0121 decision 6), before acceptance, on the draft file; catch criterion fixed in advance; result in the Status block. Status stays Proposed until it is there. (How the result is presented was revised in round 2, N1.) |
| A4, bootstrap and read-at-master | gpt H1, opus M1 | Decision 1: `<M>` and `<B>` pinned and verified; one pin per review, challenges and confirm included; the procedure file is read at `<M>`, not from a worktree; bootstrap rule; a PR editing the file is audited under the old blob. |
| A5, dimension A and evidence types | gpt H5, opus M5 | Decision 2 A: `PROVED` defined per evidence type (test, command or lane, docs or config, `device`); `device` form `PROVED (unit part) · device → card`; no-brief ranges; confirm scope. |
| A6, blanket L ok | gpt H6, opus M4 | Decision 2 L: bounded to sites added or modified plus the ADR-0138 map. Decision 3: per-site × five-case COVERAGE, and a blanket `L ok` counts as a skip. A: wrong-implementation form and entry-path fallback. |
| A7, competing instructions and missing files | gpt H7, opus M6 | Implementation: every conflicting brief and definition instruction listed; all five templates, SKILL.md step 7, rule 70's fourth clause and the fable frontmatter included; security section moves into the file; off-repo edits coordinated, not part of the commit; decision 8's replay is the dry run. |
| opus M2, two gates for editing the file | opus | Decision 1 "Changing the file": a PR plus plan review, never a direct docs commit. The supersession list names ADR-0085 decision 4 and rule 70's direct docs commits. |
| opus M3, ADR-0115 decision 3 and forward links | opus | Supersession list adds ADR-0115 decision 3's "stay counts"; Implementation adds the forward links. |
| opus L1, re-ask in a fresh pane | opus | Decision 3 "Re-asks". |
| opus L2, `#[cfg(test)]` and what counts | opus | Decision 7 "Excluded" and "Counted". |
| opus L3, `REVIEW.md` | opus | Decision 1, last bullet. |

## Review round 2 dispositions

| Finding | Source | Changed clause |
|---|---|---|
| N1, replay numbers shown against ADR-0121 decision 6 | opus N1 (High), gpt M1 | User ruled 「Follow ADR-0121 (Recommended)」. Decision 8: the result is "insufficient evidence", and the acceptance question carries no numbers. Status block: numbers kept for the record only; escapes 2 and 3 marked in-sample for the platform-order clause, escape 1 the only out-of-sample one. § User rulings item 4. ADR-0121 decision 6 stays in "Unchanged", which is now true, so gpt M1 needs no new supersession. |
| N2, replay read barrier | opus N2 | Decision 8 "Read barrier": code only via `git show <pre-fix>:<path>`; no `docs/audit/`, D rows, ADR-0144, ADR-0146 or later commits; the report lists the files it read. |
| N3, ruling narrowed silently | opus N3 | § User rulings note for the acceptance question. |
| L1, rule 71 send-back clause | opus L1 | Supersession list: rule 71 § Briefs "sends the item back before any audit starts" gains decision 4's exception. |
| L2, procedure source per auditor | opus L2 | Decision 1 "Pinning": opus-auditor reads the agent file at `<M>`; gpt-auditor reads the request and its launch-only brief, never the Claude agent file. |
| L3, ground (b) redundant | opus L3 | Decision 4 ground (b) now only records the hand-off to ADR-0144's cards. |
| L4, false-positive record | opus L4 | Decision 8 records unexplained findings separately, and counts only a refuted one as a false positive. |
