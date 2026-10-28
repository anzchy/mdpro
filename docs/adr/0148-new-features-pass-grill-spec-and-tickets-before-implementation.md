# 0148. New features pass grill, spec and tickets before implementation, using Matt Pocock's skills

## Status

**Proposed, 2026-10-28, by herdr-delegator (Claude route).** The user's direction:
- 「从现在开始，从Plan的grill到 spec, tickets，到实施，全面切换为 /mattpocock 的Skill，查询mattpocock的整个Workflow。新功能在实施前一定要先经过 /grill-with-docs ，其次 /to-spec 最后 /to-tickets ，才能进入实施状态，如果没有的话，用askuserquestion tool 提示用户，不能只有模糊的plan就开始实施。上面作为一个Claude rule」;
- answering the three questions that followed:
  - 「Tickets feed briefs (Recommended)」;
  - 「New features + plan-sized work (Recommended)」;
  - 「Rule + ADR-0148 (Recommended)」.

The gate itself binds from 2026-10-28, through rule 12, on the user's direct instruction. This record goes to plan review by both
auditors (ADR-0143) before the user is asked to accept it.

**Partially supersedes, once accepted:**
- rule 71 § Briefs and self-acceptance, "`$tdd-guardian:tdd-guardian-workflow` (current user decision, 2026-10-24)", for items under
  rule 12 only. Their implementor uses Matt Pocock's `tdd`, then `code-review`.

## Context

- **Work starts from plans of uneven depth.** Plan P, the menu plan and the D rows each carry acceptance criteria, but nothing
  required the user's intent to be pinned down before a brief was written. Today's rework came from cases nobody had asked about:
  - ADR-0141 WI-2 needed two post-cap fixes and landed with two findings open (D330, D331);
  - D326 needed five fix commits, two of them caused by test-environment assumptions.
- **Matt Pocock's skills (plugin `mattpocock-skills` 1.3.1) are installed for Claude Code.** They give a fixed chain:
  1. `/grill-with-docs`: the `grilling` interview plus `domain-modeling`, writing the glossary and ADRs as it goes;
  2. `/to-spec`: problem, solution, an extensive list of user stories, implementation and testing decisions, with test seams checked
     against the user;
  3. `/to-tickets`: tracer-bullet vertical slices with blocking edges, and the user approves the breakdown before it is published;
  4. `/implement` or `/implement-spec`.

  All of these are user-invoked (`disable-model-invocation: true`), and they need `/setup-matt-pocock-skills` once per repo.
- **Codex has no Matt Pocock plugin installed.** The Codex implementors (rule 71) run tdd-guardian.
- **Landing gates already exist and are not in question:**
  - briefs with self-acceptance;
  - RED receipts;
  - two auditors capped at two rounds;
  - device ACs;
  - the verifier, `ci-gate`, and the delegator's `--ff-only` landing.

## Options considered

**How implementation fits**
1. **Tickets feed briefs.** Chosen. One approved ticket is one brief and one PR in the rule 70/71 flow. The implementor uses Matt
   Pocock's `tdd` at the spec's seams and `code-review` before handoff.
2. **Gate only; keep tdd-guardian.** Lost: the user asked for the whole chain, implementation included, to switch to Matt Pocock's
   skills.
3. **Full `/implement-spec`.** Its integration branch, its own implementer subagents and its own merges replace per-ticket briefs.
   Lost:
   - it bypasses the per-PR audit, verifier and landing gates, or forces one large audit over the whole integration branch;
   - its subagent merges conflict with "only the delegator lands" (rule 70).

**Scope**
1. **New features and plan-sized work.** Chosen. D-item fixes, audit fix rounds and CI, receipt or test-only repairs keep the D-row
   flow.
2. **Everything, bug fixes included.** Lost: a one-line defect fix would need a spec and tickets.
3. **User-visible features only.** Lost: tooling features such as ADR-0146's are plan-sized too, and suffered the same rework.

**Record**
1. **Rule plus ADR.** Chosen: the gate supersedes a user decision recorded in rule 71, so the record is needed.
2. **Rule only.** Lost: the superseded tdd-guardian decision would have no record.

## Decision

1. **The gate.** A new feature or plan-sized item enters implementation only after three steps:
   - a `/grill-with-docs` session, with its glossary and ADR updates committed;
   - a `/to-spec` spec in the configured tracker;
   - `/to-tickets` tickets the user approved.

   Missing any of them, the delegator stops and asks the user with `AskUserQuestion`, naming the next step to run. Implementors never
   ask the user (rule 70).
2. **Setup.** `/setup-matt-pocock-skills` runs once, by the user, before the first gated item. It records the tracker, the labels and
   the doc layout in `docs/agents/`.
3. **Tickets feed briefs.** One ticket is one brief and one PR, granted in blocking order. The ACs come from the spec's user stories
   and testing decisions, tagged `unit` or `device`.
4. **Implementation.** Matt Pocock's `tdd`, then `code-review`, replace the tdd-guardian workflow for gated items. Until the user
   installs the plugin for Codex, Codex implementors keep tdd-guardian, and the brief says which applies. RED receipts (rule 10) still
   apply.
5. **Unchanged:**
   - briefs and self-acceptance (rule 71);
   - two auditors (ADR-0143);
   - device ACs (ADR-0144);
   - pinned audit dimensions (ADR-0146);
   - the verifier, `ci-gate`, and `--ff-only` landing (rule 70).
6. **Transition.** Items granted before 2026-10-28 finish under the old flow: ADR-0146's implementation, the WI-2 follow-ups and the
   W036 cards.

## Consequences

- **Gained:**
  - every gated item starts from a grilled intent, a written spec and an approved breakdown;
  - ADRs and the glossary grow as a by-product;
  - tickets give a task graph the delegator can grant in order.
- **Costs:**
  - a user session for each grill, plus approving the tickets, before any gated work starts. Nothing gated can start while the user
    is away;
  - spec and tickets add a layer beside the existing plans and the sequencing doc, which can drift. The sequencing doc keeps order and
    status only, and plans give way to specs for new work;
  - two TDD tools while Codex lacks the plugin. Matt Pocock's `tdd` has no spec-adversary attack and no receipt CLI of its own, so rule
    10's receipts and rule 71's matrix attack still have to be run beside it;
  - the user must install the Codex plugin to finish the switch.
- **Foreclosed:**
  - starting a feature from a vague plan;
  - agent-run grilling, since only the user can start these skills;
  - `/implement-spec`'s own merging onto `master`.
