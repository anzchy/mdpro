# 2026-11-02: New items are GitHub issues

- **Decided:** 2026-11-02, by the user, on D355's shared-files finding: 「GitHub issues (Recommended)」, for "New D items
  and tooling stumbles become issues in anzchy/mdpro, as rule 12 already does for specs. Existing rows stay as the
  record, and the sequencing doc keeps order only." Then, on the id: 「Issue number only (Recommended)」.
- **changes:** `CLAUDE.md` (§ Plan status tracking, § Feature Ledger), `.claude/rules/70-multi-session-coordination.md`
  (§ How work is assigned, § Commits and branches, § Reserving numbers), `.agents/skills/mdpro-delegator/SKILL.md`,
  `.agents/skills/mdpro-delegator/references/guide.md`, `.agents/skills/mdpro-delegator/references/session-ops.md#reserving-numbers`,
  `.agents/skills/mdpro-delegator/references/roster-and-routing.md#subagents`, `.agents/skills/mdpro-delegator/references/landing-and-audit.md` (§ After the cap, § Tiers),
  `.agents/skills/mdpro-delegator/references/templates/brief-template.md`, `.agents/skills/mdpro-delegator/references/templates/landing-docs-checklist.md`,
  `.claude/agents/mdpro-number-registrar.md`, `.claude/skills/plan-and-doc-map/SKILL.md`,
  `.claude/skills/mdpro-handoff/SKILL.md`, `docs/adr/README.md` (Below the bar), `docs/agents/auditor.md` (§ Tiers),
  and one preamble line in `docs/plans/20260912-frontend-backend-sequencing-order.md`.
- **supersedes:** none. It replaces the D-row clauses of rule 70 at `9c32bcde`, which were rule text, not an ADR.
- **gate-sensitive:** no (herdr-delegator, 2026-11-02, D355 ruling 1 Q6): where an item's status is kept changes no
  landing condition, auditor set or receipt contract.

## Decision

A new item, finding or D-class defect is a GitHub issue in `anzchy/mdpro` (`docs/agents/issue-tracker.md`). Its id is
the issue number, with no `D<n>` alias in the title, and its receipt ids are `GH<n>-S<k>`. Its status is the issue's
state and labels, and the landing record comments on it and closes it. The sequencing doc keeps order only; its
existing rows stay unchanged as the record, and existing `D<n>` ids keep resolving through its anchors. A tooling
stumble (PATH, lock, inventory, load) is a handoff line, not an issue, unless the delegator registers it.
`mdpro-number-registrar` keeps reserving ADR numbers and only looks up D ids.
