# Codex panes

How the delegator starts, prompts, waits on and resets a Codex agent in a herdr pane. Text moved here from rules 70, 71 and 12 by D355 (ADR-0147 WI-1) keeps the rule's authority (ADR-0147 decision 3);
each block names where it came from. When this file and a rule disagree, the rule wins and this file is the bug.

## Codex implementors

<!-- moved-from: rule 70 § Sessions (ADR-0147) -->
**A Codex implementor under herdr** (`gpt-imple-*`; user decision,
2026-10-18: 「retire @mdpro-a3 whose job now is taken by impl-1 (rename
impl-1 to `gpt-imple-1`)」) is the one exception to the Opus rule in rule 70 § Sessions.
It is not in `ListAgents` and has no `SendMessage`. The delegator gives it
work with `herdr agent prompt <name> … --wait` and reads its report from
`~/.mdpro-redesign/herdr-spike/<name>/`. `role-guard.sh` does not run for
Codex, so [AGENTS.md § Every session (Codex)](../../../../AGENTS.md#every-session-codex) and the prefix rules in
`.codex/rules/mdpro.rules` stand in for it. How herdr starts these agents is
recorded in `docs/reference/20261018-herdr-multi-agent-rule70-roles.md`.

Which implementor owns which area right now lives in the delegator's
assignment messages, not in this file. Any other new kind of session gets a row here in the
commit that starts it working.

## Wake-ups

<!-- moved-from: rule 71 § Codex agents (ADR-0147) -->
- **No `SendMessage`, and not in `ListAgents`.**
  - The delegator reads their files and watches `herdr agent list`.
  - The test of rule 70's "delegator present" is `herdr agent list` showing `herdr-delegator`.
- **A Codex-powered delegator is woken when a Codex agent settles; it does not poll** (user question,
  2026-10-20: 「如何enabl panes auto-notify，最佳实践是什么，相关实践要写入rule 71」). herdr pushes
  nothing to another session. Its Codex integration (`herdr integration status` shows `codex:
  current`) only reports the agent's session, so herdr can classify the pane as `working`, `idle`,
  `blocked` or `done`. The wake-up therefore comes from a background command that exits when the
  agent's state changes. In Codex, a yielded `exec_command` session does not by itself start a
  later delegator turn. The script must explicitly notify and prompt the idle delegator:
  - **Every prompt to a Codex agent runs through**
    `.agents/skills/mdpro-delegator/scripts/prompt.sh <name> <brief> brief 7200000 <expected-report>`
    in a detached background process. It uses `herdr --session mdpro agent prompt --wait`, then
    `notify-settled.sh` shows the user a completion notification and prompts `herdr-delegator`
    after that agent is idle. The process must remain alive until settlement.
  - **A Codex implementor brief is checked first** (#592): `prompt.sh` refuses it, sending nothing,
    when its May edit or May create paths match rule 22's or rule 50's `paths:` and its
    `**Rules for paths in scope.**` field does not name that rule. It checks rules 22 and 50 only. It accepts:
    - one field paragraph, naming each rule as `rule <n>`, its stem (`22-comment-maintenance`) or its path;
    - scope lines under exactly `**May edit:**` or `**May create:**`, each path backticked and written from the
      repo root. A scope runs to the next heading or field label.

    Any other label that reads as May edit or May create, an unbackticked path or an escape in scope, or an
    entity, an HTML tag or a comment inside a line anywhere, refuses, naming the line.
  - **Never arm a bare `herdr agent wait` right after a prompt.** Without `--until`, it returns at
    once if the agent is still `idle`, which it is until the turn starts. Only `prompt --wait`
    first requires observed activity (`agent_prompt_stalled` otherwise). Use one detached
    `watch-agent.sh <name> <expected-report>` only for an agent that `herdr --session mdpro agent
    list` already shows as `working`. That covers re-arming after a restart of the delegator.
  - **On wake, the state is not the result.** A settled agent may have stopped mid-task: an output
    limit stalled gpt-imple-2 for two days (2026-10-18). Read the expected report file. If it is
    missing, read the pane (`herdr agent read <name> --source recent-unwrapped --lines 80`). On
    `blocked`, read the dialog and decide, or ask the user; never answer it blind.
  - **A timeout re-arms; it does not resend.** A timed-out wait proves nothing about delivery.
    Check `herdr --session mdpro agent get`, then re-arm `watch-agent.sh` if the agent is `working`.
  - **One wait per dispatched agent.** A polling loop over `herdr agent list` is only a stopgap
    for agents dispatched before the delegator restarted.
  - `notify-settled.sh` shows one Herdr notification for every settled agent. The delegator still
    reads the report and decides whether a `blocked` state needs a user ruling.
  - A Claude-powered delegator uses the original background Bash completion.
    `notify-settled.sh` returns the result to that command without a second
    Herdr prompt or routine notification. It still reads the report on wake.
- **The guard.** `role-guard.sh` does not run for Codex. In its place:
  - [AGENTS.md § Every session (Codex)](../../../../AGENTS.md#every-session-codex), which names the read set and each role's files;
  - the shared `.codex/rules/mdpro.rules`, which forbids push, blanket staging, branch and worktree deletion,
    checking out `master`, and PR actions;
  - the gitignored per-worktree `.codex/rules/mdpro-role.rules`, installed by `install-role.mjs` for the
    implementor, auditor, or delegator role.

  The delegator installs the overlay before starting a Codex pane and checks it after a rebase.
  The prefix rules are a backstop only: `git -C <dir> push` slips past them.

## Restart

<!-- moved-from: rule 71 § Codex agents (ADR-0147) -->
- **Restart, and every reset, is a new pane** ([ADR-0133](../../../../docs/adr/0133-a-third-codex-implementor-takes-low-tier-items-and-every-codex-agent-runs-with-a-context-cap.md)
  decision 4). A Codex conversation does not survive a restart or a move to another worktree, and
  Codex writes only inside its start directory. herdr names are unique among live agents, so the
  old pane closes **before** the new start:
  1. confirm the agent is `idle` or `done` (`herdr agent get`);
  1a. `reset-codex.sh` runs `install-role.mjs --role implementor|auditor` before `herdr agent start`; a pane whose overlay is missing is not started;
  2. `herdr pane split <old> --direction down --cwd <worktree> --no-focus`, adding `--env
     MDPRO_ROLE=implementor` for an implementor;
  3. `herdr pane close <old>`, which releases the name;
  4. `herdr agent start <name> --kind codex --pane <new> -- -m <model> [-s danger-full-access] -c
     model_reasoning_effort=<effort> -c model_auto_compact_token_limit=250000`; implementors carry
     `-s danger-full-access`, gpt-auditor does not (ADR-0134 decision 4). On
     `agent_pane_busy`, the new shell is not ready yet: wait a few seconds and retry;
  5. **the reset counts** when the `agent_started` result's `argv` shows those flags and the status
     line reads `<model> <effort> · Context 0% used` before the prompt. Otherwise it is void and
     repeated;
  6. the first prompt points at the brief or the request file.
- **Challenge and confirm with gpt-auditor.** Every request, these included, follows
  [landing-and-audit.md § Requests](landing-and-audit.md#requests): a new-pane reset, then a prompt pointing at a self-contained request file. Nothing relies
  on the pane's thread.
