# 0148. New features pass grill, spec and tickets before implementation, using Matt Pocock's skills

## Status

**Proposed, 2026-10-28, by herdr-delegator (Claude route). Revised after plan review round 1.** The user's direction:
- 「从现在开始，从Plan的grill到 spec, tickets，到实施，全面切换为 /mattpocock 的Skill，查询mattpocock的整个Workflow。新功能在实施前一定要先经过 /grill-with-docs ，其次 /to-spec 最后 /to-tickets ，才能进入实施状态，如果没有的话，用askuserquestion tool 提示用户，不能只有模糊的plan就开始实施。上面作为一个Claude rule」;
- 「Tickets feed briefs (Recommended)」, 「New features + plan-sized work (Recommended)」, 「Rule + ADR-0148 (Recommended)」;
- after round 1: 「Dedicated planning session (Recommended)」, 「GitHub Issues」, 「Spec wins (Recommended)」, 「Matrix first, then
  tdd loop (Recommended)」;
- asked how to combine those, with Codex and a Fable subagent consulted independently
  (`herdr-spike/delegator/ADR-0148-combine-{codex,fable}.md`): 「docs/specs/<feature>/r<N>/」, 「Delegator numbers at commit
  (Recommended)」, 「Delegator closes after landing (Recommended)」, 「Yes, one validated cycle (Recommended)」.

The gate binds from 2026-10-28 through rule 12, on the user's direct instruction. This record goes to plan review round 2 by both
auditors (ADR-0143) before the user is asked to accept it.

**Partially supersedes, by name, for rule-12 (gated) items only:**
- **rule 71 § Briefs and self-acceptance, step 4** ("writes the tests and records the REDs. Only after that does it touch production
  code"), and its clause "`$tdd-guardian:tdd-guardian-workflow` (current user decision, 2026-10-24)" as the whole-item driver;
- **CLAUDE.md § Plan Status Tracking**, "Acceptance criteria stay in plans P and M; when they conflict, the original plan wins",
  together with § Feature Ledger's pointer "What is next and its acceptance → `docs/plans/`";
- **ADR-0144 decision 2**, "the controlling AC, quoted with its anchor (plan section or D row)", and its precedence line "plan or D-row
  AC, then the brief, then the card".

**Adds:**
- rule 70 § Sessions: a `planner` row;
- rule 70 § Reserving numbers: ADR drafts are unnumbered until the delegator commits them.

## Context

- **Rework came from intent nobody pinned down.**
  - ADR-0141 WI-2 needed two post-cap fixes and landed with D330 and D331 open.
  - D326 needed five fixes, two of them from test-environment assumptions.
  - Plans P and M carry ACs, but nothing required the user's intent to be grilled before a brief.
- **Matt Pocock's skills (plugin 1.3.1, Claude Code only):**
  - **User-invoked only** (`disable-model-invocation`): `grill-with-docs` (which runs `grilling` + `domain-modeling`), `to-spec`, which
    synthesises "the current conversation", `to-tickets` (vertical tracer bullets with blocking edges, approved by the user), `implement`,
    `implement-spec` and `setup-matt-pocock-skills`.
  - **Model-invocable:** `tdd` and `code-review`. `tdd` forbids "writing all tests first, then all implementation" and confirms seams
    with the user before any test.
  - `domain-modeling` writes ADRs numbered "highest + 1" in a short template.
- **Codex has no Matt Pocock plugin.** The Codex implementors run tdd-guardian, and the delegator may run on Codex.
- **Round-one review** (gpt-auditor C0 H3, opus-auditor C0 H4) found:
  - the swap dropped rule 71's matrix attack;
  - specs conflicted with plan precedence and ADR-0144's anchors;
  - `/implement` cannot run under a grant;
  - grill-made ADRs bypass number reservation and review;
  - no session was named for the planning conversation.

## Options considered

**Implementation driver**
1. Tickets feed briefs, with `tdd` + `code-review` inside rule 71. **Chosen.**
2. Gate only; keep tdd-guardian. Lost: the user asked for the whole chain to switch.
3. `/implement-spec` with its own integration branch and merges. Lost: it is user-invoked, it bypasses per-PR gates, and it merges
   outside the delegator (rule 70).

**Where planning runs**
1. A rostered `planner` pane. **Chosen:** `to-spec` and `to-tickets` must share the grill's conversation, and this keeps the
   delegator's context small on either route.
2. The delegator's own session. Lost: it fills the coordinator's context, and it works only on the Claude route.
3. The user's own session. Lost: it is untracked, and its outputs would reach `master` by no defined path.

**Spec of record**
1. GitHub Issues to author and track, plus an immutable approved snapshot in the repo, pinned by blob. **Chosen.**
2. Issues alone. Lost: bodies stay mutable after approval, while audits pin blobs (ADR-0146) and cards quote ACs verbatim (ADR-0144).
3. Snapshot as a top-level `specs/` file replaced per revision. Lost to the user's choice of one folder per revision.

**TDD order**
1. Matrix and attack first, then one slice per `tdd` cycle. **Chosen;** both consultants recommended it.
2. Keep "all REDs first". Lost: it contradicts `tdd`.

**Codex**
1. Vendored, pinned `tdd` and `code-review` texts plus an mdpro adapter, after one validated cycle. **Chosen.**
2. Stay on tdd-guardian. Lost: two processes for one gate.
3. Install a Codex plugin. Lost: unversioned, and parity is not established.

## Decision

1. **The gate.** A gated item enters implementation only after five things exist:
   - a `/grill-with-docs` session in the planner;
   - a `/to-spec` spec issue;
   - `/to-tickets` ticket issues the user approved;
   - the approved snapshot, committed (decision 4);
   - a plan review of spec, tickets and ADR drafts by both auditors (rule 70 item 4, ADR-0143).

   If any is missing, the delegator stops and asks the user through its route's question channel (`AskUserQuestion` on Claude, Codex's
   on Codex; rule 71), naming the next step and the planner pane. Implementors never ask the user.
