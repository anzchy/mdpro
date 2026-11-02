# 0165. ADRs record architecture and product decisions only; process decisions go to a decision log

## Status

Proposed, 2026-11-02 (herdr-delegator), revision 3. The user chose each option below by AskUserQuestion on 2026-11-02:
「只收架构与产品 (Recommended)」, 「单独一份决定日志」, 「留在 spec 快照里 (Recommended)」,
「Enforced by + 大项才审 (Recommended)」. The user then asked: 「上面决定让fable和codex也评估一下」. Plan review round 1
by gpt-auditor and opus-auditor (Fable) found four Highs each, all fixable in the text, and agreed with every choice
with changes. On the two points where they differed or narrowed a choice, the user ruled:
「One file per entry (Recommended)」 and 「Keep review for gate changes (Recommended)」. Acceptance follows a scoped
confirm by both auditors, under the review route as it stands today (CLAUDE.md § ADR). Round 2 left two of
gpt-auditor's Highs partial (ADR-0148 decision 9 unnamed; release controls missing from the gate list); the user chose
「Fix + Codex confirms (Recommended)」: revision 3 fixes both, and gpt-auditor confirms the fix diff alone (ADR-0129).

**Partially supersedes, on acceptance, by name:**
- ADR-0118 decision 2, and ADR-0143 decision 1's "ADR review and plan review" clause: plan review of a repository-wide
  ADR is required only under decision 4 below;
- ADR-0148 decision 1's fifth item and decision 3's "unnumbered ADR drafts": the planner drafts a repository-wide ADR
  only for a decision on decision 1's list; other decisions in a spec take local ids (decision 3). ADR-0148's spec and
  ticket review is unchanged;
- ADR-0148 decision 9's foreclosure of grill-made ADRs "committed without number reservation and review", for its
  "review" half only: a planner-drafted ADR is reviewed under decision 4's trigger. Number reservation stays;
- ADR-0147 decision 2's CLAUDE.md ADR row: the `AskUserQuestion` criterion is dropped, and `docs/adr/README.md`
  (ADR-0147 WI-1) carries the two id spaces and the "Enforced by" convention;
- the rule texts that restate those clauses: CLAUDE.md § ADR, rule 70 item 4 "ADRs and plans", and rule 71 § Roster
  "ADR and plan reviewer" and § Audits under herdr "ADRs and plans".

**Kept:**
- ADR-0146 decision 1: `docs/agents/audit-dimensions.md` keeps its PR, its audit under the old blob and the plan review
  of the new one;
- ADR-0121 decision 6;
- ADR-0159, Proposed before this record, finishes under the old flow.

ADR-0162 decision 5's process freeze ended with the 0.3.6 release on 2026-11-02 (tag `v0.3.6` at `d31ec182`). This is
the first process ADR after it.

Enforced by: nothing yet. Until the references lint (follow-up 2) lands, rule 70's number reservation and the review of
the follow-up PR hold it.

## Context

- 161 ADRs exist: 44 written in September and 115 in October. Numbers 0120 to 0164 hold 43 records, since 0123 and
  0126 were never used. Seven of them decide product or release behaviour (0122, 0127, 0132, 0136, 0158, 0160, 0164).
  About 36 decide process: audit rounds, roster, slots, locks, receipts, model and effort routing. Several are mixed;
  0164, for example, adds a workflow input. ADR-0150 to ADR-0155 are six records for one memory-admission problem.
- No ADR carries an "Enforced by" line.
- Three rules together make every small process change cost a new record, two audits and a user approval:
  - CLAUDE.md § ADR says a decision that reaches for `AskUserQuestion` is "usually ADR-worthy";
  - an accepted ADR's body is immutable, so a changed mind needs a superseding ADR;
  - every ADR gets plan review by both auditors before acceptance.
- The 2026-11-01 delivery-friction report (`docs/audit/20261101-vmark-mdpro-架构对比.md`) names this bookkeeping as a
  root cause of slow delivery (RC2). The same report names shared append-only files that every PR touches as a source
  of conflicts (RC5).
- vmark, a larger codebase, keeps 19 repository-wide ADRs (`.claude/adr/README.md`):
  - architecture only;
  - each with an "Enforced by" note;
  - Status lines that say "Drifted" or "False in practice" in place;
  - plan decisions under plan-local ids inside the plan;
  - a lint that resolves every cited id.

## Options considered

1. **What gets a repository-wide ADR number.**
   - (a) **Architecture and product only.** Chosen.
   - (b) Architecture and product, plus process rules that bind several roles. Lost: most of the process ADRs bind
     several roles, so the count would barely fall.
   - (c) Keep today's standard. Lost: it is the cause RC2 names.
