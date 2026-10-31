# 71 - herdr Mixed-Model Roster

**When the delegator is herdr-delegator, this rule replaces the rule 70 clauses it names below,
and every other rule 70 clause still binds**
([ADR-0124](../../docs/adr/0124-two-implementation-slots-and-a-herdr-mixed-model-roster-overlays-rule-70.md)).

Replaced here:
- the roster, the device roles included;
- how Codex agents get work and report;
- their guard;
- who runs audits and the High-tier security review;
- who posts round-one reports: here the delegator posts gpt-auditor's report, where rule 70
  has the Codex auditor post its own.
- the two-auditor requirement: `gpt-auditor` is required; `opus-auditor` is optional only
  under the Claude delegator route below.

Added here, for Codex implementors:
- the brief;
- the attacked test matrix;
- the self-acceptance table;
- `$tdd-guardian:tdd-guardian-workflow`, the installed plugin skill that runs the TDD stages.

Unchanged from rule 70:
- the slot cap, which is three everywhere since 2026-10-30 (ADR-0156, superseding ADR-0124's two);
- landing (the three conditions, `--ff-only`, push);
- the audit-round cap and landing conditions, except the two-verdict merge now replaced above;
- ADR-0121's tiers; the round cap is now **two rounds, with gpt-auditor and opus-auditor both on every audit**, after which an open Critical or High goes to the user ([ADR-0143](../../docs/adr/0143-every-audit-runs-gpt-auditor-and-opus-auditor-together-capped-at-two-rounds.md), superseding ADR-0120's three rounds and folding in ADR-0142; user, 2026-10-25: 「audit now has gpt-auditor + opus-auditor at the same time, audit cap is two」). Where this file elsewhere calls opus-auditor optional or gpt-auditor the sole required auditor, ADR-0143 wins;
- **A review with zero Critical and zero High does not block** (user, 2026-10-25: 「if no c and no h, only medium exists, merge it」): when an implementor's final TDD review or an audit round finds only Medium or Low, the item commits and lands; the Medium and Low findings are recorded in the handoff, the PR and the audit-log row, not sent into another fix round. A Medium `NOT PROVED` does not license landing the AC unmet: only ADR-0146 decision 4's recorded grounds (a), (b) or (c) permit that disposition;
- receipts, number reservation, and the Mac mini and device-batch rules (the device roster is replaced above).

When the delegator is not herdr-delegator, this file does not apply.

## Delegator runtime route

The **one** herdr agent named `herdr-delegator` may run on Codex/GPT or Claude
(Opus, Fable, etc.). At the start of a turn, use
`.agents/skills/mdpro-delegator/scripts/delegator-route.sh`; it reads the agent's
Herdr runtime kind. An unknown or missing kind blocks dispatch. The implementor,
auditor and device-agent names, worktrees, briefs and landing gates stay the same.

| Runtime | Completion and coordination | Verifier, registrar, user questions |
|---|---|---|
| Codex/GPT | Keep `prompt.sh`, `watch-agent.sh` and `notify-settled.sh`: a detached wait shows a notification and prompts the idle delegator. Read reports and heartbeat on wake. | Run the deterministic verifier/registrar procedures directly; ask the user through Codex's available question channel. |
| Claude | Keep the original background Bash `herdr agent prompt --wait` / `agent wait` result, plus Claude `SendMessage` where available. The completion scripts return to that Bash call; they do **not** prompt the Claude delegator or add a routine notification. | Use the original `Agent` verifier/registrar and `AskUserQuestion`/`SendMessage` tools. |

`gpt-auditor` remains the required auditor in both routes. The user's 2026-10-24
「opus-auditor has exited, from now on, only rely on gpt-auditor」 retires Opus
for the Codex route. Under the later user direction, a Claude delegator may
add `opus-auditor` **only when the user explicitly requests it and available
Claude usage is sufficient**. The request records both facts. Its report is
an additional independent verdict, never a substitute for `gpt-auditor`; an
unavailable or unrequested Opus audit does not block landing. If it runs, the
delegator addresses its blocking Critical/High findings before landing.

## Roster

