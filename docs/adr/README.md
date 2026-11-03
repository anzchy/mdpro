# Architecture Decision Records

How mdpro writes, numbers, reviews and changes its ADRs. `CLAUDE.md` § Architecture Decision Records keeps the scope test
and the short rules; this file holds the full text, moved here by D355 (ADR-0147 WI-1; ADR-0165 follow-up 3).

**Index:** every numbered ADR by topic, with each process record's current home and the history records:
[`INDEX.md`](INDEX.md).

<!-- moved-from: CLAUDE.md § Architecture Decision Records (ADR) (ADR-0147) -->
**A repository-wide ADR records a decision about the product or its architecture**
([ADR-0165](0165-adrs-record-architecture-and-product-decisions-only.md)
decision 1; [decision log](../agents/decisions/20261102-adr-scope-and-decision-log.md)):

- **Scope.** An IPC or MCP contract; a persisted format or preference key; a
  dependency added or refused; a rendering surface or editor engine; platform and
  release scope, including what a release workflow ships; accepting a known
  product defect; deciding **not** to build something.
- **The test.** Would a user of the released app, or a contributor reading product
  code, see the difference? If yes, it is a product decision.
- **Not an ADR:** how the work is done (the roster, slots, audit shape and rounds,
  receipts, locks on machine load, model and effort routing, brief and handoff
  formats, CI lane layout). Each goes to one file in the
  [decision log](../agents/decisions/README.md). A decision that reaches for
  `AskUserQuestion` is not, by that fact alone, ADR-worthy.
- **Mixed cases** (both product and process) get an ADR when they pass the bar
  below, and their process half is a log entry pointing at it.

## The bar

**An ADR needs both parts of a two-part test** (since 2026-11-04,
[entry](../agents/decisions/20261104-adr-bar-raised.md)):

- **(a) Scope.** The decision is on the scope list above.
- **(b) Significance.** It is hard or costly to reverse once shipped, or it binds
  more than one module or an external party (a user's files, a contract other
  code calls).

A decision that passes (a) but not (b) goes **below the bar**.

- **Below the bar** means it is recorded where it is made: the item's issue (or
  its existing D row), the spec snapshot or the ledger row. A colour value, a
  single shortcut default and a measurement are examples.
- **Who classifies.** The delegator, before reserving a number; the planner
  proposes for a feature. **Doubt goes below the bar**, not to the ADR route. A
  below-the-bar record becomes an ADR later only when it is disputed, superseded
  or built on (the promotion rule at the end of this file).
- **No answer, no number.** Before reserving a number, the delegator writes the
  one-line answer to (a) and (b) in the reservation.
- **A correction takes no number.** A measurement or evidence correction that
  changes no decision is a linked evidence record under `docs/test/` or
  `docs/reference/`, plus a dated Status note on the existing ADR.
- **Amendments.** A change on a topic that already has an ADR takes a new ADR,
  listed under the topic lead in [`INDEX.md`](INDEX.md), only when the contract
  changes; otherwise it lives in the item's issue. When the contract of a topic
  that already has amendments really changes, one new ADR replaces the whole
  topic at that time, and the lead and each amendment gain its Superseded line.
  A topic is consolidated at its next genuine revision, never to lower a count.
- **One feature's decisions** stay in its spec snapshot under local ids
  `<prefix>-r<N>-D<n>` (rule 12), unless they pass the bar.
- **What not to do:** no bulk Status sweep to Superseded or Retired; no
  `docs/adr/archive/` directory (a tooling test reads every entry of `docs/adr/`
  as a file); no rewriting of accepted bodies; no backfilling; no target count.

## Writing and changing an ADR

- **Location**: `docs/adr/NNNN-kebab-title.md`, numbered sequentially from
  `0001`, never renumbered and never deleted. The commit that adds an ADR adds
  its line to [`INDEX.md`](INDEX.md).