2. **Where process and tooling decisions go.**
   - (a) Edit the rule file, with one dated line quoting the user. Lost: in mdpro, dated lines are what grew rules 70
     and 71 to the always-on load that ADR-0147 is shrinking.
   - (b) **A separate decision log.** Chosen, as one file per entry. A single append-only file lost (user, 「One file
     per entry (Recommended)」): every entry would edit the same file, which is RC5's conflict shape, and a global entry
     number would need the reservation ADR numbers need.
   - (c) GitHub issues. Lost: the record leaves the repository, and an offline clone cannot read it.
3. **Decisions inside one feature's plan.**
   - (a) **Stay in the spec snapshot under local ids.** Chosen.
   - (b) Keep taking global numbers with lighter review. Lost: the numbering and cross-reference cost stays.
4. **Review and upkeep of global ADRs.**
   - (a) **"Enforced by" required; plan review only for large items; Status annotated in place; a references lint.**
     Chosen. Gate-sensitive process changes keep two-auditor review (user, 「Keep review for gate changes
     (Recommended)」).
   - (b) "Enforced by", with every ADR still reviewed by both auditors. Lost: review is the main cost of a small record.
   - (c) "Enforced by" only. Lost: it changes nothing about frequency.
   - (d) No carve-out for gate changes. Lost: a change that weakens a landing gate would get no independent review.

## Decision

1. **A repository-wide ADR (`docs/adr/NNNN-*.md`) records a decision about the product or its architecture:**
   - an IPC or MCP contract;
   - a persisted format or preference key;
   - a dependency added or refused;
   - a rendering surface or editor engine;
   - platform and release scope, including what a release workflow ships;
   - accepting a known product defect;
   - deciding not to build something.

   It does not record decisions about how the work is done. That covers the roster, slots, audit shape and rounds,
   receipts, locks on machine load, model and effort routing, brief and handoff formats, and CI lane layout.
   - **Test.** Would a user of the released app, or a contributor reading product code, see the difference? If yes, it
     is a product decision.
   - **Mixed cases.** A decision that is both goes to a global ADR, and its process half is a log entry that points at
     it. Examples: a release-workflow input that changes what ships; a lock or check that protects user data.
   - **Who classifies.** The delegator classifies before reserving a number, and the planner proposes for a feature.
     Doubt goes to the global route and to the user.
   - **Below the bar.** A product decision too small for an ADR is recorded where it is made: the D row, the spec
     snapshot or the ledger row. A prototype colour or a fix approach accepted on a D row are examples.
   - **No longer the test.** A decision that reaches for `AskUserQuestion` is not, by that fact alone, ADR-worthy.
   - **This record.** It is the charter of the log. It is the one process decision kept as a repository-wide ADR, and
     a change to the boundary itself takes a new ADR.
2. **Process and tooling decisions go to `docs/agents/decisions/YYYYMMDD-<slug>.md`, one file per decision**, listed in
   `docs/agents/decisions/README.md`. An entry is never edited; a wrong one is corrected by a new entry that names it.
   - **Each entry records:**
     - the date and who decided, quoting the user's words;
     - the decision, in one to three sentences;
     - the rule file or script it changes, or "changes: none" for a ruling alone;
     - the entry it supersedes, if any.
   - **Where it lives.** The rule file states only the current rule and links the entry. The entry and the rule edit
     land in one commit.
   - **Gate-sensitive entries keep plan review by both auditors before they land.** An entry is gate-sensitive when it
     changes:
     - a landing or CI condition;
     - the auditor set or the round cap;
     - the receipt contract;
     - a release publication or verification control: what may publish, `verify-release`, and the publish job's
       `needs` and `if` wiring (ADR-0073, ADR-0076);
     - a control that protects user data.

     The delegator classifies, and doubt means review.

     `docs/agents/audit-dimensions.md` keeps ADR-0146's route.
   - **Every other entry** is a delegator docs-only commit, quoting the user. An entry whose change is a script rides
     that script's PR, in the same commit.
   - **Once ADR-0159 is accepted,** entry and rule edit are one Policy PR on its route, and gate-sensitive entries are
     High tier there.