| Role | Name | Runs as | Gets work by | Reports by |
|---|---|---|---|---|
| Delegator | `herdr-delegator` | Codex/GPT or Claude (Opus/Fable/etc.), one herdr pane of that name in session `mdpro`, Mac mini main checkout (ADR-0134) | — | — |
| Implementor | `gpt-imple-1`, `gpt-imple-2` | Codex `gpt-6-sol` medium, `-s danger-full-access`, herdr pane, persistent worktree `mdpro-wt/<name>` (ADR-0134) | a brief file plus `herdr agent prompt` | `~/.mdpro-redesign/herdr-spike/<name>/<item>-handoff.md`, then idle |
| Implementor, Low tier (ADR-0133) | `gpt-imple-3` | Codex `gpt-5.6-sol` medium, `-s danger-full-access`, herdr pane, persistent worktree `mdpro-wt/gpt-imple-3`; Low-tier items (ADR-0121) and prep only | a brief file plus `herdr agent prompt` | `~/.mdpro-redesign/herdr-spike/gpt-imple-3/<item>-handoff.md`, then idle |
| Implementor, Claude (2026-10-25) | `opus-imple-1` | Claude Code on Opus (`--model opus --dangerously-skip-permissions`, `MDPRO_ROLE=implementor`, so `role-guard.sh` applies), herdr pane; takes over the worktree of the item it is given (D319: `mdpro-wt/gpt-imple-1`), then D317. User: 「Hand D319 and D317 to Claude implementors, create a new pane powered by Opus, opus-imple-1」, while Codex usage is exhausted | a brief file plus `herdr agent prompt` | `~/.mdpro-redesign/herdr-spike/opus-imple-1/<item>-handoff.md`, then idle |
| Required auditor (PRs, ADRs, plans) | `gpt-auditor` | Codex `gpt-6-sol`, effort medium (user decision, 2026-10-23: 「update gpt-auditor's model to `GPT-6-Sol medium`, from now on」; `gpt-6-astra` high before), herdr pane, detached `mdpro-wt/gpt-auditor` | a new-pane reset (§ Restart), then `herdr agent prompt` pointing at a request file, under `~/.mdpro-redesign/herdr-spike/gpt-auditor/BRIEF.md` (§ Fresh context) | `<item>-r<round>.md` in that folder, then idle |
| Optional auditor, Claude route only | `opus-auditor` | Claude, only after the user's explicit request and a sufficient usage check | a fresh request recording both conditions | its report, then idle; absent otherwise |
| High-tier security reviewer | `gpt-auditor` | Codex, in the same fresh-pane audit request | the High-tier request names security dimensions | security count in its report |
| Landing verifier | herdr-delegator on Codex; `mdpro-landing-verifier` subagent on Claude | the same lane, receipt, ancestry and tree checks | after handoff | verification record under `herdr-spike/delegator/` |
| ADR and plan reviewer | `gpt-auditor` | Codex, fresh pane | a review request | its report |
| Number registrar | herdr-delegator on Codex; `mdpro-number-registrar` subagent on Claude | read-only register check | before brief | reservation record |
| GUI tester for batches formerly assigned to dtrack, Mac mini and Windows | `gpt-auditor` | Codex herdr pane; Windows through `remote-windows-device-test` after the host-key/SSH checks | a fresh-pane device brief from the delegator | `~/.mdpro-redesign/device/<batch>-report.md`, then idle |

The user decisions behind each row are quoted in ADR-0124.

**Since 2026-10-30, `opus-imple-2` joins as a third implementor** ([ADR-0156](../../docs/adr/0156-three-implementation-slots-and-opus-imple-2-joins-the-roster.md);
user: 「create a new pane opus-imple-2 and delegate tasks to it.」, 「Raise cap to 3, all start」): Claude Code on Opus
(`--model opus --dangerously-skip-permissions`, `MDPRO_ROLE=implementor`), persistent worktree `mdpro-wt/opus-imple-2`,
briefed by file plus `herdr agent prompt`, reporting to `~/.mdpro-redesign/herdr-spike/opus-imple-2/<item>-handoff.md`.
Implementors: gpt-imple-1, opus-imple-1, opus-imple-2; gpt-imple-2 stays idle.

**Since 2026-10-31, `gpt-imple-1` is the primary implementor** (user: 「gpt-imple-1 成为主力 implementor」): the
delegator grants each new item to `gpt-imple-1` first, and to `opus-imple-1` or `opus-imple-2` only when gpt-imple-1 already
holds an unlanded item or the user names another implementor. Items already assigned keep their owner, including
#567's tickets on `opus-imple-1` (「让 opus-imple-1 实现 jack-tdd-workflow Skill 相关」). The slot cap is unchanged.

**The live roster is five agents** (user decision, 2026-10-29: 「现在降低同时并行开发的数量：同时2个implementor（gpt-imple-*)，2个auditor，加上delegator本身，其他implementor retire」):
herdr-delegator, `gpt-imple-1`, `gpt-imple-2`, `gpt-auditor` and `opus-auditor`. `gpt-imple-3` and `opus-imple-1` are
retired (panes closed; worktrees kept until their removal is confirmed under rule 25), and the Low-tier slot in § Slots is
closed with them. The rows above stay as the record of how each role was set up.

