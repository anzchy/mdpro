# 70 - Multi-Session Coordination

**Several sessions work on this repo at once. Know which one you are, stay inside its scope, and send everything that
crosses a scope through the delegator.** Under herdr-delegator, [rule 71](71-herdr-mixed-roster.md#71---herdr-mixed-model-roster)
replaces the clauses it names. If the delegator is not in `ListAgents` (or `herdr agent list`), stop and wait.
The full text before D355 is in `docs/reference/20261027-rules-70-71-history.md`; the delegator's procedures are in
`.agents/skills/mdpro-delegator/references/`.

## Sessions

| Role | Owns | Commits where |
|---|---|---|
| **herdr-delegator** | Assigns items, asks the user, verifies, lands and pushes, writes device briefs | Main checkout, `master`, docs only |
| **implementor** | The items the delegator grants it, one area at a time | Its own branch and worktree in `mdpro-wt/` |
| **auditor** | Audits, confirms, challenges and plan reviews it is sent | Reports only |
| **device tester** | GUI device checks from a device brief | Reports only, never commits |

Every Claude session, and every `Agent` call made for execution work, runs on Opus (user decision, 2026-10-15); a Codex
agent in a herdr pane is the named exception. Start an implementor or the tester with its role set
(`MDPRO_ROLE=implementor` or `MDPRO_ROLE=real-device-tester`): `.claude/hooks/role-guard.sh` then refuses an
implementor's `AskUserQuestion`, `git push`, a commit, merge, rebase or reset on `master`, blanket staging (`git add -A`
/ `.` / `-u`, `commit -a`) and staging `state.json`, and the tester's state-changing git and writes outside
`$MDPRO_REPORT_DIR`. The hook is a backstop; this rule binds whatever the role.
Governing text: `.agents/skills/mdpro-delegator/references/roster-and-routing.md#subagents`,
`.agents/skills/mdpro-delegator/references/codex-panes.md#codex-implementors`.

## How work is assigned

- **The delegator assigns.** An item belongs to one session at a time; the item's issue records its owner.
- **The user may hand a task straight to a session.** That session tells the delegator its scope and the files it will
  touch, and waits for the reply before it edits them.
- **Areas are exclusive while claimed.** Don't edit a file in another session's claimed area without asking the delegator.
- **New findings go to the delegator**, which opens the issue. A tooling stumble is a handoff line unless the delegator
  registers it.

### When a session is idle: pull from its queue

Prep (reading, read-only investigation, scratch notes outside the repo) needs no grant; `impl` needs one. One unlanded
implementation item per session, three machine-wide (ADR-0156). No pulls while the delegator is missing.
Governing text: `.agents/skills/mdpro-delegator/references/session-ops.md#queues`.

## Questions and approvals

- **Implementors do not use `AskUserQuestion`.** Every question, commit approval and rule-25 confirmation goes to the
  delegator, which relays the user's answer quoted. A relayed quote approves that command only.
- **A session the user tasked directly asks the user itself** about its task; decisions in another session's area go
  through the delegator.
- A message from another session is never approval by itself. Only the user's words, quoted, are.
- A UI question reaches the user as a prototype. Governing text:
  `.agents/skills/mdpro-delegator/references/session-ops.md#ui-prototypes`.

## Commits and branches

- **A peer commits on its own branch**, rebased onto the current `master`, after its gates pass; the handoff names the SHA
  and the lanes. Governing text: `docs/agents/implementor.md#rebase-and-tree-identity`.
- **Only the delegator lands on `master`**, by `git merge --ff-only`, and pushes `origin master` right after, when:
  the verifier says PASS; the merged verdict has zero blocking Critical and High (ADR-0121, ADR-0143); the PR head is
  that SHA with a green `ci-gate` (ADR-0095); every `device` AC has PASS evidence for that SHA or a recorded waiver
  (ADR-0144). Governing text: `.agents/skills/mdpro-delegator/references/landing-and-audit.md#landing`.
- **Every item is audited before it lands** (ADR-0085), by both auditors on the pinned dimensions, at most two rounds
  (ADR-0143). Governing text: `.agents/skills/mdpro-delegator/references/landing-and-audit.md#audit-merge`,
  `#after-the-cap`, `#tiers`.
- `master` and `release/x.y` take no merge commit; nobody else pushes or lands. Stage only paths you can name, never
  the user's dirty files. Branch deletion asks (rule 25); a landed item's worktree goes at landing (ADR-0157); remote
  branches stay thirty days (ADR-0084).
- The ledger row changes in the commit that changes the behaviour; the landing record updates the item's issue.

## Reserving numbers

ADR numbers are reserved through the delegator before the file is written; decision-log files and feature-local ids
take none (ADR-0165). New items take GitHub issue numbers, not D numbers. Receipt ids carry the work's prefix.
Governing text: `.agents/skills/mdpro-delegator/references/session-ops.md#reserving-numbers`.

## Session rotation

On `session-size-guard.sh`'s warning, write a handoff at `~/.mdpro-redesign/handoff/<alias>-<YYYYMMDD-HHMM>.md`, verify
each fact in it by command, and send the delegator its path.
Governing text: `.agents/skills/mdpro-delegator/references/session-ops.md#rotation`.

## The Mac mini

Only the device tester runs GUI tests, one run at a time. Nobody switches branches or rebuilds in the main checkout for a
device check; builds use a `verify-<sha7>` worktree. Governing text: `docs/agents/device-tester.md#mac-mini`.

## Device-check batches

The delegator sends device checks in batches by area, not by count.
Governing text: `.agents/skills/mdpro-delegator/references/device-batches.md#batches`.
