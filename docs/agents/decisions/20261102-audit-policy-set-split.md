# 2026-11-02: The policy set moves into its own pinned file

- **Decided:** 2026-11-02, by the user: 「Fable's split (Recommended)」, then 「Pure move, allowance 13,000 (Recommended)」,
  then 「Separate cap 56,000 (Recommended)」.
- **Decision:** The cc-suite policy set and its policy-only, mixed and gate-tooling routing move, unchanged, from
  `docs/agents/audit-dimensions.md` into `docs/agents/audit-policy-set.md`, which an auditor reads only when § Which set
  routes the request there; such a request also names `<P>`, that file's blob at `<M>`, beside `<B>` (ADR-0146). The
  dimension allowance of ADR-0147 decision 5 moves from 11,500 B to 13,000 B by the user's word, and the auditor route
  takes two caps: the ordinary auditor route keeps 50,000 B; the policy-routed auditor route (`<P>` loaded), for any
  request that names `<P>`, plan reviews included, gets 56,000 B. The split-count exclusion adds
  `.claude/tdd-guardian/receipts/` and `.claude/tdd-guardian/receipt-evidence/`.
- **Caps:** Arithmetic: D355's planned shared set 29,431 B (D355-trim-plan § 3, approved 2026-11-02; D355's
  `always-on-budget.test.ts` measures the real value) + `audit-dimensions.md` 12,995 B + `audit-request-template.md`,
  the largest request, 2,725 B + `auditor.md` 3,500 B (ADR-0147 decision 5's budget for the planned role file) =
  48,651 B on the ordinary route, + `audit-policy-set.md` 6,193 B = 54,844 B on the policy-routed route. The caps are
  enforced by D355's budget test on its fixtures, not by this PR. On ADR-0147 decision 5's older 34,719 B projection
  the policy-routed route would be 60,132 B; a queued follow-up cuts the auditor's shared set (`claudeMdExcludes` at
  auditor launch), so the margin is expected to grow.
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
