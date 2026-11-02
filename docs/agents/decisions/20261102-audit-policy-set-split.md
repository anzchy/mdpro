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
  `.agents/skills/mdpro-delegator/references/templates/merged-verdict-template.md`,
  `.claude/agents/mdpro-fable-auditor.md`, `scripts/codex-rules/land-guard.mjs`,
  `.claude/rules/70-multi-session-coordination.md` (item 4's pin and docs-only exception, the High and Low tier
  bullets), `.claude/rules/71-herdr-mixed-roster.md` (§ Audits under herdr › Dimensions),
  `docs/adr/0147-always-on-instructions-become-a-routing-map.md` (its Status line only),
  `tests/tooling/adr0146-audit-dimensions.test.ts`, `tests/tooling/codex-land-guard-docs.test.ts`,
  `tests/tooling/gh586-audit-policy-split.test.ts` (new).
- **supersedes:** ADR-0147 decision 5's 11,500 B dimension allowance and its single 50,000 B auditor cap, folded
  and changed here; ADR-0147's Status line links this entry.
- **gate-sensitive:** yes: it changes what an auditor loads for a PR to land and adds a landing-guard protected file
  (herdr-delegator, 2026-11-02, brief #586).
