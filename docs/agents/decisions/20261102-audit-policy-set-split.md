# 2026-11-02: The policy set moves into its own pinned file

- **Decided:** 2026-11-02, by the user: 「Fable's split (Recommended)」, then 「Pure move, allowance 13,000 (Recommended)」.
- **Decision:** The cc-suite policy set and its policy-only, mixed and gate-tooling routing move, unchanged, from
  `docs/agents/audit-dimensions.md` into `docs/agents/audit-policy-set.md`, which an auditor reads only when § Which set
  routes the request there; such a request also names `<P>`, that file's blob at `<M>`, beside `<B>` (ADR-0146). The
  dimension allowance of ADR-0147 decision 5 moves from 11,500 B to 13,000 B by the user's word; the 50,000 B auditor
  route cap is unchanged. The split-count exclusion adds `.claude/tdd-guardian/receipts/` and
  `.claude/tdd-guardian/receipt-evidence/`.
- **changes:** `docs/agents/audit-dimensions.md`, `docs/agents/audit-policy-set.md` (new),
  `docs/agents/decisions/README.md`, `.agents/skills/mdpro-delegator/SKILL.md`,
  `.agents/skills/mdpro-delegator/references/guide.md`,
  `.agents/skills/mdpro-delegator/references/templates/audit-request-template.md`,
  `.agents/skills/mdpro-delegator/references/templates/confirm-request-template.md`,
  `.agents/skills/mdpro-delegator/references/templates/challenge-request-template.md`,
  `.agents/skills/mdpro-delegator/references/templates/plan-review-request-template.md`,
  `.agents/skills/mdpro-delegator/references/templates/landing-docs-checklist.md`,
  `.claude/agents/mdpro-fable-auditor.md`, `scripts/codex-rules/land-guard.mjs`,
  `tests/tooling/adr0146-audit-dimensions.test.ts`, `tests/tooling/codex-land-guard-docs.test.ts`,
  `tests/tooling/gh586-audit-policy-split.test.ts` (new).
- **supersedes:** none.
- **gate-sensitive:** yes: it changes what an auditor loads for a PR to land and adds a landing-guard protected file
  (herdr-delegator, 2026-11-02, brief #586).
