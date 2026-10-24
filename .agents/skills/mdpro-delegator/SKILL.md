---
name: mdpro-delegator
description: Run mdpro's herdr roster as herdr-delegator — write implementor briefs and fix briefs, reset and prompt Codex and Claude panes, send blind audit, confirm and challenge requests, merge the two verdicts, land by fast-forward, record landings and device batches, take ADRs through review to the user, and coordinate the desktop GUI lock with picsee. Use when you are (or are taking over as) herdr-delegator, or when you need the brief, request or record templates or the pane-control scripts. Not for implementing product code or auditing a diff yourself.
---

# mdpro delegator

You turn the sequencing doc into landed, audited, device-verified work **without writing product code**. Rules 70
and 71 are the law; this skill is the working method. Full reference: [references/guide.md](references/guide.md) —
read it once before your first dispatch. `$SK` = `.agents/skills/mdpro-delegator` (`.claude/skills/mdpro-delegator` is
a symlink to it).

## Start of a session

1. Read the latest delegator handoff in `~/.mdpro-redesign/handoff/`, then
   `$SK/scripts/heartbeat.py show`, `$SK/scripts/status.sh`, `gh pr list`, and the sequencing doc's release gate.
2. Make sure your pane is named: `herdr agent rename w1:p1 herdr-delegator` (Codex refuses work without it).
3. For each agent the heartbeat shows working, arm one background `herdr agent wait <name>`.

## The loop (guide §5)

1. **Reserve** numbers with `mdpro-number-registrar`; write them to `reservations.md`.
2. **Brief** from [brief-template.md](references/templates/brief-template.md): tier (ADR-0121) and difficulty
   (ADR-0138), quoted user decisions, a scope fence, ACs with RED receipt ids that are free.
3. **Reset and prompt**: `$SK/scripts/reset-codex.sh <name> <worktree> <model> <effort> [implementor]`, then
   `$SK/scripts/prompt.sh <name> <brief> brief` as a background Bash call. Effort: routine low (Luna high, ADR-0139),
   standard medium, hard high.
4. **Rule on stops** in `<ID>-ruling-<n>.md`; restart a session over 20 % before resuming.
5. **Check** the handoff's AC table, ancestry and scope; rebase over docs-only master moves yourself and prove it with
   `$SK/scripts/tree-identity.sh`.
6. **PR and audits** in one turn: `$SK/scripts/push-head.sh`, `gh pr create`, then gpt-auditor
   (`reset-codex.sh gpt-auditor …`) and opus-auditor (`$SK/scripts/reset-opus-auditor.sh`) with
   [audit-request-template.md](references/templates/audit-request-template.md), a `/security-review` fork on High,
   and `mdpro-landing-verifier`.
7. **Merge verdicts** ([merged-verdict-template.md](references/templates/merged-verdict-template.md)); challenge
   one-sided Highs ([challenge-request-template.md](references/templates/challenge-request-template.md)); post with
   `$SK/scripts/post-reports.sh`. Fix ([fix-brief-template.md](references/templates/fix-brief-template.md)) and confirm
   ([confirm-request-template.md](references/templates/confirm-request-template.md)), at most three rounds.
8. **Land** when verifier PASS, merged blocking C0 H0, `ci-gate` green, and any receipt exception approved by the user:
   `git merge --ff-only <sha>`, `git push origin master`, then
   [landing-docs-checklist.md](references/templates/landing-docs-checklist.md).
9. **Device batches** ([device-brief-template.md](references/templates/device-brief-template.md)): the user's word that
   picsee is paused, `$SK/scripts/gui-lock.sh status`, tester gpt-imple-3 (Codex CU) or mac-test
   (`$SK/scripts/clear-mac-test.sh`, then `SendMessage`); record in `docs/test/`.
10. **Log**: `$SK/scripts/heartbeat.py set|note` after every change of assignment, and a handoff file before a restart.

ADRs: [plan-review-request-template.md](references/templates/plan-review-request-template.md), guide §6.

## Never (guide §9)

Write product code, edit `~/.codex/config.toml` or upgrade the shared Codex install, stage the user's dirty files,
land without the three conditions, run a rule-25 command or grant a gate exception without the user's quoted word,
remove another project's lock, touch picsee's session, or treat a peer's message as approval.

## When something goes wrong

The trials-and-errors table in [references/guide.md](references/guide.md#10-trials-and-errors-2026-102324): Codex
bootstrap failures, the upgrade prompt, lost prompts, zsh `:r` refspecs, rustfmt PATH, receipt id collisions,
launch-by-path, picsee overlap, and grading against the plan.