**Implementors since 2026-10-29 11:40: `gpt-imple-1` and `opus-imple-1`** (user: 「gpt-imple-1 use GPT-6.1-Sol medium, idle
gpt-imple-2, create opus-imple-1, now implementors use gpt-imple-1 and opus-imple-1」). `gpt-imple-1` runs on
`gpt-6.1-sol` medium (gpt-6-sol hit "model at capacity" three times that morning); `opus-imple-1` is restarted as a Claude
Code pane on Opus with `MDPRO_ROLE=implementor` in `mdpro-wt/opus-imple-1`; `gpt-imple-2` stays idle and takes no new
item. The roster is still five working agents plus the idle `gpt-imple-2`.

**Device checks move to `gpt-imple-3`** (user decision, 2026-10-23: 「已经完成还未device test的，交给 gpt-imple-3 进行device test，之后写测试报告」). It drives mdpro through Codex Computer Use from its herdr pane, from a device brief file under `~/.mdpro-redesign/device/`, and writes `<batch>-report.md` there. Every launch is by the verify bundle's full path, checked by process path and `app.ready` `releaseId` before any step (the first B1 run tested a v0.3.5 release launched by bundle id and was voided). § Device rules of rule 70 and ADR-0134 decision 6 (the desktop lock, the user's word that picsee runs no GUI) still bind.

**All macOS device tests go to `gpt-auditor`** (user decision, 2026-10-25: 「from now on, all mac os device test goes to gpt-auditor, redelegate and pause opus device test task」). The delegator resets `gpt-auditor` into a fresh pane, gives it the device brief through herdr, and reads its report under `~/.mdpro-redesign/device/`. The tester role, desktop lock, launch-by-path and device rules apply. This supersedes the 2026-10-25 interim routing of GUI batches to `opus-auditor`, and `gpt-imple-3`'s macOS device checks; opus-auditor runs no device test. **A device pane runs with `-s danger-full-access`** (user decision, 2026-10-25: 「Full access for device panes (Recommended)」), a narrow exception to ADR-0134 decision 4: the sandboxed gpt-auditor could not create the desktop GUI lock under `~/.cache` or restore `~/.mdpro/config.json`. A pane reset for an audit, confirm, challenge or review request stays sandboxed.

**GUI tests formerly assigned to `mac-test`/`dtrack` now go to `gpt-auditor`** (user decision, 2026-10-24: 「之后dtrack的 GUI test工作都交给gpt-auditor」). For such a batch, the delegator resets `gpt-auditor` into a fresh pane, gives it the device brief through herdr, and waits for its report under `~/.mdpro-redesign/device/`. The tester role and device rules in rule 70 apply to that batch; no brief is sent to `dtrack`. This assignment does not change `gpt-imple-3`'s other device work or `gpt-auditor`'s separate audit duties.