2. **What is gated, decided by a test.** An item is gated if any of these holds:
   - it adds or changes a user-visible capability, i.e. a feature-ledger row is new or changes state;
   - it adds any new user-visible behaviour (an action, a setting, a menu item, a shortcut or a visible state), even inside an existing
     `Shipped` ledger row;
   - it adds a declared surface (command, HTTP route, `MENU_*` id, plugin id, store) or a new contract (IPC, persisted format, preference
     key);
   - it is expected to need more than one PR;
   - it needs an ADR.

   D-item fixes that restore stated behaviour, audit fix rounds, CI, receipt or test-only repairs, and docs-only work are exempt, but only
   when they add no capability or contract. The delegator records the classification in the brief. Doubt goes to the user.
3. **The planner.**
   - **Role.** A Claude Code pane `planner`, started per feature with `MDPRO_ROLE=planner`, and added to rule 70's roster. It runs the
     grill, `/to-spec` and `/to-tickets` in one conversation, and publishes the spec and ticket issues to `anzchy/mdpro`.
   - **Limits.** It grants nothing, reserves no number, commits nothing to `master` and lands nothing.
   - **Its outputs** go to `~/.mdpro-redesign/planner/<feature>/`:
     - glossary edits;
     - unnumbered ADR drafts in CLAUDE.md's Nygard structure, with Options considered and Status Proposed;
     - the approval record, holding the user's words.

     It then hands the delegator the paths.
   - **The delegator** reserves ADR numbers when it commits the drafts, as Proposed, and commits `GLOSSARY.md` at the repo root.
   - **Before first use:** `role-guard.sh` needs a `planner` branch, which is a tooling item, and the user runs
     `/setup-matt-pocock-skills` once (GitHub Issues). Its writes are reviewed and committed by the delegator.
