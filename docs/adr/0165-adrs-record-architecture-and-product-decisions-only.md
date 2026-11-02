# 0165. ADRs record architecture and product decisions only; process decisions go to a decision log

## Status

Proposed, 2026-11-02 (herdr-delegator). The user chose each option below by AskUserQuestion on 2026-11-02:
「只收架构与产品 (Recommended)」, 「单独一份决定日志」, 「留在 spec 快照里 (Recommended)」,
「Enforced by + 大项才审 (Recommended)」. Acceptance follows plan review by both auditors (CLAUDE.md § ADR, as it stands).

## Context

- 161 ADRs exist: 44 written in September and 115 in October. Of ADR-0120 to ADR-0164, about 6 decide product or
  release behaviour (0122, 0127, 0132, 0136, 0158, 0164); about 38 decide process: audit rounds, roster, slots, locks,
  receipts, model and effort routing. ADR-0150 to ADR-0155 are six records for one memory-admission problem.
- No ADR says what enforces it.
- Three rules together make every small process change cost a new record, two audits and a user approval:
  - CLAUDE.md § ADR says a decision that reaches for `AskUserQuestion` is "usually ADR-worthy";
  - an accepted ADR's body is immutable, so a changed mind needs a superseding ADR;
  - every ADR gets plan review by both auditors before acceptance.
- The 2026-11-01 delivery-friction report (`docs/audit/20261101-vmark-mdpro-架构对比.md`, RC2) names this bookkeeping as
  a root cause of slow delivery. vmark, a larger codebase, keeps 19 repository-wide ADRs (`.claude/adr/README.md`):
  - architecture only;
  - each with an "Enforced by" note;
  - Status lines that say "Drifted" or "False in practice" in place;
  - plan decisions under plan-local ids (`ADR-1`, `ADR-C3`) inside the plan;
  - a lint that resolves every cited id.

## Options considered

1. **What gets a repository-wide ADR number.**
   - (a) **Architecture and product only.** Chosen.
   - (b) Architecture and product, plus process rules that bind several roles. Lost: most of the 38 process ADRs bind
     several roles, so the count would barely fall.
   - (c) Keep today's standard. Lost: it is the cause named in RC2.
2. **Where process and tooling decisions go.**
   - (a) Edit the rule file, with one dated line quoting the user. Lost: the rule files are already the always-on
     load ADR-0147 wants to shrink, and dated lines are what grew them.
   - (b) **A separate append-only decision log.** Chosen.
   - (c) GitHub issues. Lost: the record leaves the repository, and an offline clone cannot read it.
3. **Decisions inside one feature's plan.**
   - (a) **Stay in the spec snapshot under local ids.** Chosen.
   - (b) Keep taking global numbers with lighter review. Lost: the numbering and cross-reference cost stays.
4. **Review and upkeep of global ADRs.**
   - (a) **"Enforced by" required; plan review only for large items; Status annotated in place; a references lint.**
     Chosen.
   - (b) "Enforced by" with every ADR still reviewed by both auditors. Lost: review is the main cost of a small record.
   - (c) "Enforced by" only. Lost: it changes nothing about frequency.

## Decision

1. **A repository-wide ADR (`docs/adr/NNNN-*.md`) records a decision about the product or its architecture:**
   - an IPC or MCP contract;
   - a persisted format or preference key;
   - a dependency added or refused;
   - a rendering surface or editor engine;
   - platform and release scope;
   - accepting a known product defect;
   - deciding not to build something.

   It does not record decisions about how the work is done: roster, slots, audit shape and rounds, receipts, locks,
   load and memory admission, model and effort routing, brief and handoff formats, CI lane layout. A decision
   reaching for `AskUserQuestion` is no longer, by that fact, ADR-worthy.
2. **Process and tooling decisions go to `docs/agents/decisions.md`**, one entry per decision, appended, never edited:
   - the date and who decided, quoting the user's words;
   - the decision in one to three sentences;
   - the rule file or script it changes, and the entry it supersedes, if any.

   The rule file states only the current rule and links the entry. A rule change and its log entry land in one
   commit. A process decision is reviewed with the PR that carries it, not by a separate plan review.
3. **A decision that belongs to one feature stays in that feature's spec snapshot** (`docs/specs/<feature>/r<N>/`) or
   plan, under a local id made from the feature prefix: `T567-D1`, for example. It is reviewed with the spec (rule 12)
   and takes no global number. It becomes a repository-wide ADR only when it binds code outside that feature.
4. **Every new repository-wide ADR has an "Enforced by" line** after its Status line: the lint, test, gate or config
   that holds the decision, or a plain statement that nothing does.
   - **Plan review** by both auditors is required only when the ADR is hard to reverse, spans more than one PR, or adds
     a dependency. Otherwise the ADR lands with the user's acceptance alone.
   - **A Status line may say "Drifted" or "False in practice"**, with the date and the evidence, without a superseding
     ADR. Reversing or replacing a decision still takes a new ADR.
   - **A lint** (a later item) fails when a tracked file cites an ADR number that has no record.
5. **Existing records are not rewritten or renumbered.** Process ADRs up to 0164 stay authoritative until their content
   is folded into the rules and the decision log while ADR-0147 is executed. Each one then gets a Status line
   "Superseded by docs/agents/decisions.md entry <n>". No bulk backfill is done.

## Consequences

- **Gains.**
  - New global ADRs should fall to a few per month, about the 6 in 45 that were product decisions.
  - A process change costs one PR, not a record, two audits and an approval.
  - "Enforced by" makes an unenforced decision visible.
- **Costs.**
  - A process decision gets less independent scrutiny than today: it is reviewed only inside its PR.
  - The decision log is a new shared, append-only file, the RC5 shape. Entries are short and mostly landed by the
    delegator, but two PRs that both append to it can still conflict.
  - Two places to look for a decision. The test is "is it about the product or about the work".
  - The 0150–0155 class of mistake (one problem, many records) can move into the log as many entries.
- **Forecloses.** Using the ADR count or the audit-log as a complete history of process changes. Before this ADR, use
  `docs/adr/`; after it, use `docs/agents/decisions.md`.
- **Follow-up items.**
  - Edit CLAUDE.md § ADR, rule 12's ADR-draft clause and rule 70's plan-review clause, and create
    `docs/agents/decisions.md` with this ADR as its first pointer. One PR.
  - The ADR-references lint.
  - Fold process ADRs into rules and the log while ADR-0147 is executed.
