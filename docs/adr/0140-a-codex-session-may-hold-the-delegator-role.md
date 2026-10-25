# 0140. A Codex session may hold the delegator role

## Status

Accepted, 2026-10-25. Decided by the user, recorded by herdr-delegator (Claude route). The user's words:
「Accept both (Recommended)」, answering whether to accept ADR-0140 and ADR-0141. Not separately audited; reviewed as ADR-0141's dependency.

Proposed, 2026-10-24, by herdr-delegator. The user's direction:
- 「gpt-imple-1 工作结束后，你创建交接文档，之后由codex-delegator继续你的工作」;
- 「1. yes」, answering whether the role change gets an ADR.
- Later routing direction: 「当delegator 是codex(gpt model) powered 的时候，delegator 遵循当前的机制，特别是监控各个Agent状态的脚本等。但是当delegator 是claude model powered(Opus or Fable, etc.), 还是应该遵循原来的机制，各个agent还是一致的, opus-auditor is optional(when claude usage is sufficient and user request).」

On acceptance it partially supersedes:
- rule 70 § Sessions, "Every session runs on Opus", for the delegator only. Codex implementors were already an
  exception there;
- rule 71 § Roster, the delegator row ("Claude Opus, herdr pane of that name"), which becomes "Claude Opus or Codex".

## Context

- **Who delegates today.** Since ADR-0124 the delegator has been herdr-delegator, a Claude Opus session in herdr
  pane `w1:p1` on the Mac mini (ADR-0134).
- **The user's plan.** The user wants a Codex session, codex-delegator, to take over, working from the handoff
  `~/.mdpro-redesign/handoff/herdr-delegator-20261024-to-codex-delegator.md` and the `mdpro-delegator` skill
  (PR #534).
- **What the rules assume a delegator can do:**
  - `AskUserQuestion` for every ruling;
  - `SendMessage` to picsee-delegator for shared-lock coordination;
  - `Agent` subagents: `mdpro-landing-verifier`, `mdpro-number-registrar`;
  - a `fork` for `/security-review`;
  - being the herdr agent named `herdr-delegator`. Codex implementors check for that name and refuse work without it.
- **What Codex has instead:**
  - its own custom agents (`.codex/agents/*.toml`);
  - shell access, including `herdr` and `tmux`;
  - its final message, which is how it talks to the user.

## Options considered

1. **Keep a Claude delegator.** Lost: the user chose the Codex hand-over.
2. **A Codex delegator with no rule change.** Lost: it would break rule 70 ("every session runs on Opus") on its first
   action, and leave no defined way to do the steps that need Claude-only tools.
3. **A Codex delegator, with a named substitute for each Claude-only step.** Chosen.

## Decision

1. **Either model may hold the role.** The delegator is the herdr agent named `herdr-delegator`, on Claude Opus or
   Codex. Only one at a time: the outgoing delegator's pane is renamed or closed before the new one takes the name, so
   implementors keep checking a single name.
2. **Route by the active runtime, not by pane name or model label.** The shared `herdr-delegator`
   agent reports `codex` or `claude` through Herdr. Unknown identity stops dispatch. Codex keeps
   the detached completion listeners that notify and prompt its idle turn. Claude keeps its original
   background Bash wait result, `Agent` subagents, `AskUserQuestion` and `SendMessage`; the listener
   scripts return to Bash without prompting Claude. The other agents retain their names and roles.
3. **Every other rule binds unchanged:**
   - landing (the three conditions, `--ff-only`, push);
   - blind audits by the required gpt-auditor; a Claude delegator may add opus-auditor only when
     the user requests it and Claude usage is sufficient; if used, its blocking findings join the verdict;
   - the round cap;
   - receipts;
   - rule 25;
   - the GUI and heavy locks;
   - docs-only direct commits.
4. **Substitutes for the Claude-only steps:**

   | Step | Claude delegator | Codex delegator |
   |---|---|---|
   | Ask the user | `AskUserQuestion` | its available question channel, with options and recommendation; nothing proceeds until the user answers, quoted verbatim in the record |
   | GUI batches formerly assigned to mac-test/dtrack | a device brief to gpt-auditor through herdr | the same device brief and gpt-auditor; the tester assignment is independent of delegator runtime |
   | picsee coordination | `SendMessage` | the shared `owner` file of `$HOME/.cache/desktop-gui.lock` (ADR-0134 decision 6), and the user for anything else |
   | Landing verifier | `mdpro-landing-verifier` subagent | the same procedure (`.claude/agents/mdpro-landing-verifier.md`), run by the delegator in a detached `mdpro-wt/verify-<sha7>`, with the same PASS / ISSUES / BLOCKED report written to `herdr-spike/delegator/verify-<sha7>.md` |
   | Number registrar | subagent | the registrar's scan, run by the delegator, recorded in `reservations.md` |
   | High-tier security review | a Claude fork when applicable | the security section in gpt-auditor's fresh audit request |

5. **Optional Opus stays independent.** Neither delegator audits its own diff; the Claude route's optional Opus audit is
   a fresh request with the user's words and the usage check recorded. The absence of Opus is not a landing blocker.
6. **Hand-over.** The outgoing delegator writes a handoff under `~/.mdpro-redesign/handoff/`. The incoming one checks
   every fact in it with a command before its first dispatch.

## Consequences

- **Gained.**
  - The user can run the roster from Codex.
  - Each Claude-only step has a written substitute, so the hand-over does not depend on memory.
- **Costs.**
  - The verifier is no longer an independent agent when the delegator runs it itself. The auditors and CI remain
    independent of it, but one check moves into the delegator's own hands.
  - An optional Opus audit costs another pane request only when the user requests it and usage allows.
  - There is no `SendMessage` to picsee, so coordination beyond the lock goes through the user.
  - The Codex question channel differs from Claude's `AskUserQuestion`; the answer still must be recorded verbatim.
- **Unchanged.** Every rule and ADR not named above.
- **Foreclosed.** Nothing; a later ADR can return the role to Claude only.