**A Claude delegator may message `picsee-delegator` directly about the shared heavy lock** (user decision, 2026-10-23: 「picsee delegator 可以直接 message @picsee-delegator ，你们直接沟通协商处理好heavy lock的事情」), by `SendMessage`, for heavy-lock coordination only (ADR-0135, D312). A Codex delegator uses the shared lock and asks the user when coordination needs a message. Nothing is sent to picsee's other sessions.

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
  - `AGENTS.md` § "Read first (Codex)", which lists this rule;
  - the shared `.codex/rules/mdpro.rules`, which forbids push, blanket staging, branch and worktree deletion,
    checking out `master`, and PR actions;
  - the gitignored per-worktree `.codex/rules/mdpro-role.rules`, installed by `install-role.mjs` for the
    implementor, auditor, or delegator role.

  The delegator installs the overlay before starting a Codex pane and checks it after a rebase.
  The prefix rules are a backstop only: `git -C <dir> push` slips past them.
- **Receipts are recorded, as for any implementor (rule 10).** Frontend REDs use
  the repository entry script, unlocked with at most 2 workers:

  ```
  node scripts/tdd/red-receipt.mjs record --id <ID> --test tests/<file>.test.ts
  node scripts/tdd/red-receipt.mjs verify --id <ID>
  ```

  Rust REDs use the same entry with `--lane rust` (`record`, then `verify`), after `cargo fmt`
  (ADR-0145 d1, d8). The rust lane's own command runs under `scripts/heavy-lock.sh`. The full frontend coverage lane
  also keeps the heavy lock. The entry runs the receipt engine vendored at `scripts/tdd/vendor/tdd-guardian-0.10.2/`,
  never the Claude or Codex plugin cache (#566); an engine upgrade is a reviewed diff of that directory.
  **Record the red before the production change it tests.** A receipt that carries
  `implementation-already-present` is named in the handoff (M3a, 2026-10-20).
- **Restart, and every reset, is a new pane** ([ADR-0133](../../docs/adr/0133-a-third-codex-implementor-takes-low-tier-items-and-every-codex-agent-runs-with-a-context-cap.md)
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
- **Opus is never required.** On Codex do not reset, prompt or wait for `opus-auditor`.
  On Claude, dispatch it only under the two conditions in § Delegator runtime route.
  Earlier Opus reports remain evidence for the rounds in which they were completed.
- **Read barrier, by phase, for gpt-auditor:**

  | Phase | May read | Must not read |
  |---|---|---|
  | Round one (`audit`, `plan` round one) | the range, the brief, the handoff, `REVIEW.md` | PR comments, `herdr-spike/delegator/` |
  | `confirm`, `plan` confirm | the files the request names: earlier reports, the delegator verdict, counter-proofs | unrelated report folders |
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

It works in four steps inside the implementor's run of
`$tdd-guardian:tdd-guardian-workflow` (current user decision, 2026-10-24). The previous
`.codex/skills/mdpro-tdd-workflow/` port is retained only for historical handoffs.
**A Claude implementor runs the same four steps without the plugin**, which is disabled for Claude Code at project scope
(user, 2026-10-30: 「Disable + narrow cleanup (Recommended)」; 2026-10-31: 「修复 PR #564 的 High」). Codex's own install is
unaffected:
1. **Design tests.** The plugin's design-tests stage writes and attacks the test matrix before implementation.
   The implementor also records the matrix under
   `~/.mdpro-redesign/herdr-spike/<name>/<item>-test-matrix.md` for the delegator. For each AC it lists:
   - success;
   - boundary (empty, max, CJK);
   - invalid input;
   - lifecycle and timing: close, reopen, switch or replace during an `await`, a stale token, a
     queued or batched operation, and a second event mid-way;
   - every caller or entry path that reaches the changed behaviour;
   - platform, where it applies.

   Each case names its assertion (document, state or IPC effect, not a boolean) and its test file.
   On Claude, the implementor designs the matrix itself, to the same list.
2. **Independent matrix attack.** The plugin's spec-adversary attacks the completed matrix.
   The implementor copies its findings verbatim to `<item>-attack.md`. The adversary returns:
   - each wrong implementation that would pass every case;
   - the case that would catch it.

   The implementor must not run the attack itself. If the plugin's adversary cannot run, it writes
   `ATTACK-NOT-RUN` and stops for a delegator ruling.
   On Claude, the attacker is a fresh subagent, never a fork or a resumed one, so it shares none of the
   implementor's context. It gets `.agents/skills/mdpro-delegator/references/templates/matrix-attack-prompt.md`, the
   brief and the matrix file, and nothing else. If it cannot run, the implementor writes `ATTACK-NOT-RUN` and stops.
3. **The implementor amends the matrix.** It adds each gap's case, or rejects the gap in the attack
   file with a counter-proof: an existing case that kills it, or the brief's Out of scope. If it added
   cases, it re-attacks once. It stops and asks the delegator about:
   - a gap still open after round two;
   - a gap the adversary marks NEEDS RULING (it asks for more than the brief).
4. **The implementor writes the tests and records the REDs.** Only after that does it touch
   production code.
   *For rule-12 (gated) items, ADR-0148 replaces this step with `tdd` cycles: one matrix case, one RED receipt, a minimal change,
   then `verify`, settled before the next cycle. Steps 1–3 are unchanged.*

The delegator checks the attack file and the matrix when it confirms the handoff. The plugin runs
plan, per-WI RED receipts, coverage, optional mutation, review, and its commit gate. The mdpro brief
adds exact lanes and a self-acceptance handoff. The plugin does not commit; after its gates complete,
the implementor makes the branch commit required by the brief outside the workflow. On Claude, the
brief's lanes and the rule 10 receipt CLI (`node scripts/tdd/red-receipt.mjs`) do that work.

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
before any audit starts, except an unproved AC with a recorded acceptance under ADR-0146 decision 4
cited in the audit request. The delegator records that acceptance before audit only when (a) a
revised brief moves the AC to a later item, (b) the real-app half of a `device` AC goes to its
ADR-0144 card, or (c) a user waiver is recorded as an audit-log gate exception. Naming an AC
unproved in the handoff alone does not accept it.

## Audits under herdr

- **Dimensions.** Both auditors use `docs/agents/audit-dimensions.md` at the master `<M>` and blob `<B>`
  named in the request, with one pin for the full review (ADR-0146).
- **PRs.** The delegator sends one fresh-pane request to `gpt-auditor` on the exact range.
  On High tier, the request also requires an explicit security review section and count.
  Optional `opus-auditor` follows § Delegator runtime route; it never replaces
  this required request.
- **Round one is blind to PR comments and delegator conclusions.** `gpt-auditor` writes its report;
  the delegator checks the evidence and posts the report when a PR exists. It records a
  single-auditor verdict unless the optional Opus audit ran; then it merges both reports.
  Any blocking Critical or High stays open until a scoped gpt-auditor confirm closes it.
- **ADRs and plans.** `gpt-auditor` reviews consistency, completeness, feasibility, ambiguity and
  risk in a fresh pane. The delegator records the applicable verdict and asks the user about
  unresolved decisions.

## Slots

**One unlanded implementation item per session, and three machine-wide**, as rule 70 says (ADR-0156,
2026-10-30, superseding ADR-0124's two, which superseded ADR-0119's four). Items that were already over the cap finish first. Prep needs no slot.

**Closed 2026-10-29 with gpt-imple-3's retirement (§ Roster); kept as the record.** **Plus one Low-tier slot, held by gpt-imple-3 only** ([ADR-0133](../../docs/adr/0133-a-third-codex-implementor-takes-low-tier-items-and-every-codex-agent-runs-with-a-context-cap.md)
decision 2; user decision, 2026-10-22: 「3rd slot, Low tier only (Recommended)」):
- **Its scope.** The delegator states the ADR-0121 tier in every grant to gpt-imple-3. A Low-tier
  item granted to gpt-imple-1 or gpt-imple-2 uses a general slot.
- **A higher-tier path found mid-item.** The item stops with `<item>-blocked.md` and keeps the slot
  until it is handed to a general slot. Its worktree, branch and receipts move with it.
- **A tier an auditor raises.** The item finishes in place, as over the cap, and gpt-imple-3 takes
  no new item until it lands.
