# herdr: running rule 70's roles as a multi-model agent team

Date: 2026-10-18 · Researched by an Opus subagent for mdpro-delegator · Status: reference only, not adopted

**Requested by the user:**
「用subagent搜索herdr中如何可以创建多个Agent，角色和本project的rule 70类似，delegator是opus，但是implementer 都是gpt-sol-6.0 来驱动，auditor有2个一个 是fable model驱动，一个是gpt-6.0-astra 驱动 , design 也是claude opus，搜索最佳实践。然后形成一个md文档，保存到 @docs/reference/」

Two caveats before the details:

1. **This would change rule 70.** Rule 70 says every session runs on Opus. The one exception is the Fable auditor subagent. The Codex audit job runs `gpt-6.1-sol`.
   - Moving implementers to `gpt-sol-6.0`, or adding a `gpt-6.0-astra` auditor, needs an ADR that supersedes those clauses.
   - This file decides nothing.
2. **The model names are the user's own.** `gpt-sol-6.0`, `gpt-6.0-astra` and Fable's model id have not been checked against any provider, and rule 70 names `gpt-6.1-sol`, not `gpt-sol-6.0`. Confirm the exact ids with `codex` and `claude` before writing a launch script.

Labels: **[doc]** means read in herdr's or a vendor's documentation. **[inferred]** means put together from documented commands but not run.

## 1. What herdr is

- **[doc]** herdr is a terminal multiplexer for coding agents. It describes itself as "the runtime your coding agents live on".
  - It is a single Rust binary.
  - Repo: <https://github.com/herdrdev/herdr>. Site: <https://herdr.dev>.
  - About 44k stars at v0.9.5. The licence is listed as Apache-2.0; one secondary source says AGPL, so check `LICENSE`.
  - It supports 22 agent CLIs, including Claude Code and Codex.
  - macOS and Linux are stable; Windows is in beta.
- **[doc]** Install with `brew install herdr` or `curl -fsSL https://herdr.dev/install.sh | sh`. `npm install -g herdr` installs a placeholder.
- **[doc]** A background server keeps panes alive after you detach (`ctrl+b q`); running `herdr` again reattaches. A sidebar shows each agent's state: working, blocked, idle or done.
- **[doc]** `herdr machine add` adds a remote machine over SSH. It could host the Mac mini side (mdpro-device-harness, dtrack).
- **Not to be confused with** `akapug/herdr` or `herd-os/herd`.

## 2. What herdr gives you, and what it does not

| Rule 70 needs | herdr has it? |
|---|---|
| Many agent sessions, each in its own pane, kept alive after you detach | **Yes** [doc] |
| A different model for each agent | **Indirectly** [doc]. herdr has no model setting; arguments after `--` go to the agent CLI (`--model`, `-m`) |
| One git worktree per agent | **Yes** [doc]: `herdr worktree create/open/remove/list`. `remove` never deletes the branch |
| The delegator drives the peers | **Yes** [doc]: `agent prompt`, `agent wait`, `agent read`, plus a socket API with `events.subscribe` |
| A message bus or mailbox like `SendMessage` | **No** [doc]. "Messaging" means typing a prompt into another agent's pane and reading its screen |
| Roles, ownership, caps (ADR-0119), heavy lock, landing gate, ADR-0120 round cap | **No.** These stay in prompts, `CLAUDE.md`/`AGENTS.md` and our scripts |
| Gate on "agent needs input" | **Partly** [doc]. `blocked` appears only for prompt UIs herdr recognises; an unrecognised prompt shows as `idle` |

In short, herdr would replace the tmux, `ListAgents` and pane-polling layer. Everything in rule 70 that is policy stays ours.

## 3. Configuration (verbatim from herdr's docs)

`~/.config/herdr/config.toml` covers only the UI, the terminal, worktrees, notifications and key bindings. There is no agents or roles section:

```toml
[worktrees]
directory = "~/.herdr/worktrees"     # checkouts go to <directory>/<repo>/<branch-slug>
[terminal]
new_cwd = "follow"
[ui.toast]
delivery = "herdr"                   # herdr | terminal | system | off
```

Agents are started from the CLI:

