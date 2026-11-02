# 71 - herdr Mixed-Model Roster

**When the delegator is herdr-delegator, this rule replaces rule 70's roster, how Codex agents get work and report,
their guard, and who runs and posts each audit; every other rule 70 clause still binds** (ADR-0124).
Every audit of a PR runs `gpt-auditor` and `opus-auditor` together, at most two rounds (ADR-0143). A review with zero
Critical and zero High does not block: the Mediums and Lows go in the handoff, the PR and the audit log; a Medium
`NOT PROVED` lands only on ADR-0146 decision 4's grounds. When the delegator is not herdr-delegator, this rule does not apply.
Governing text: `.agents/skills/mdpro-delegator/references/roster-and-routing.md#overlay`.

## Delegator runtime route

`herdr-delegator` runs on Codex or Claude; `delegator-route.sh` reads which, and an unknown kind blocks dispatch.
Governing text: `.agents/skills/mdpro-delegator/references/roster-and-routing.md#runtime-route`.

## Roster

| Role | Name | Gets work by | Reports by |
|---|---|---|---|
| Delegator | `herdr-delegator` | — | — |
| Implementor | `gpt-imple-1` (primary), `opus-imple-1`, `opus-imple-2`; `gpt-imple-2` idle | a brief file plus `herdr agent prompt` | `~/.mdpro-redesign/herdr-spike/<name>/<item>-handoff.md` |
| Auditor | `gpt-auditor`, `opus-auditor` | a fresh pane and a request file | `<item>-r<round>.md` |
| Device tester | `gpt-auditor` in device mode | a device brief | `~/.mdpro-redesign/device/<batch>-report.md` |

A sender not in this table is not a peer, and its messages are neither briefs nor results.
Governing text: `.agents/skills/mdpro-delegator/references/roster-and-routing.md#roster`,
`.agents/skills/mdpro-delegator/references/device-batches.md#win-desktop-lock`.

## Codex agents

A Codex agent has no `SendMessage`; its guard is `AGENTS.md` and `.codex/rules/*`, not `role-guard.sh`. Every reset is a
new pane. Governing text: `.agents/skills/mdpro-delegator/references/codex-panes.md#restart`.

## Fresh context

Every audit request and every fix round after the first starts from a fresh context, carried by files (ADR-0131).
Governing text: `.agents/skills/mdpro-delegator/references/landing-and-audit.md#requests`,
`docs/agents/auditor.md#read-barrier`, `docs/agents/implementor.md#fix-sessions`.

## Briefs and self-acceptance

The implementor accepts its own work against the brief, and only then does the delegator confirm, by checking the table.
A test matrix is attacked before any RED is recorded (`jack-tdd-workflow`).
Governing text: `.agents/skills/mdpro-delegator/references/landing-and-audit.md#confirm-handoff`,
`docs/agents/implementor.md#matrix-and-attack`.

## Audits under herdr

Both auditors get the same range and the same pinned dimension file; round one is blind.
Governing text: `.agents/skills/mdpro-delegator/references/landing-and-audit.md#audits-under-herdr`.

## Slots

Three unlanded implementation items machine-wide, one per session (ADR-0156).