4. **The approved snapshot.**
   - **Contents.** `docs/specs/<feature>/r<N>/` holds `spec.md`, `tickets/<T-nn>.md` and `manifest.md`. The manifest carries:
     - the issue numbers and URLs;
     - each captured body's SHA-256;
     - the user's approval words and date;
     - the blocking edges.
   - **Who commits it.** The delegator, after checking that the published bodies match. A revision folder never changes; a normative
     issue edit becomes `r<N+1>` and needs the user's re-approval. The delegator records which tests, reviews and device evidence it
     voids.
   - **Re-review.** Before any brief cites a revision `r<N+1>`, both auditors plan-review its diff against `r<N>` (ADR-0143). An
     earlier revision's review never covers a later one.
   - **Pins.** Briefs, cards and audit requests pin the snapshot's commit and blob ids. `docs/specs/**` is never Low tier.
5. **Precedence for gated items:** spec snapshot, then ticket, then brief, then card. A card may anchor its controlling AC to a spec or
   ticket AC id in the snapshot, quoted verbatim. The card checker and the landing verifier must support that anchor before the first
   spec-anchored device run, which is a tooling item. The sequencing row keeps order and status with the ticket reference.
6. **Tickets feed briefs.** One approved ticket is one brief and one PR. It is granted only when every blocking ticket has *landed*:
   `ready-for-agent` means specified, not granted. The ACs map ticket → spec story or testing decision, each tagged `unit` or `device`.
   No integration branch, not even for a wide refactor.
7. **Implementation:**
   - **Matrix and attack first.** rule 71 steps 1–3 stay unchanged on both runtimes: the test matrix, with a seam and a slice column, and
     the independent spec-adversary attack, run with tdd-guardian's test-designer and spec-adversary.
   - **Step 4 becomes `tdd` cycles.** Each cycle takes one matrix case at one agreed seam:
     1. write the test;
     2. watch the intended assertion fail;
     3. record a RED receipt `<ID>-S<n>`;
     4. make the minimal change;
     5. `verify`.

     A cycle's receipt is settled before the next cycle starts. No test is written for a case the matrix lacks unless an amendment is
     recorded. A changed seam or behaviour is re-attacked before its cycle.
   - **Seams.** The spec's Testing Decisions, which the user confirmed in the planner, are `tdd`'s seam confirmation. A new seam is a stop
     sent to the delegator.
   - **Review.** Refactoring happens in the `code-review` stage, with tests green before and after. `code-review` runs on the committed
     candidate, covering both its axes, before the handoff. It replaces neither auditor.
   - **Runtimes.**
     - Claude implementors invoke the installed skills, with the version pinned in the brief.
     - Codex implementors read vendored copies of `tdd` (with `tests.md` and `mocking.md`) and `code-review` under `.agents/skills/`, plus
       an mdpro adapter, pinned by blob. The vendoring PR checks the licence.
     - Before the first Codex gated grant, one complete validated cycle must have been shown on an authorised item: the RED → GREEN
       receipt, the adversary dispatch, and the two-axis review. Until then, Codex briefs keep the tdd-guardian workflow and say so.
8. **Landing and closure.** Every landing gate stays unchanged. After `--ff-only` and the push, the delegator closes the ticket issue and
   posts the landing record on it: PR, SHA, gates and the snapshot revision. It closes the spec issue after the last ticket.
9. **Foreclosed:** `/implement`, `/implement-spec`, a wide-refactor integration branch, agent-run grilling, and grill-made ADRs committed
   without number reservation and review.
10. **Activation.** The gate binds now. The first gated grant waits for:
    - the setup run;
    - the planner roster row and role-guard branch;
    - the brief template's snapshot fields;
    - for any `device` AC, the card checker's spec anchor.

    Items granted before 2026-10-28 finish under the old flow.

## Consequences

- **Gained:**
  - every gated item starts from grilled intent, an approved spec and a ticket graph;
  - ADRs and the glossary grow as a by-product, through the normal reservation and review;
  - one evidence trail runs from `AC → case → cycle → receipt` on both runtimes.
- **Costs:**
  - a planner session and the user's approvals before any gated work, so nothing gated starts while the user is away;
  - a plan review per feature;
  - snapshots duplicate tracker content and need reconciling;
  - four tooling items before the first gated grant;
  - vendored skill texts need an upgrade owner;
  - more, smaller PRs, one per ticket.
- **Foreclosed:**
  - implementation from a vague plan;
  - Matt Pocock's own merge flow;
  - for gated items, plan ACs overriding an approved spec.
