# 0137. The second auditor runs on Opus, as the opus-auditor pane

## Status

Accepted, 2026-10-23. Decided by the user, recorded by herdr-delegator. The user's words:
「后面fable auditor，默认用 opus model，然后新建一个 opus-auditor pane, 原来的fable audit 全都delegate to opus-auditor，对应修改rule」.
Two follow-up choices, also the user's:
- the permission mode: 「跳过确认，加角色守卫 (Recommended)」;
- the Fable audit already running for D305 round 1: 「让它跑完」.

It partially supersedes:
- [ADR-0115](0115-every-pre-landing-audit-runs-twice-codex-and-fable-on-the-same-dimensions.md), the clause naming
  Fable as the second auditor's model. Two audits on the same dimensions stay;
- [ADR-0118](0118-three-implementation-slots-and-opus-reviews-adrs-and-plans.md), the clause "Fable reviews PRs only";
- [ADR-0131](0131-every-audit-request-and-every-fix-round-starts-from-a-fresh-context.md), the clause that makes the
  second half a fresh subagent per request. It becomes a fresh pane per request.

## Context

- **How it worked before.** Under rule 71 the second auditor was a fresh `mdpro-fable-auditor` subagent of the
  delegator, on Fable for PRs and on Opus (`model: "opus"`) for ADRs and plans.
- **The problem.** As a subagent, it ran inside the delegator's own session:
  - its turns, context and tool budget counted against the delegator;
  - its work was invisible in herdr;
  - it could not be reset or watched like gpt-auditor.
- **The user's direction.** The user asked for the second auditor to default to Opus and to run as its own herdr pane.

## Options considered

1. **Keep the Fable subagent.** Lost: the user decided otherwise. The subagent's costs to the delegator also remain.
2. **An Opus subagent, the same agent definition with `model: opus`.** Lost: it fixes the model but not the visibility
   or the load on the delegator.
3. **A herdr pane `opus-auditor`** (Claude Code, `--model opus`), one fresh pane per request, working from a request
   file. Chosen.

## Decision

1. **The pane.**
   - The second auditor is the herdr agent `opus-auditor`, Claude Code on Opus, in the detached worktree
     `mdpro-wt/opus-auditor`.
   - It takes every request the `mdpro-fable-auditor` subagent took: `audit`, `confirm`, `challenge` and `plan`.
   - It follows that agent definition's protocol, which now defaults to `model: opus`, and its standing brief
     `~/.mdpro-redesign/herdr-spike/opus-auditor/BRIEF.md`.
2. **Its permissions.**
   - It starts with `--dangerously-skip-permissions`, with `MDPRO_ROLE=real-device-tester` and `MDPRO_REPORT_DIR`
     set to its report folder.
   - `role-guard.sh` then refuses state-changing git, and any Write or Edit outside that folder.
3. **Fresh context.** Each request gets a new pane, as gpt-auditor's do (rule 71 § Restart): split, close the old pane,
   then `herdr agent start opus-auditor --kind claude …`. The prompt points at a self-contained request file. The read
   barrier by phase is unchanged.
4. **Reports.** It writes `~/.mdpro-redesign/herdr-spike/opus-auditor/<item>-r<round>.md`. The delegator posts each
   report on the PR as before.
5. **The subagent stays as a fallback.** `mdpro-fable-auditor` remains, now `model: opus`. The delegator uses it only
   when the pane cannot start, and says so in the merged verdict.
6. **In flight.** The Fable audit of D305 round 1 that is already running finishes as is. Every later request goes to
   opus-auditor.

## Consequences

- **Gained.**
  - The second audit is visible in herdr and can be reset and watched like gpt-auditor.
  - It no longer spends the delegator's session.
  - The two halves are now two vendors' models, Codex (OpenAI) and Opus (Anthropic), on the same dimensions.
- **Costs.**
  - Fable's distinct model is gone from the PR audits. The second auditor is now the same model family as the
    delegator, so correlated blind spots between the delegator's briefs and the audit are more likely.
  - A pane costs a start-up per request.
  - Its long report must be written to a file, not returned, so a write outside the report folder is a hard failure
    the guard enforces.
  - Skipping permission prompts relies on the role guard. The guard covers git and the file-writing tools; it does not
    stop every possible Bash side effect.
- **Foreclosed.** Nothing permanent: a later decision can put Fable or another model back behind the same pane.
