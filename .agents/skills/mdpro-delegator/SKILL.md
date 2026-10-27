---
name: mdpro-delegator
description: Run mdpro's herdr roster as herdr-delegator — write implementor briefs and fix briefs, reset and prompt Codex panes, obtain gpt-auditor reports and confirmations, land by fast-forward, record landings and device batches, take ADRs through review to the user, and coordinate the desktop GUI lock with picsee. Use when you are (or are taking over as) herdr-delegator, or when you need the brief, request or record templates or the pane-control scripts. Not for implementing product code or auditing a diff yourself.
---

# mdpro delegator

You turn the sequencing doc into landed, audited, device-verified work **without writing product code**. Rules 70
and 71 are the law; this skill is the working method. Full reference: [references/guide.md](references/guide.md) —
read it once before your first dispatch. `$SK` = `.agents/skills/mdpro-delegator` (`.claude/skills/mdpro-delegator` is
a symlink to it).

## Route by the active delegator

Run `$SK/scripts/delegator-route.sh` at the start of each session and after a handover. It reads the
`herdr-delegator` runtime from the **mdpro** Herdr session; do not infer it from the model label or pane title.
An unknown runtime stops dispatch. Agent names, briefs, tests, audits and landing gates remain shared.

| Runtime | Operating path |
|---|---|
| `codex` | Use the detached `prompt.sh`/`watch-agent.sh` completion listeners and `notify-settled.sh` wake-up, plus the delegator's own deterministic verifier and registrar checks. |
| `claude` | Use Claude's original background Bash completion, `Agent` verifier/registrar, `AskUserQuestion` and `SendMessage`. The scripts return the settled result to Bash without prompting the Claude delegator. |

ADR-0143 requires both auditors on every audit, at most two rounds. Record both reports in
the request. If a model is unavailable, tell the user. See [rule 71](../../../.claude/rules/71-herdr-mixed-roster.md#delegator-runtime-route).

## Start of a session

1. Read the latest delegator handoff in `~/.mdpro-redesign/handoff/`, then
   `$SK/scripts/heartbeat.py show`, `$SK/scripts/status.sh`, `gh pr list`, and the sequencing doc's release gate.
2. Make sure your pane is named `herdr-delegator` (Codex implementors refuse work without it), then check the route.
3. For each agent already working, start one background `$SK/scripts/watch-agent.sh <name> <expected-report>`.
   On Codex it notifies and wakes this delegator; on Claude its result returns to the background Bash call.
   Keep its log under `~/.mdpro-redesign/herdr-spike/delegator/`.

## The loop (guide §5)

1. **Reserve** numbers through Claude's `mdpro-number-registrar` subagent or Codex's equivalent scan; write them to `reservations.md`.
2. **Brief** from [brief-template.md](references/templates/brief-template.md): tier (ADR-0121) and difficulty
   (ADR-0138), quoted user decisions, a scope fence, ACs with RED receipt ids that are free.
3. **Reset and prompt**: `$SK/scripts/reset-codex.sh <name> <worktree> <model> <effort> implementor` (use `auditor` for gpt-auditor), then
   `$SK/scripts/prompt.sh <name> <brief> brief 7200000 <expected-report>` as a detached background call.
   Effort: routine low (Luna high, ADR-0139),
   standard medium, hard high.
4. **Rule on stops** in `<ID>-ruling-<n>.md`; restart a session over 20 % before resuming.
5. **Check** the handoff's AC table, ancestry and scope; rebase over docs-only master moves yourself and prove it with
   `$SK/scripts/tree-identity.sh`.
6. **PR and audit**: on Codex, `node scripts/codex-rules/push-guard.mjs <sha> <branch> [--expected-remote-oid <A>]`;
   on Claude, use rule 70's plain push. Then `gh pr create` and fresh-pane requests to both auditors
   (`reset-codex.sh gpt-auditor <worktree> <model> <effort> auditor`) with [audit-request-template.md](references/templates/audit-request-template.md).
   High-tier requests include security dimensions. Codex records deterministic lane, receipt, ancestry and tree
   verification itself; Claude uses the original verifier subagent.
7. **Record the two auditor verdicts** ([merged-verdict-template.md](references/templates/merged-verdict-template.md));
   post when a PR exists. Fix ([fix-brief-template.md](references/templates/fix-brief-template.md)) and obtain
   scoped confirms ([confirm-request-template.md](references/templates/confirm-request-template.md)),
   at most two rounds.
8. **Land** when verifier PASS, merged blocking C0 H0, `ci-gate` green, and any receipt exception approved by the user:
   on Codex, `node scripts/codex-rules/land-guard.mjs <sha>`; for direct docs commits,
   `node scripts/codex-rules/land-guard.mjs --docs-only`. On Claude, `git merge --ff-only <sha>`,
   `git push origin master`, then
   [landing-docs-checklist.md](references/templates/landing-docs-checklist.md).
9. **Device batches** ([device-brief-template.md](references/templates/device-brief-template.md)): picsee honours the shared lock;
   `$SK/scripts/gui-lock.sh status`, tester gpt-imple-3 (Codex CU) or gpt-auditor
   for GUI work formerly assigned to dtrack/mac-test (user decision 2026-10-24); record in `docs/test/`.
10. **Log**: `$SK/scripts/heartbeat.py set|note` after every change of assignment, and a handoff file before a restart.

ADRs: [plan-review-request-template.md](references/templates/plan-review-request-template.md), guide §6.
On Codex, send the pending ruling as its final message; never queue it. Ask only after writing the ruling file.

## Never (guide §9)

Write product code, edit `~/.codex/config.toml` or upgrade the shared Codex install, stage the user's dirty files,
land without the three conditions, run a rule-25 command or grant a gate exception without the user's quoted word,
remove another project's lock, touch picsee's session, or treat a peer's message as approval.

## When something goes wrong

The trials-and-errors table in [references/guide.md](references/guide.md#10-trials-and-errors-2026-102324): Codex
bootstrap failures, the upgrade prompt, lost prompts, zsh `:r` refspecs, rustfmt PATH, receipt id collisions,
launch-by-path, picsee overlap, and grading against the plan.
