# 71 - herdr Mixed-Model Roster

**When the delegator is herdr-delegator, this rule replaces the rule 70 clauses it names below,
and every other rule 70 clause still binds**
([ADR-0124](../../docs/adr/0124-two-implementation-slots-and-a-herdr-mixed-model-roster-overlays-rule-70.md)).

Replaced here:
- the roster, the device roles included;
- how Codex agents get work and report;
- their guard;
- who runs each half of an audit and `/security-review`;
- who posts round-one reports: here the delegator posts both, where rule 70 has the Codex
  auditor post its own.

Added here, for Codex implementors:
- the brief;
- the attacked test matrix;
- the self-acceptance table;
- `$mdpro-tdd-workflow`, the skill that runs them.

Unchanged from rule 70:
- the slot cap, which is two everywhere (ADR-0124);
- landing (the three conditions, `--ff-only`, push);
- the merge of two verdicts and its challenges;
- ADR-0121's tiers; the round cap is now **two rounds, with gpt-auditor and opus-auditor both on every audit**, after which an open Critical or High goes to the user ([ADR-0143](../../docs/adr/0143-every-audit-runs-gpt-auditor-and-opus-auditor-together-capped-at-two-rounds.md), superseding ADR-0120's three rounds and folding in ADR-0142; user, 2026-10-25: 「audit now has gpt-auditor + opus-auditor at the same time, audit cap is two」). Where this file elsewhere calls opus-auditor optional or gpt-auditor the sole required auditor, ADR-0143 wins;
- receipts, number reservation, and the Mac mini and device-batch rules (the device roster is replaced above).

When the delegator is not herdr-delegator, this file does not apply.

## Roster

| Role | Name | Runs as | Gets work by | Reports by |
|---|---|---|---|---|
| Delegator | `herdr-delegator` | Claude Opus, herdr pane of that name in session `mdpro`, Mac mini main checkout (ADR-0134) | — | — |
| Implementor | `gpt-imple-1`, `gpt-imple-2` | Codex `gpt-6-sol` medium, `-s danger-full-access`, herdr pane, persistent worktree `mdpro-wt/<name>` (ADR-0134) | a brief file plus `herdr agent prompt` | `~/.mdpro-redesign/herdr-spike/<name>/<item>-handoff.md`, then idle |
| Implementor, Low tier (ADR-0133) | `gpt-imple-3` | Codex `gpt-5.6-sol` medium, `-s danger-full-access`, herdr pane, persistent worktree `mdpro-wt/gpt-imple-3`; Low-tier items (ADR-0121) and prep only | a brief file plus `herdr agent prompt` | `~/.mdpro-redesign/herdr-spike/gpt-imple-3/<item>-handoff.md`, then idle |
| Implementor, Claude (2026-10-25) | `opus-imple-1` | Claude Code on Opus (`--model opus --dangerously-skip-permissions`, `MDPRO_ROLE=implementor`, so `role-guard.sh` applies), herdr pane; takes over the worktree of the item it is given (D319: `mdpro-wt/gpt-imple-1`), then D317. User: 「Hand D319 and D317 to Claude implementors, create a new pane powered by Opus, opus-imple-1」, while Codex usage is exhausted | a brief file plus `herdr agent prompt` | `~/.mdpro-redesign/herdr-spike/opus-imple-1/<item>-handoff.md`, then idle |
| Auditor, Codex half (PRs, ADRs, plans) | `gpt-auditor` | Codex `gpt-6-sol`, effort medium (user decision, 2026-10-23: 「update gpt-auditor's model to `GPT-6-Sol medium`, from now on」; `gpt-6-astra` high before), herdr pane, detached `mdpro-wt/gpt-auditor` | a new-pane reset (§ Restart), then `herdr agent prompt` pointing at a request file, under `~/.mdpro-redesign/herdr-spike/gpt-auditor/BRIEF.md` (§ Fresh context) | `<item>-r<round>.md` in that folder, then idle |
| Auditor, second half (PRs, ADRs, plans) | `opus-auditor` | Claude Code on Opus (`--model opus --dangerously-skip-permissions`, `MDPRO_ROLE=real-device-tester`), herdr pane, detached `mdpro-wt/opus-auditor` ([ADR-0137](../../docs/adr/0137-the-second-auditor-runs-on-opus-as-the-opus-auditor-pane.md)) | a new-pane reset per request, then `herdr agent prompt` pointing at a request file, under `~/.mdpro-redesign/herdr-spike/opus-auditor/BRIEF.md` and the `mdpro-fable-auditor` protocol | `<item>-r<round>.md` in that folder, then idle |
| `/security-review` runner | a fork of herdr-delegator | Opus | `Agent` (`fork`) | `~/.mdpro-redesign/herdr-spike/delegator/secrev-<item>.md` |
| Landing verifier, ADR and plan reviewer, number registrar | subagents of herdr-delegator | Opus (`model: "opus"`) | `Agent` | their result |
| Real-device tester, Mac mini and Windows | `mac-test` (tmux `dtrack`) | Claude session on the Mac mini (`ListAgents`); Windows through `remote-windows-device-test` once the mini has an SSH key on `win-desktop` (ADR-0134 decision 6) | a device brief from the delegator, by `SendMessage` | `~/.mdpro-redesign/device/<batch>-report.md`, then a one-line `SendMessage` |

The user decisions behind each row are quoted in ADR-0124.

**Device checks move to `gpt-imple-3`** (user decision, 2026-10-23: 「已经完成还未device test的，交给 gpt-imple-3 进行device test，之后写测试报告」). It drives mdpro through Codex Computer Use from its herdr pane, from a device brief file under `~/.mdpro-redesign/device/`, and writes `<batch>-report.md` there. Every launch is by the verify bundle's full path, checked by process path and `app.ready` `releaseId` before any step (the first B1 run tested a v0.3.5 release launched by bundle id and was voided). § Device rules of rule 70 and ADR-0134 decision 6 (the desktop lock, the user's word that picsee runs no GUI) still bind.