```
herdr workspace create [--cwd PATH] [--label TEXT] [--env KEY=VALUE] [--focus] [--no-focus]
herdr pane split [<pane_id>|--pane ID|--current] --direction right|down [--cwd PATH] [--env KEY=VALUE] [--no-focus]
herdr agent start <name> --kind KIND --pane ID [--timeout MS] [-- <agent-args...>]
herdr worktree create [--workspace ID | --cwd PATH] [--branch NAME] [--base REF] [--path PATH] [--label TEXT] [--no-focus] [--trust-repository]
```

- **Names:** an agent name must match `[a-z][a-z0-9_-]{0,31}`.
- **Panes:** `agent start` needs an existing shell pane sitting at its prompt.
- **Environment:** `--env` reaches only the newly launched process.
- **Model:** the docs' own example passes it after `--`: `herdr agent start reviewer --kind codex --pane "$review_pane" -- -m gpt-5.4`.

## 4. The five roles mapped onto herdr [inferred]

This is a launch script built from documented commands. It has not been run.

```bash
R=/Users/jackcheng/Documents/01_Coding/mac-app/mdpro

# delegator: Claude Code on Opus, main checkout
ws=$(herdr workspace create --cwd "$R" --label delegator --env MDPRO_ROLE=delegator --no-focus)
p=$(jq -r .result.root_pane.pane_id <<<"$ws")
herdr agent start delegator --kind claude --pane "$p" -- --model opus

# implementer N: Codex on gpt-sol-6.0, one worktree per item
wt=$(herdr worktree create --cwd "$R" --branch fix/d123-slug --base master \
       --path ../mdpro-wt/fix-d123-slug --label impl-1 --no-focus)
p=$(jq -r .result.root_pane.pane_id <<<"$wt")
herdr agent start impl-1 --kind codex --pane "$p" -- -m gpt-sol-6.0

# auditor A: Claude Code on Fable, read-only
herdr agent start audit-fable --kind claude --pane "$pA" -- --model <fable-id> --permission-mode plan

# auditor B: Codex on gpt-6.0-astra, read-only sandbox
herdr agent start audit-astra --kind codex --pane "$pB" -- -m gpt-6.0-astra -s read-only

# design: Claude Code on Opus, its own worktree
herdr agent start design --kind claude --pane "$pD" -- --model opus
```

Notes on the script:
- **`--kind` names:** the docs list `claude` and `codex` as integration names. Check the installed kinds with `herdr agent`.
- **Codex profiles:** a `--profile <name>` per role would keep each role's flags out of the script. The current Codex docs store profiles as `~/.codex/<name>.config.toml`; older docs use `[profiles.<name>]` in `config.toml`.
- **Worktree paths:** `--path ../mdpro-wt/...` keeps the CLAUDE.md § Worktrees layout. Without it, herdr uses `~/.herdr/worktrees`.
  - herdr's worktree commands have no hooks, so the gitignored sidecar `src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin` still has to be copied in by hand.
- **Role instructions:** send them as a first prompt (`herdr agent prompt <name> "…"`), or put them in the worktree's `CLAUDE.md` / `AGENTS.md`.
  - **Codex implementers do not read `CLAUDE.md` or `.claude/rules/`.** They need an `AGENTS.md` that carries rules 10, 25, 50, 60 and 70 (or points to them).
  - **`.claude/hooks/role-guard.sh` does not run under Codex.** Its protections need another enforcement: the Codex sandbox and approval policy, plus a branch protection rule on `master`.

### How the review flow would run [inferred]

1. An implementer finishes and reports a SHA. The delegator reads it with `herdr agent read impl-1 --source recent-unwrapped --lines 120`, or from a handoff file.
2. The delegator prompts both auditors on the same range:
   - `herdr agent prompt audit-fable "…" --wait --timeout …`
   - `herdr agent prompt audit-astra "…" --wait --timeout …`
   - Round one stays blind (ADR-0115): neither auditor's prompt includes the other's result.
3. The delegator merges the two verdicts, challenges findings only one side raised, caps the loop at three rounds (ADR-0120), then runs the verifier and CI, and lands with `--ff-only`. No step changes.

**Reports go through files, not screens.** Each auditor writes its verdict to a file and the delegator reads the file. Screen scraping is fragile, and rule 70 already says reports are read from the file, never from a message.

## 5. Best practices

