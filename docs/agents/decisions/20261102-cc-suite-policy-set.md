# 2026-11-02: The cc-suite policy set

- **Decided:** 2026-11-02, by the user: 「In this PR (Recommended)」, then 「follow cc-suite 的维度」, then
  「500 行预算按 cc-suite 原样保留」.
- **Decision:** A change to rule, doc, skill or agent text is audited by the policy set: cc-suite 2.5.0's NL auditors
  used as they are, pinned to their `v2.5.0` blobs and routed by changed path. Depth is cc-suite Mini at Low and Medium
  tier, and Full at High tier and for a gate-sensitive entry's plan review; cc-suite's thresholds apply as written.
- **changes:** `docs/agents/audit-dimensions.md` (§ Which set, § policy (cc-suite NL)), and the lines that carry it:
  `.claude/rules/70-multi-session-coordination.md` (item 4's "§ Which set" wording and the plan-review route),
  `.claude/rules/71-herdr-mixed-roster.md`, `.agents/skills/mdpro-delegator/SKILL.md`,
  `.agents/skills/mdpro-delegator/references/guide.md`,
  `.agents/skills/mdpro-delegator/references/templates/audit-request-template.md`,
  `.agents/skills/mdpro-delegator/references/templates/merged-verdict-template.md`,
  `.agents/skills/mdpro-delegator/references/templates/plan-review-request-template.md` (the policy-only exception
  to the security section, and the policy set's place in plan review).
- **supersedes:** none.
- **gate-sensitive:** yes: it changes a landing condition, the dimensions a PR must pass to land (herdr-delegator,
  2026-11-02).