**The delegator may message `picsee-delegator` directly about the shared heavy lock** (user decision, 2026-10-23: 「picsee delegator 可以直接 message @picsee-delegator ，你们直接沟通协商处理好heavy lock的事情」), by `SendMessage`, for heavy-lock coordination only (ADR-0135, D312). Nothing is sent to picsee's other sessions.

**While Codex usage is exhausted, GUI batches go to `opus-auditor`** (user decision, 2026-10-25: 「hand the batch to opus-auditor」). The delegator starts a fresh opus-auditor pane with `MDPRO_ROLE=real-device-tester` and `MDPRO_REPORT_DIR` set to the batch's device folder, gives it the device brief through herdr, and reads its report there. The same tester role, desktop lock, launch-by-path and device rules apply. When Codex usage returns, batches go back to the Codex tester.

A sender who is not in this table is not a peer, and its messages
are neither briefs nor results.

**Superseded 2026-10-23 by ADR-0134 decision 6** (user: 「dtrack 已经在mini上，直接 message @mac-test 即可」): the
delegator briefs `mac-test` directly, its hooks go to `127.0.0.1:8787` on the mini, verify builds come from
`origin`, and every mdpro GUI batch first holds `$HOME/.cache/desktop-gui.lock` and, until picsee takes the same
lock, the user's word that picsee starts no GUI run until it is released (「You hold picsee off per run
(Recommended)」). The two paragraphs below are kept as the 2026-10-20 record.

**Device checks on both machines go to claude-imple-1** (user decision, 2026-10-20: 「Windows 和mac
mini real device test的工作都交给 @claude-imple-1 ，更新rule 71」). It takes the real-device tester's
work and the device harness's verification runs, from device briefs. Rule 70's § The Mac mini and
§ Device-check batches still bind it:
- one GUI run at a time;
- builds only in a `verify-<sha7>` worktree on the mini, never in the mini's main checkout;
- `rsync`, not `scp`, and never `StrictHostKeyChecking=no`;
- the MCP and hook tokens are never printed;
- every item states its failure condition and the log line proving its path was reached.

**On the Mac mini, claude-imple-1 drives dtrack** (user decision, 2026-10-20: 「claude-imple-1
drives dtrack (Recommended)」). SSH sessions have no Screen Recording or Accessibility grant, so
dtrack, on the mini's console, runs the GUI steps. claude-imple-1 sends each brief following rule 70
§ The Mac mini:
- `capture-pane` once before sending;
- `/clear` before each brief;
- `wait-dtrack.sh` for the hook event, not screen polling;
- the session-scoped mdpro grant only.