- **Structure** (Nygard): `# NNNN. Title` → **Status** → **Enforced by** →
  **Context** → **Options considered** → **Decision** → **Consequences**. Every
  new ADR's "Enforced by" line names the lint, test, gate or config that holds the
  decision, or says plainly that nothing does: a pointer, not a restatement of
  the rules it holds. Context states the
  forces *as they were understood at the time*, not as they look in hindsight.
  Options considered names every option that was on the table, with the reason
  each losing one lost; a record without them cannot stop the re-litigation it
  exists to prevent. **One page, about 1,000 words at most.** Runbooks,
  implementation steps and review dispositions go to the spec or a guide;
  evidence (log lines, device runs, probe output) goes in a linked record under
  `docs/test/` or `docs/reference/`. None of it goes in the ADR.
- **Status** is one of `Proposed` / `Accepted` / `Rejected` /
  `Superseded by ADR-NNNN` / `Deprecated` / `Drifted` / `False in practice`. Date
  every status change, and on
  `Accepted` or `Rejected` say **who decided**, quoting the user's words when the
  user did. `Rejected` keeps a proposal that was turned down, with the reason, so
  it is not proposed again from scratch. `Drifted` and `False in practice` are
  dated lines with a link to the evidence, added without a superseding ADR.
- **An accepted ADR's body is immutable.** Only its Status line and a forward
  link (`Superseded by ADR-NNNN`, `partially superseded: <clause> by ADR-NNNN`,
  `Current text: <rule>#<anchor>; folded by ADR-0165` for a clause moved unchanged,
  or `Current text: <rule>#<anchor>; folded and changed by docs/agents/decisions/<file>`
  for a changed one) may change after acceptance. Changing your mind on a repository-wide ADR writes a
  **new** ADR that supersedes the old one, in whole or for a named clause, and links
  back; both stay in the tree. (A process ADR's unfolded clause is folded in
  instead: see Existing records below.) Editing an accepted record destroys the evidence of why the
  earlier decision looked right at the time — which is the only thing that stops
  it being remade by accident. (Rules amended 2026-10-11 after the vendor
  comparison in `docs/reference/20261011-adr-criteria-best-practices.md`;
  ADRs accepted before then keep their shape.)
- **Review.** Plan review by both auditors is required when the ADR touches
  `src-tauri/`, `src/services/`, a persisted format or preference key, an IPC or
  MCP contract, or a dependency; when it spans more than one PR; or when the user
  asks. Otherwise it lands with the user's quoted acceptance. The delegator records
  the classification in the Status line, and doubt means review (ADR-0165
  decision 4).

## Existing records

- **Existing records** are not rewritten or renumbered (ADR-0165 decision 5). A
  process ADR up to 0164 governs each clause until that clause is folded into a
  rule while ADR-0147 is carried out; the folded ADR stays `Accepted` and gains the
  dated "Current text: `<rule>#<anchor>`; folded by ADR-0165" line. ADR-0159 finishes under the old flow. Changing a
  clause that is not yet folded in takes no new ADR: the change folds the clause
  into its rule with a decision-log entry recording the new decision (plan review
  by both auditors when it is
  [gate-sensitive](../agents/decisions/README.md#gate-sensitive-entries)), and
  the old ADR gains "Current text: `<rule>#<anchor>`; folded and changed by
  `docs/agents/decisions/<file>`", naming that entry ([entry](../agents/decisions/20261102-changing-an-unfolded-process-adr-clause.md)).
- **Record the costs, not just the benefits.** An ADR whose Consequences section
  lists only upsides is advocacy, not a record. Name what the decision gives up
  and what it forecloses.
- Plans and rules **link** to ADRs rather than restating the reasoning. When a
  plan and an ADR disagree, the ADR is the decision and the plan is corrected.

Decisions already taken for the in-flight redesign still live inline in
`docs/plans/` (E26, E29 Stryker-not-adopted, E39 no-benchmarking-harness, the
`export_html` non-deletion). **Do not backfill them wholesale** — a bulk
conversion produces records nobody wrote and nobody trusts. Promote one when it
is next disputed, superseded, or built on: to an ADR if it is on the scope list
above, otherwise to a decision-log entry.

The B′ export-anchor decision was promoted this way on 2026-09-15
([ADR-0003](0003-export-fragment-sanitizer-scope.md)): it was about to
be built on by WI-3.2, and it carries a precondition with a failure condition
(`<form>` entering the sanitizer allowlist) that must outlive any plan document.