3. **A decision that belongs to one feature stays in that feature's spec snapshot** (`docs/specs/<feature>/r<N>/`),
   under a local id made from the feature prefix and the revision: `T567-r1-D1`, for example. It is reviewed with the
   spec (rule 12) and takes no global number.
   - **Decision 1's list wins.** A contract, format or preference key that one feature introduces still gets a
     repository-wide ADR, drafted by the planner and cited by the spec.
   - **After approval.** A feature decision made after `r<N>` is approved goes in `docs/specs/<feature>/decisions.md`,
     outside the immutable `r<N>/` folders, under the same id scheme. The delegator commits it with the ticket's landing
     record (ADR-0148 decision 8), and it may be mirrored on the issue. A decision that changes an AC is still a
     normative edit and needs `r<N+1>` (ADR-0148 decision 4).
   - **Promotion.** A local decision that later governs shared code or another feature is promoted by a new global ADR
     that links the snapshot.
4. **Every new repository-wide ADR has an "Enforced by" line after its Status:** the lint, test, gate or config that
   holds the decision, or a plain statement that nothing does.
   - **Plan review by both auditors** is required in any of these cases, and otherwise the ADR lands with the user's
     quoted acceptance:
     - the ADR touches `src-tauri/`, `src/services/`, a persisted format or preference key, an IPC or MCP contract, or
       a dependency;
     - it spans more than one PR;
     - the user asks for review.

     The delegator records the classification in the Status line, and doubt means review.
   - **The Status set gains "Drifted" and "False in practice"**, and the follow-up amends CLAUDE.md's closed list to
     match. Each is a dated line with a link to the evidence, added without a superseding ADR. Reversing or replacing
     a decision still takes a new ADR.
   - **The references lint** (follow-up 2) fails when a tracked file cites any of these that does not resolve:
     - a global ADR number;
     - a feature-local id;
     - a decision-log file.

     It also fails when a decision-log file is missing from the index. Until it lands, the delegator checks these by
     hand at each docs commit.
5. **Existing records are not rewritten or renumbered.**
   - **Until migrated.** A process ADR up to 0164 governs each clause until that clause is folded in while ADR-0147 is
     carried out. ADR-0147 owns the fold-in.
   - **Folding a clause in.** One change moves the clause to its single current home in a rule. It adds a decision-log
     entry that points at the ADR and its clause, without restating them. It adds a dated Status line to the ADR:
     "Current text: `<rule>#<anchor>`; folded by ADR-0165". The ADR stays Accepted, because a move is not a change of
     mind.
   - **No bulk backfill.** Past decisions are not reconstructed; only clauses that are folded in get entries.

## Consequences

- **Gains.**
  - New global ADRs should fall to the product rate, roughly seven in 43 over the last six weeks.
  - A process change that moves no gate costs one docs commit with a short entry, not a record, two audits and an
    approval.
  - "Enforced by" makes an unenforced decision visible.
  - One file per entry removes the shared append-only file and the entry-number reservation.
- **Costs.**
  - A process change that moves no gate gets no independent review until ADR-0159's Policy PR route exists.
  - Two places to look for a decision. The test is decision 1's: would a user or a reader of product code see it?
  - The 0150–0155 class of mistake (one problem, many records) can move into the log as many entries.
  - The mixed-case rule keeps some tooling decisions as ADRs, so the count does not fall all the way to product only.
  - While the fold-in runs, a reader follows a Status link from an ADR to its rule.
- **Forecloses.** Using the ADR count as a complete history of process changes. Before this ADR, process decisions are
  in `docs/adr/`; after it, they are in `docs/agents/decisions/`.
- **Follow-up items.**
  1. **One PR** that:
     - edits CLAUDE.md § ADR: the scope, the Status set, the "Current text" forward link to a rule, the "Enforced by"
       line in the Structure, and the review route;
     - edits `AGENTS.md`'s ADR and routing lines;
     - edits rule 12 and the planner's flow (decision 1's test in the planner's brief);
     - edits rule 70 item 4 and rule 70 § Reserving numbers, and `.claude/agents/mdpro-number-registrar.md` (global
       ADR numbers only);
     - edits rule 71 § Roster and § Audits under herdr;
     - edits the delegator skill (`SKILL.md`, `references/guide.md` § 6 and the plan-review request template);
     - edits `.claude/skills/plan-and-doc-map/SKILL.md`, `docs/agents/domain.md` and dimension F9's wording in
       `docs/agents/audit-dimensions.md` (that edit on ADR-0146's route);
     - adds three `GLOSSARY.md` terms: repository-wide ADR, decision-log entry, feature-local decision;
     - creates `docs/agents/decisions/` and its index, with this ADR as the first pointer.
  2. The references lint for global numbers, local ids and log files, plus the index check.
  3. `docs/adr/README.md`, with ADR-0147 WI-1.
  4. Folding process ADRs into the rules and the log, while ADR-0147 is carried out.
