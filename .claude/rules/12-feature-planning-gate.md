# 12 - Feature Planning Gate (Matt Pocock's workflow)

**Before a new feature or plan-sized work enters implementation, it must have three things, in this order:**
1. a `/grill-with-docs` session;
2. a spec published by `/to-spec`;
3. tickets that `/to-tickets` published and the user approved.

**If any of the three is missing, stop and ask the user with `AskUserQuestion`.** A vague plan is never enough to start building.

User decisions, 2026-10-28:
- 「从现在开始，从Plan的grill到 spec, tickets，到实施，全面切换为 /mattpocock 的Skill……新功能在实施前一定要先经过 /grill-with-docs ，其次 /to-spec 最后 /to-tickets ，才能进入实施状态，如果没有的话，用askuserquestion tool 提示用户，不能只有模糊的plan就开始实施」;
- 「Tickets feed briefs (Recommended)」, 「New features + plan-sized work (Recommended)」, 「Rule + ADR-0148 (Recommended)」.

The reasons, the options weighed and what this supersedes are in
[ADR-0148](../../docs/adr/0148-new-features-pass-grill-spec-and-tickets-before-implementation.md).

## What the gate covers
- **Covered:**
  - any new user-visible capability;
  - any plan- or WI-sized change, for example a Plan P stage, a menu-plan item, a new tooling feature or an ADR's implementation.
- **Not covered, so they keep the D-row flow:**
  - D-item defect fixes (use `/diagnosing-bugs` for the root cause);
  - audit fix rounds;
  - CI, receipt and test-only repairs;
  - docs-only work.
- **Already granted before 2026-10-28:** finishes under the old flow.
- **In doubt:** ask the user.

## How each step is run
- **Only the user can start these skills.** They are user-invoked (`disable-model-invocation`), so no agent can run
  `/grill-with-docs`, `/to-spec` or `/to-tickets` itself.
  - The delegator asks the user, with `AskUserQuestion`, to run the next missing step, and names it.
  - An implementor never asks the user. It stops and tells the delegator (rule 70).
- **Run `/setup-matt-pocock-skills` once per repo first.** It records the issue tracker, the triage labels and the doc layout under
  `docs/agents/`. Until it has run, the gate cannot be passed; ask the user to run it.
- **Evidence:**
  - the grilling's glossary and ADR updates are committed;
  - the spec and the approved tickets exist in the configured tracker;
  - a brief cites them by reference. A brief without them is not issued.

## From tickets to landing
- **One approved ticket is one brief and one PR.** Briefs are granted in the tickets' blocking order: a ticket starts only when every
  ticket that blocks it has landed. The brief's ACs come from the spec's user stories and testing decisions, tagged `unit` or `device`
  (ADR-0144).
- **The implementor builds with Matt Pocock's `tdd`** at the seams the spec agreed, and runs `code-review` before its handoff. This
  replaces `$tdd-guardian:tdd-guardian-workflow` (rule 71) for items under this rule.
- **Transition:** Codex has no Matt Pocock plugin installed. Until the user installs it, Codex implementors keep the tdd-guardian
  workflow, and each brief says which one applies.
- **Everything else is unchanged:**
  - RED receipts (rule 10);
  - the brief and its self-acceptance table (rule 71);
  - both auditors (ADR-0143);
  - device ACs (ADR-0144);
  - the verifier, `ci-gate`, and the delegator's `--ff-only` landing (rule 70).