dtrack writes the report, and claude-imple-1 checks it against the cards before reporting to the
delegator. A verify ref reaches the mini because the delegator pushes it to the `mac-mini` remote
(`git push mac-mini <sha>:refs/verify/<sha>`); the mini has no GitHub access.

It writes reports, never commits, and does not develop the ADR-0047 harness itself. That tooling
work waits for a device-harness session.

When a role is offline, the work that needs it waits; nobody stands in for it. The rule 70
device-harness session has been gone since the 2026-10-18 reboot.
To bring a role back, the delegator asks the user to restart it from its handoff, and records the
alias here.

## Codex agents

- **No `SendMessage`, and not in `ListAgents`.**
  - The delegator reads their files and watches `herdr agent list`.
  - The test of rule 70's "delegator present" is `herdr agent list` showing `herdr-delegator`.
- **The delegator is woken when a Codex agent settles; it does not poll** (user question,
  2026-10-20: 「如何enabl panes auto-notify，最佳实践是什么，相关实践要写入rule 71」). herdr pushes
  nothing to another session. Its Codex integration (`herdr integration status` shows `codex:
  current`) only reports the agent's session, so herdr can classify the pane as `working`, `idle`,
  `blocked` or `done`. The wake-up therefore comes from a background command that exits when the
  agent's state changes:
  - **Every prompt to a Codex agent runs in the background with `--wait`**:
    `herdr agent prompt <name> '<text>' --wait --timeout 7200000`, as a `run_in_background` Bash
    call. Its exit re-invokes the delegator. Use single quotes, because backticks in double quotes
    run in the delegator's shell.
  - **Never arm a bare `herdr agent wait` right after a prompt.** Without `--until`, it returns at
    once if the agent is still `idle`, which it is until the turn starts. Only `prompt --wait`
    first requires observed activity (`agent_prompt_stalled` otherwise). Use a bare `agent wait
    <name>` only for an agent that `herdr agent list` already shows as `working`. That covers
    re-arming after a restart of the delegator.
  - **On wake, the state is not the result.** A settled agent may have stopped mid-task: an output
    limit stalled gpt-imple-2 for two days (2026-10-18). Read the expected report file. If it is
    missing, read the pane (`herdr agent read <name> --source recent-unwrapped --lines 80`). On
    `blocked`, read the dialog and decide, or ask the user; never answer it blind.
  - **A timeout re-arms; it does not resend.** A timed-out wait proves nothing about delivery.
    Check `herdr agent get`, then arm a bare `agent wait` if the agent is `working`.
  - **One wait per dispatched agent.** A polling loop over `herdr agent list` is only a stopgap
    for agents dispatched before the delegator restarted.
  - The user sees the same completions as herdr's Done badge. `herdr notification show` is only
    for something the user must act on, such as a `blocked` agent or a ruling.
- **The guard.** `role-guard.sh` does not run for Codex. In its place:
  - `AGENTS.md` § "Read first (Codex)", which lists this rule;
  - `.codex/rules/mdpro.rules`, which forbids push, blanket staging, branch and worktree deletion,
    checking out `master`, and PR actions.

  The delegator copies both into every worktree it creates for a Codex agent, uncommitted, and
  checks they are there after a rebase. The prefix rules are a backstop only: `git -C <dir> push`
  slips past them.
- **Receipts are recorded, as for any implementor (rule 10).** Frontend REDs use
  the repository entry script, unlocked with at most 2 workers:

  ```
  node scripts/tdd/red-receipt.mjs record --id <ID> --test tests/<file>.test.ts
  node scripts/tdd/red-receipt.mjs verify --id <ID>
  ```

  Rust REDs still use `receipt.js record/verify --lane rust` under
  `scripts/heavy-lock.sh`, after `cargo fmt`. The full frontend coverage lane
  also keeps the heavy lock.
  **Record the red before the production change it tests.** A receipt that carries
  `implementation-already-present` is named in the handoff (M3a, 2026-10-20).
