# Decision log

Process and tooling decisions: how the work is done (roster, slots, audit shape and rounds, receipts, locks, model and
effort routing, brief and handoff formats, CI lane layout). Product and architecture decisions are repository-wide ADRs
under `docs/adr/`, and decisions inside one feature stay in its spec snapshot
([CLAUDE.md § ADR](../../../CLAUDE.md#architecture-decision-records-adr)). The charter is
[ADR-0165](../../adr/0165-adrs-record-architecture-and-product-decisions-only.md) decision 2; changing the boundary
between ADRs and this log takes a new ADR.

## Entry format

- **One file per decision:** `YYYYMMDD-<slug>.md`. It takes no number.
- **Each entry records:**
  - the date and who decided, quoting the user's words;
  - the decision, in one to three sentences;
  - `changes:` the rule file or script it changes, or `changes: none` for a ruling alone;
  - `supersedes:` the entry, or the named ADR clause, it supersedes, or `none`.
  - `gate-sensitive:` the delegator's classification under § Gate-sensitive entries, on every entry:
    `yes` with the trigger it meets (or "doubt means review") and who classified when, or `no`.
- **An entry is never edited.** A wrong one is corrected by a new entry that names it.
- **The rule file states only the current rule and links the entry.** The entry and the rule edit land in one commit.
- **Listed below.** Every entry file is in the index, newest first, in the same commit that adds it.

## Gate-sensitive entries

An entry is gate-sensitive when it changes:
- a landing or CI condition;
- the auditor set or the round cap;
- the receipt contract;
- a release publication or verification control: what may publish, `verify-release`, and the publish job's `needs`
  and `if` wiring (ADR-0073, ADR-0076);
- a control that protects user data.

Both auditors plan-review a gate-sensitive entry and its rule edit before they land, through the delegator's
plan-review request. The delegator classifies, and doubt means review. `docs/agents/audit-dimensions.md` and
`docs/agents/audit-policy-set.md` keep ADR-0146's route.

## Every other entry

A delegator docs-only commit, quoting the user. An entry whose change is a script rides that script's PR, in the same
commit. Once ADR-0159 is accepted, entry and rule edit are one Policy PR on its route, and gate-sensitive entries are
High tier there.

## Entries

- [20261104-adr-bar-raised.md](20261104-adr-bar-raised.md): an ADR needs scope and significance; doubt goes below the
  bar, a correction takes no number, an amendment takes one only when the contract changes, one page at most.
- [20261102-receipts-per-item-files.md](20261102-receipts-per-item-files.md): each receipt and evidence entry is
  one file per id; `receipts.json` is a generated view, and `receipt-store.mjs keep-check` is the verifier's check.
- [20261102-audit-policy-set-split.md](20261102-audit-policy-set-split.md): the policy set moves, unchanged, into
  its own pinned file `<P>`, read only on policy-routed requests; the dimension allowance is 13,000 B.
- [20261102-new-items-are-github-issues.md](20261102-new-items-are-github-issues.md): a new item is a GitHub issue;
  its id is the issue number, its status the issue's state, and the sequencing doc keeps order only.
- [20261102-d355-rules-70-71-fold-in.md](20261102-d355-rules-70-71-fold-in.md): rules 70 and 71, CLAUDE.md, AGENTS.md
  and rule 12 become a routing map, process-ADR clauses fold into references and role files, and ADR-0147's caps change.
- [20261102-changing-an-unfolded-process-adr-clause.md](20261102-changing-an-unfolded-process-adr-clause.md): a
  clause of a process ADR (up to 0164) that is not yet folded in is changed by folding it in, with a log entry; no new
  ADR.
- [20261102-cc-suite-policy-set.md](20261102-cc-suite-policy-set.md): rule, doc, skill and agent text is audited by
  cc-suite 2.5.0's NL auditors as they are, pinned and routed by path.
- [20261102-adr-scope-and-decision-log.md](20261102-adr-scope-and-decision-log.md): ADRs record product and
  architecture decisions only; this log takes process decisions (ADR-0165).
