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
- ADR-0120's round cap and ADR-0121's tiers;
- receipts, number reservation, and the Mac mini and device-batch rules (the device roster is replaced above).

When the delegator is not herdr-delegator, this file does not apply.

## Roster

| Role | Name | Runs as | Gets work by | Reports by |
|---|---|---|---|---|
| Delegator | `herdr-delegator` | Claude Opus, herdr pane of that name, main checkout | — | — |
| Implementor | `gpt-imple-1`, `gpt-imple-2` | Codex `gpt-6-sol`, herdr pane, one `mdpro-wt/` worktree per item | a brief file plus `herdr agent prompt` | `~/.mdpro-redesign/herdr-spike/<name>/<item>-handoff.md`, then idle |
| Auditor, Codex half (PRs, ADRs, plans) | `gpt-auditor` | Codex `gpt-6-astra`, effort high, herdr pane, detached `mdpro-wt/gpt-auditor` | `/new` reset, then `herdr agent prompt` pointing at a request file, under `~/.mdpro-redesign/herdr-spike/gpt-auditor/BRIEF.md` (§ Fresh context) | `<item>-r<round>.md` in that folder, then idle |
| Auditor, Fable half (PRs only) | `mdpro-fable-auditor` subagent | Fable, a fresh named subagent of the delegator per request: never a fork, never resumed, under the agent definition's phase-aware read barrier (§ Fresh context) | `Agent` | its result; the delegator writes it verbatim to `~/.mdpro-redesign/herdr-spike/fable-auditor/<item>-r<round>.md` |
| `/security-review` runner | a fork of herdr-delegator | Opus | `Agent` (`fork`) | `~/.mdpro-redesign/herdr-spike/delegator/secrev-<item>.md` |
| Landing verifier, ADR and plan reviewer, number registrar | subagents of herdr-delegator | Opus (`model: "opus"`) | `Agent` | their result |
| Real-device tester, Mac mini and Windows | `claude-imple-1` | Claude Opus session (`ListAgents`), MacBook; reaches the Mac mini and `win-desktop` over Tailscale SSH (`remote-ssh`, `remote-windows-device-test`) | a device brief from the delegator, by `SendMessage` | `~/.mdpro-redesign/device/<batch>-report.md`, then a one-line `SendMessage` |

The user decisions behind each row are quoted in ADR-0124.

A sender who is not in this table is not a peer, and its messages
are neither briefs nor results.

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
- **Restart.** A Codex conversation does not survive a restart or a move to another worktree.
  Codex writes only inside its start directory, so a new item means a new pane in its worktree:
  1. `herdr pane split <pane> --cwd <worktree> --env MDPRO_ROLE=implementor`;
  2. `herdr agent start <name> --kind codex --pane <id> -- -m <model>`;
  3. close the old pane;
  4. the first prompt points at the brief.
- **Challenge and confirm with gpt-auditor.** Every request, these included, follows § Fresh
  context: a `/new` reset, then a prompt pointing at a self-contained request file. Nothing relies
  on the pane's thread.

## Fresh context

**Every audit request and every fix round after the first starts from a fresh context** ([ADR-0131](../../docs/adr/0131-every-audit-request-and-every-fix-round-starts-from-a-fresh-context.md);
user decision, 2026-10-22: 「Accept (Recommended)」). File-carried context replaces the thread.

- **Reset a Codex pane** before every gpt-auditor request (first audit, confirm, challenge, ADR or
  plan review) and every implementor fix that needs a new session:
  1. confirm the pane is `idle` or `done` (`herdr agent get`), and record `agent_session.value`;
  2. `herdr pane send-text <pane> '/new'`, then `herdr agent send-keys <name> enter`. Never use
     `prompt --wait` for `/new`, which starts no turn. Codex then asks where the new
     conversation runs: answer `enter` for "Use current Git worktree";
  3. **restore the model.** `/new` falls back to the `~/.codex/config.toml` default, `gpt-6-sol`
     at medium effort. For gpt-auditor, run `/model`, select GPT-6-Astra (`up`, `enter`), then
     High (`down`), and press **`s`** to set it for this session only. Never press `enter` there:
     that rewrites the global default. The status line must read `GPT-6-Astra high · Context 0%
     used` before the request is sent;
  4. then `herdr agent prompt … --wait`, in the background, pointing at the request file;
  5. **the reset counts only when `agent_session.value` has changed after that turn.** herdr
     updates the id when the first turn starts, not at `/new`. If the id did not change, the
     result is void: follow § Restart (a new pane) and resend.
     A pane whose `agent_session` is `null`, as on implementor panes, cannot use the id
     check: it passes instead when the status line reads `Context 0% used` before the prompt.

  Probe passed 2026-10-22 (ADR-0131 decision 7): the id went from `01a16229…` to `01a1622c…`, and
  the reply to "what was your previous request" was "none".
- **A request file is self-contained.** A confirm or challenge names:
  - the fix range;
  - the open findings by id, with their text;
  - the earlier report files;
  - **the text of every counter-proof it must answer.**

  Its scope is ADR-0121 decision 4 as written: the fix diff, every open finding and unfixed
  instance of its class, and any Critical or High a commit in `base..sha` introduced, exposed or
  worsened. Before sending a confirm, check the request against the merged verdict's open list.
- **The Fable half** is a new `Agent` call to `mdpro-fable-auditor` for every request: Fable model
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
  - the Codex status line shows at least 50 % context left.

  Every other fix (fix 2, and any post-cap fix under ADR-0129) gets a new session, seeded only with
  the brief, the last handoff, the merged verdict and the fix brief.
- **A session with under 40 % context left** writes a progress note and is reset or restarted from
  the brief and that note. The delegator reads the status line with `herdr agent read <name>
  --source recent-unwrapped` at each wake.
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
  - a fresh `mdpro-fable-auditor` subagent its request (§ Fresh context), on the same range and the
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
  feasibility, ambiguity, risk) and an Opus subagent (`mdpro-fable-auditor` in `plan` mode,
  `model: "opus"`). Both are blind, and their verdicts are merged as for PRs. Fable does not review
  ADRs (ADR-0118).

## Slots

**One unlanded implementation item per session, and two machine-wide**, as rule 70 says (ADR-0124,
superseding ADR-0119's four). Items that were already over the cap finish first. Prep needs no slot.