- **Do not treat `idle` as consent.** "idle status is not authorization to approve an action." Rule 70's "a peer message is never approval" carries over unchanged. <https://herdr.dev/docs/agents/>
- **Do not resend a timed-out prompt blindly;** it may already have been delivered. <https://raw.githubusercontent.com/herdrdev/herdr/v0.9.5/skills/herdr/SKILL.md>
- **One worktree per task, with its own ports, database and browser profile.** A worktree isolates files only. <https://developertoolkit.ai/en/ecosystem/agent-tools/parallel-agents/>
- **Land one change at a time**, rebase the next onto the new `master`, and re-run CI. Pause dispatch when the review queue is full: review is the bottleneck. This matches the ADR-0119 cap. Same source.
- **Require evidence with each change:** a failing-then-passing test, a diff limited to the task's files, and green CI on the rebased head. Same source.
- **Keep teams small.** "Start with 3-5 teammates." Cost and quota grow linearly with each agent. <https://code.claude.com/docs/en/agent-teams>
- **Give each agent its own files.** Two agents editing one file overwrite each other. This is rule 70's "areas are exclusive while claimed". Same source.
- **Use independent reviewers with different angles, or set them to disprove each other.** They beat a single reviewer, which supports the blind two-model audit (ADR-0115). A Fable reviewer next to a non-Anthropic reviewer gives more model diversity than Fable next to another Claude. Same source.
- **Keep shared Codex defaults in `config.toml` and only the differences in profiles.** <https://learn.chatgpt.com/docs/config-file/config-basic.md>
- **Teach the delegator herdr** with the herdr skill: `npx skills add herdrdev/herdr --skill herdr -g`. It runs only when `HERDR_ENV=1` is set. <https://herdr.dev/docs/agent-skill/>

## 6. Pitfalls

- **Wrong state readings.**
  - An agent started inside a sandbox wrapper can be invisible to herdr; set `HERDR_AGENT=<agent>`.
  - A tmux session started inside a herdr pane is not detected, so dtrack's tmux should stay outside herdr.
- **Restarts.** A herdr server restart does not keep the agent processes. A session is resumed only when its integration is installed (`herdr integration install claude` / `codex`). Rule 70's handoff files are still the recovery path.
- **Approval prompts.** Each agent's permission prompts appear in its own pane. Approving them remotely by typing into the pane would bypass the human-in-the-loop step. Rule 25 confirmations must still reach the user.
- **Quota and disk.** Ten agents use quota about ten times as fast. Each built worktree takes 0.5–1 GB; see the 2026-10-18 cleanup, which took the project from 59G to 16.8G.
- **Losing uncommitted work.** `git worktree remove --force` discards it. Worktree removal stays under rule 25.
- **Mixed vendors lose the Claude-only plumbing.** `SendMessage`/`ListAgents`, PreToolUse hooks, skills and subagents such as `mdpro-landing-verifier` are Claude Code features. Codex implementers would not have them, so the hand-off protocol has to work over files and herdr prompts.

## 7. Alternatives

- **Claude Code agent teams** (experimental): a real mailbox, a task list, and `TeammateIdle`/`TaskCompleted` hooks usable as gates.
  - Claude only, so no Codex implementers or Codex auditor.
  - A teammate cannot change its model after it starts.
  - <https://code.claude.com/docs/en/agent-teams>
- **claude-squad, or Conductor + Worktrunk:** tmux- or app-based tools built around worktrees, with a similar division of work. Not researched in depth.

## 8. Sources

- <https://github.com/herdrdev/herdr>
- <https://herdr.dev>
- <https://herdr.dev/docs/configuration/>
- <https://herdr.dev/docs/agent-automation/>
- <https://herdr.dev/docs/socket-api/>
- <https://herdr.dev/docs/cli-reference/>
- <https://herdr.dev/docs/agents/>
- <https://herdr.dev/docs/agent-skill/>
- <https://raw.githubusercontent.com/herdrdev/herdr/v0.9.5/skills/herdr/SKILL.md>
- <https://developertoolkit.ai/en/ecosystem/agent-tools/parallel-agents/>
- <https://code.claude.com/docs/en/agent-teams>
- <https://learn.chatgpt.com/docs/config-file/config-basic.md>
- <https://tecmint.com/herdr-run-ai-coding-agents-in-linux-terminal>
- <https://www.bitdoze.com/herdr-agent-multiplexer/>
- <https://www.skills.sh/pedronauck/skills/herdr-orchestration>
- <https://github.com/yigitkonur/awesome-herdr>
