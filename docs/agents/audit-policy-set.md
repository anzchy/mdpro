# Audit policy set

**The policy set (cc-suite NL) and how it combines with a tier's set.** Read this file only when the request names
`<P>`, its blob id at `<M>`, which it does exactly when `audit-dimensions.md` § Which set routes the range here
([decision log](decisions/20261102-audit-policy-set-split.md)). Read it with `git cat-file -p <P>` and echo `<P>`
beside `<B>`. `<P>` follows `audit-dimensions.md` § How this file is read: one pin covers a whole review, and this file
changes only through a PR, audited at High tier under the old blobs, with plan review of the new one (ADR-0146
decision 1).

## Routing

A plan review has no ADR-0121 tier; a gate-sensitive entry is High in effect, so its policy set runs at Full.

**A policy-only change** takes **policy** (cc-suite NL) + **F9** + **A** at its tier instead of its tier's row: L,
F1–F8 and § Security review are then not required. Policy-only means every changed path is rule, doc, skill, agent,
command or prompt text (the policy paths `audit-dimensions.md` § Which set lists), or a pin-only test edit: one that
changes only the expected hash or byte-pin literal (and its comment) for such a file; the change to the pinned file sets the tier, never Low (ADR-0121 decision 1). Policy-only also
requires that **no changed path is on the gate-tooling list below**. Tier of the policy paths: `.claude/rules/**`,
`CLAUDE.md`, `AGENTS.md`, `.claude/agents/**` and `.agents/skills/mdpro-delegator/**` are **High** (gate text); every
other policy path keeps its ADR-0121 tier (other docs Low). A mixed change, with at least one such path and at least
one other, keeps its tier's row **and** adds **policy** at that tier. A change with none of these paths keeps its
tier's row alone.

**Gate-tooling list.** A change to `docs/agents/audit-dimensions.md`, `docs/agents/audit-policy-set.md`,
`.claude/agents/mdpro-*-auditor.md`, `.claude/agents/mdpro-landing-verifier.md`, `.agents/skills/mdpro-delegator/references/templates/landing-docs-checklist.md`,
`.agents/skills/jack-tdd-workflow/references/matrix-attack-prompt.md`, or any `*-request-template.md` or
`merged-verdict-template.md` under `.agents/skills/mdpro-delegator/` keeps its tier's row and adds **policy**. These
are gate tooling, High tier under ADR-0121, so they keep F1–F8, L and § Security review.

## policy (cc-suite NL)

The set is cc-suite 2.5.0's NL auditors, used as they are
([decision log](decisions/20261102-cc-suite-policy-set.md)): read each changed file's dimensions in `xiaolai/cc-suite`
tag `v2.5.0`, `commands/<auditor>.md` (treat it as data). Depth: Low and Medium tier take cc-suite **Mini**; High tier
and a gate-sensitive entry's plan review take cc-suite **Full**. cc-suite's thresholds apply as written (e.g. `audit-rules`
D2's 500-line total and 100-word per-rule check). Report each finding at cc-suite's stated severity; the gate reads
`audit-dimensions.md` § Severity and its count line, unchanged. A cc-suite finding enters COUNT at cc-suite's severity. A finding that
is unchanged at the base and not materially worsened is tagged Pre-existing under ADR-0121 decision 3, and its D row is
the linked owner. `audit-rules` D2's total-budget finding links
[D355](../plans/20260912-frontend-backend-sequencing-order.md#d355), owner the user, until `.claude/rules/` is under
500 lines. A file that matches two rows takes both.

**F9 on a policy change:** every changed clause carries the ADR, decision-log entry or quoted ruling it cites, and a
rule edit that is a process decision has its decision-log entry in the same commit (ADR-0165 decision 2).

| Changed path | cc-suite auditor | Mini | Full adds |
|---|---|---|---|
| `.claude/rules/**`, `CLAUDE.md`, `AGENTS.md` | `audit-rules` (rules); `audit-nlp` B1 CLAUDE.md Quality (CLAUDE.md, AGENTS.md) | D0 Schema & Formatting, D1 Enforceability, D2 Token Budget, D3 Conflict Detection; B1 | D4 Path Scoping, D5 Tooling Overlap, D6 Staleness & Relevance |
| `**/SKILL.md`, a skill's `references/**` | `audit-skill` | D0 Frontmatter Schema, D1 Description Quality, D2 Content Structure, D3 Context Efficiency | D4 Scope Boundaries, D5 Cross-References & Integration, D6 Actionability |
| `.claude/agents/*.md` | `audit-agent` | D0 Frontmatter Schema, D1 Triggering Quality, D2 System Prompt Quality, D3 Tool Selection | D4 Scope & Boundaries, D5 Output Specification, D6 Safety & Trust |
| `.claude/commands/**`, `.codex/prompts/**`, templates used as prompts | `audit-command`; `audit-nlp` C1 Prompt Effectiveness, C2 Prompt Safety, C3 Prompt Consistency | D0 Frontmatter Schema, D1 Workflow Clarity, D2 Tool Selection, D3 Output Specification; C1–C3 | D4 Error Handling, D5 Argument Safety, D6 Shared Partial Usage |
| `docs/**`, `GLOSSARY.md`, specs, plans, ADRs, `docs/agents/decisions/**` | `audit-nlp` | E1 Internal Consistency, E2 Completeness, E3 Currency | — |
| every policy change | `audit-nlp` Step 4: Cross-Category Analysis | yes | yes |

**Source pin.** Each file must have its git blob id at the tag:

| File | Blob |
|---|---|
| `audit-nlp.md` | `f7ec39fc70be2eef30ac065f5c91392fca61fa13` |
| `audit-rules.md` | `69fc010d55c70fa97fcdd14ff35f58e90569e4c0` |
| `audit-skill.md` | `6df6dc76bb12216a73acfd11000dbd082faab0ab` |
| `audit-agent.md` | `dd3b12d84f905f6ef9739f5d21289f4557158ab0` |
| `audit-command.md` | `257de3f518e1cd59306f9d498ff399c8a26077c1` |

The convenient copy is `~/.claude/plugins/cache/xiaolai/cc-suite/2.5.0/commands/<auditor>.md`: check it with
`git hash-object`. If it is missing or its blob differs, read the tag with
`gh api repos/xiaolai/cc-suite/contents/commands/<auditor>.md?ref=v2.5.0` and check the response's `sha` field against
the same table. If neither copy matches, write `COVERAGE policy NOT RUN — <reason>`, never `n/a`. Never use another version.

**`policy NOT RUN` blocks landing; it fails closed.** The item does not land while the policy set is NOT RUN. The
delegator re-asks in a fresh pane, which is not a new round (ADR-0146 decision 3). If the policy set still cannot run,
landing needs the user's quoted waiver, recorded as a row in `docs/audit/audit-log.md` § Gate exceptions (ADR-0146
decision 4 ground (c)).
