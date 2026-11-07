# 12 - Feature Planning Gate (Matt Pocock's workflow)

**A gated item enters implementation only after five things exist:**
1. a `/grill-with-docs` session;
2. a `/to-spec` spec;
3. `/to-tickets` tickets the user approved;
4. the approved snapshot, committed;
5. both auditors' plan review of the spec and tickets, and of any ADR draft that meets
   [CLAUDE.md § ADR](../../CLAUDE.md#architecture-decision-records-adr)'s review trigger.

**If any is missing, stop and ask the user (an implementor, through the delegator). A vague plan is never enough.** Reasons, options and supersessions:
[ADR-0148](../../docs/adr/0148-new-features-pass-grill-spec-and-tickets-before-implementation.md) (user, 2026-10-28:
「新功能在实施前一定要先经过 /grill-with-docs ，其次 /to-spec 最后 /to-tickets ，才能进入实施状态，如果没有的话，用askuserquestion tool
提示用户，不能只有模糊的plan就开始实施」).

## Gated or not: the test, which the delegator records in the brief
- **Gated** when any of these holds:
  - a feature-ledger row is new or changes state;
  - it adds any new user-visible behaviour (an action, a setting, a menu item, a shortcut or a visible state), even inside an existing
    `Shipped` ledger row;
  - it adds a declared surface (command, HTTP route, `MENU_*` id, plugin id, store) or a contract (IPC, persisted format, preference key);
  - it is expected to take more than one PR;
  - it needs an ADR.
- **Exempt,** as long as they add no capability or contract:
  - D-item fixes that restore stated behaviour;
  - audit fix rounds;
  - CI, receipt and test-only repairs;
  - docs-only work.
- **Doubt** goes to the user. Items granted before 2026-10-28 finish under the old flow.

## Planning
The user runs the three skills in the **`planner`** pane, which publishes the spec and ticket issues and grants, reserves,
commits and lands nothing. Snapshot revisions never change: a normative issue edit becomes `r<N+1>` and needs re-approval
and both auditors' plan review of its diff. Governing text: `.agents/skills/mdpro-delegator/references/roster-and-routing.md#planner`,
`.agents/skills/mdpro-delegator/references/landing-and-audit.md#gated-items`.

## From tickets to landing
- **One approved ticket is one brief and one PR**, granted only when every ticket that blocks it has landed.
- **Precedence:** spec snapshot, then ticket, then brief, then card.
- **Implementation** follows `jack-tdd-workflow` on both runtimes. A fresh attacker checks the matrix before any RED;
  each RED settles in a cycle, followed by `code-review` on the committed candidate
  (`docs/agents/implementor.md#gated-items`). A new seam, changed behaviour or changed AC meaning stops for the delegator.
- **Never:** `/implement`, `/implement-spec`, or an integration branch.