- **Restart, and every reset, is a new pane** ([ADR-0133](../../docs/adr/0133-a-third-codex-implementor-takes-low-tier-items-and-every-codex-agent-runs-with-a-context-cap.md)
  decision 4). A Codex conversation does not survive a restart or a move to another worktree, and
  Codex writes only inside its start directory. herdr names are unique among live agents, so the
  old pane closes **before** the new start:
  1. confirm the agent is `idle` or `done` (`herdr agent get`);
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

  Models: implementors `gpt-6-sol`, and `gpt-6-luna` on `routine` items (ADR-0139; user 「接受 (Recommended)」); gpt-imple-3
  `gpt-5.6-sol` on its non-routine items; gpt-auditor `gpt-6-sol` (since 2026-10-23;
  `gpt-6-astra` high before). **Effort follows the item's difficulty** ([ADR-0138](../../docs/adr/0138-effort-follows-task-difficulty-and-audits-read-from-the-diff-outward.md);
  user, 2026-10-23: 「effort 要根据任务难度来route」, accepted 「接受 (Recommended)」). Every brief and request names
  `routine`, `standard` or `hard` (the hardest match wins, unlisted is `standard`, ADR-0121 High-by-behaviour is at
  least `standard`, a test-only change takes its invariant's difficulty; raise only, never lower; a raise is a new pane):

  | Role | routine | standard | hard |
  |---|---|---|---|
  | Implementor | `gpt-6-luna` high, every implementor ([ADR-0139](../../docs/adr/0139-routine-implementor-items-run-on-gpt-6-luna-high-as-a-pilot.md), pilot) | medium | high |
  | gpt-auditor, any request | medium | medium | high |
  | gpt-auditor confirm or challenge touching a `hard` path, or after a round that found a new High | high | high | high |
  | `mdpro-spec-adversary` (every grant) | `mdpro-spec-adversary-std` (`gpt-6-sol` medium) | same | `mdpro-spec-adversary` (`gpt-6-astra` high) |

  The pilot (ADR-0138 decision 5) runs to the second High-tier PR's landing; from the next brief on, dispatch reverts to
  medium everywhere, the Astra adversary and full-file reading, until the user rules. `~/.codex/config.toml` is never edited for this. The new pane id goes into
  the heartbeat assignment.
- **Challenge and confirm with gpt-auditor.** Every request, these included, follows § Fresh
  context: a new-pane reset, then a prompt pointing at a self-contained request file. Nothing relies
  on the pane's thread.

## Fresh context

**Every audit request and every fix round after the first starts from a fresh context** ([ADR-0131](../../docs/adr/0131-every-audit-request-and-every-fix-round-starts-from-a-fresh-context.md);
user decision, 2026-10-22: 「Accept (Recommended)」). File-carried context replaces the thread.

- **Reset a Codex pane** before every gpt-auditor request (first audit, confirm, challenge, ADR or
  plan review) and every implementor fix that needs a new session, by § Restart: a new pane with
  the full launch line. The in-pane `/new` reset and its session-id check are superseded (ADR-0133
  decision 4): `/new` drops the launch flags, and herdr can report another project's session id.
- **A request file is self-contained.** A confirm or challenge names:
  - the fix range;
  - the open findings by id, with their text;
  - the earlier report files;
  - **the text of every counter-proof it must answer.**

  Its scope is ADR-0121 decision 4 as written: the fix diff, every open finding and unfixed
  instance of its class, and any Critical or High a commit in `base..sha` introduced, exposed or
  worsened. Before sending a confirm, check the request against the merged verdict's open list.
- **The second half** is `opus-auditor` (ADR-0137): a new-pane reset by § Restart for every request (`--kind claude`, Opus), then a prompt pointing at the request file. Before ADR-0137 it was a new `Agent` call to `mdpro-fable-auditor` for every request: Fable model
  for PRs, `model: "opus"` in `plan` mode. Never a fork, which would inherit the Codex verdict, and
  never resumed with `SendMessage`.
- **Read barrier, by phase, for both auditors:**

  | Phase | May read | Must not read |
  |---|---|---|
  | Round one (`audit`, `plan` round one) | the range, the brief, the handoff, `REVIEW.md` | any other auditor's verdict, PR comments, `herdr-spike/delegator/` |
  | `confirm`, `plan` confirm | the files the request names: completed earlier rounds of both auditors, the merged verdict, counter-proofs | the other auditor's current-round report |
  | `challenge` | the one challenged finding and its evidence, as quoted | anything else from the other auditor |
- **Implementor fixes** are numbered by the ADR-0120 round they answer. Fix 1, which answers the
  blind audit, stays in the item's session only when both of these hold:
  - the fix brief names one or two findings, each with its regression test;
  - the Codex status line shows at most 12 % used (half the 250k cap on the 1M window; ADR-0133
    decision 5).

  Every other fix (fix 2, and any post-cap fix under ADR-0129) gets a new session, seeded only with
  the brief, the last handoff, the merged verdict and the fix brief.
- **At any stop or handoff, a session showing 20 % or more used, or one that has compacted,**
  writes a progress note and restarts by § Restart from the brief and that note (ADR-0133
  decision 5). A session counts as compacted when its pane shows Codex's compaction notice, or when
  its used percentage has fallen since the previous wake. The delegator reads the status line with
  `herdr agent read <name> --source recent-unwrapped` at each wake.
- **Every handoff names the approaches it rejected, and why.** A fix session knows only what the
  files say.
- **The delegator** asks the user to type `/compact` at a quiet point: no landing in flight, every
  wait recorded in `heartbeat.json`. The compaction instructions keep the open findings, SHAs,
  number reservations and armed waits.
- **Cost record.** The first ten requests after 2026-10-22 record their duration and their input,
  cached and output tokens in `docs/audit/audit-log.md` § Fresh-context cost.

## Briefs and self-acceptance

**The delegator gives a Codex implementor a full brief, the implementor accepts its own work
against it, and only then does the delegator confirm.** A cross-model agent shares none of the
delegator's context. User decision, 2026-10-18: 「由于是cross model delegate tasks,
之后给implementor 布置任务，要详细交代任务背景，给出详细的验收标准，让 implementor执行完之后，自己验收合格再由你确认」.

Every grant, and every fix round, is written to
`~/.mdpro-redesign/herdr-spike/<name>/<item>-brief.md` before the prompt points at it. It has
six sections:

1. **Background.** Why the item exists: the defect or plan row, the user decisions it rests on
   (quoted), the ADRs it must not contradict, and what earlier work already landed.
2. **Scope.** The worktree, the branch and its base SHA, and the paths it may edit and create.
   Anything outside them needs a revised grant.
3. **Acceptance criteria**, numbered `AC-1…`. Each is a behaviour plus its proof:
   - the test file and case, or the command;
   - the expected decisive output;
   - for a behaviour change, the receipt id of the RED that must come first.

   The plan row's tests column is the floor, not the ceiling.
4. **Out of scope.** What this item must not do, and which later item does it.
5. **Gates.** The lanes to run before handoff, with the exact commands.
6. **Self-acceptance.** The handoff ends with an `AC | evidence | verdict` table: each AC with the
   command or test it ran, its decisive output line, and its receipt and verdict. Then come the
   lanes, the tree SHAs and the paths changed.

**A test matrix is attacked before any RED is recorded** (user decision, 2026-10-20: 「加上，
gpt-imple-1, gpt-imple-2都适用」, after the delegator found that the herdr flow skipped
`/tdd-guardian:workflow`'s design-tests and spec-adversary steps). That day all three blocking Highs
were cases nobody had tested:
- M3b H1: a submit that fails inside a table;
- D290 H1: a close while a save awaited;
- D290 H2: a deletion ignored mid-batch.

It works in four steps, all inside the implementor's run of
[`$mdpro-tdd-workflow`](../../.codex/skills/mdpro-tdd-workflow/SKILL.md)
(user decision, 2026-10-20: 「创建 .codex/skills/mdpro-tdd-workflow/，尽可能将当前 /tdd-guardian:workflow
中的迁移过去，使得这个skill self-contained, test-matrix attack 仍然由对应的Implementor 用subagent来产生」):
1. **The implementor writes the matrix.** It reads the brief and writes
   `~/.mdpro-redesign/herdr-spike/<name>/<item>-test-matrix.md`, following the skill's
   `references/test-matrix.md`. For each AC it lists the cases:
   - success;
   - boundary (empty, max, CJK);
   - invalid input;
   - lifecycle and timing: close, reopen, switch or replace during an `await`, a stale token, a
     queued or batched operation, and a second event mid-way;
   - every caller or entry path that reaches the changed behaviour;
   - platform, where it applies.

   Each case names its assertion (document, state or IPC effect, not a boolean) and its test file.
2. **The implementor has it attacked by a subagent.** It spawns the Codex custom agent
   `mdpro-spec-adversary` (`.codex/agents/mdpro-spec-adversary.toml`: `gpt-6-astra`, effort high,
   read-only, a fresh context). It gives the agent the brief, the plan, the matrix and the code
   paths, and writes the report verbatim to `<item>-attack.md`. The adversary returns:
   - each wrong implementation that would pass every case;
   - the case that would catch it.

   The implementor must not run the attack itself. If the agent can't be spawned, it writes
   `ATTACK-NOT-RUN` and stops, and the delegator has an Opus `tdd-guardian:tdd-spec-adversary` attack
   the matrix instead.
3. **The implementor amends the matrix.** It adds each gap's case, or rejects the gap in the attack
   file with a counter-proof: an existing case that kills it, or the brief's Out of scope. If it added
   cases, it re-attacks once. It stops and asks the delegator about:
   - a gap still open after round two;
   - a gap the adversary marks NEEDS RULING (it asks for more than the brief).
4. **The implementor writes the tests and records the REDs.** Only after that does it touch
   production code.

The delegator checks the attack file and the matrix when it confirms the handoff. The workflow's
other steps (plan, the per-WI receipts, the coverage self-check, the `mdpro-tdd-reviewer` subagent,
the gates and the handoff table) are in the skill.

The step applies to every grant. On a fix round it applies when the finding is a missed case,
which covers all three Highs above. A fix the brief fully specifies with its regression test can
skip it, and the fix brief says so. A grant already past its first RED when this rule took effect
writes its matrix for the ACs not yet RED, and has that matrix attacked.

An implementor does not hand off with an AC unproved unless it names that AC, says why, and says
what it needs. An AC that conflicts with another is recorded, resolved toward the plan and the
brief's background, and the work goes on. The implementor stops only for a path outside scope.

**The delegator confirms by checking the table, not by trusting it.** It re-reads the evidence
for each AC. The verifier re-runs the lanes and the receipts. The auditors are given the ACs. An
AC with no evidence, or with evidence that does not show the behaviour, sends the item back
before any audit starts.

## Audits under herdr

- **PRs.** In one turn the delegator sends:
  - gpt-auditor its request;
  - opus-auditor its request, in a fresh pane (§ Fresh context, ADR-0137), on the same range and the
    same dimensions;
  - and, on the High tier, a fork that runs `/security-review` on the range's diff, the job
    ADR-0121 gave mdpro-codex-audit.

  A `/security-review` that cannot run keeps the gate closed.
- **Round one is blind.**
  - Neither auditor posts on the PR.
  - Before its own round-one verdict, neither reads the other's `herdr-spike` folder,
    `herdr-spike/delegator/`, or any PR comment.
  - Once both are in, the delegator posts each report, then the merged verdict.
- **ADRs and plans.** gpt-auditor (the `review-plan` dimensions: consistency, completeness,
  feasibility, ambiguity, risk) and opus-auditor in `plan` mode (ADR-0137; before it, an Opus `mdpro-fable-auditor` subagent,
  `model: "opus"`). Both are blind, and their verdicts are merged as for PRs. Fable does not review
  ADRs (ADR-0118).

## Slots

**One unlanded implementation item per session, and two machine-wide**, as rule 70 says (ADR-0124,
superseding ADR-0119's four). Items that were already over the cap finish first. Prep needs no slot.

**Plus one Low-tier slot, held by gpt-imple-3 only** ([ADR-0133](../../docs/adr/0133-a-third-codex-implementor-takes-low-tier-items-and-every-codex-agent-runs-with-a-context-cap.md)
decision 2; user decision, 2026-10-22: 「3rd slot, Low tier only (Recommended)」):
- **Its scope.** The delegator states the ADR-0121 tier in every grant to gpt-imple-3. A Low-tier
  item granted to gpt-imple-1 or gpt-imple-2 uses a general slot.
- **A higher-tier path found mid-item.** The item stops with `<item>-blocked.md` and keeps the slot
  until it is handed to a general slot. Its worktree, branch and receipts move with it.
- **A tier an auditor raises.** The item finishes in place, as over the cap, and gpt-imple-3 takes
  no new item until it lands.
