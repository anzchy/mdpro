# 0134. The herdr roster moves to the Mac mini, isolated from picsee

## Status

Accepted, 2026-10-23, with one finding open. Decided by the user, recorded by herdr-delegator. The user's words:
「Land open, fix later」. The ruling followed ADR-0129, after the ADR-0120 cap.
- **Reviewed over three rounds**, blind in round one, by gpt-auditor (`review-plan`) and Opus (`mdpro-fable-auditor`,
  plan mode):
  - r1: `C0 H2 M3 L0` / `C0 H2 M9 L3`;
  - r2: `C0 H2 M1 L0` / `C0 H1 M2 L1`;
  - r3: `C0 H1 M0 L0` / `C0 H0 M2 L0`.
- **Open: finding G (gpt-auditor r3, High).** Decision 7's dispatch reservation can be released on a wait timeout, or
  after a restart while the agent shows `idle`, so a third implementor can run. It is tracked as
  [D311](../plans/20260912-frontend-backend-sequencing-order.md#d311): owner herdr-delegator, fix-by v0.3.7.
- **Compensating control until then.** The delegator counts an implementor as occupied while it is reserved **or**
  herdr shows it `working`. It keeps a reservation through a timeout. After a restart, it keeps one until the agent's
  report file or pane shows the dispatched turn finished. The fix proposed at the cap is the same rule, written down.
- **Also open, Medium (Opus r3).** Decision 3's "the last item has landed" is stricter than ADR-0133 decision 2's
  Low-tier transfer. It errs toward caution, and D311's fix settles it.

Proposed 2026-10-22 by herdr-delegator (Mac mini).

The decisions are the user's, given on 2026-10-22 before drafting, and each is quoted where it is used. The
exceptions are three decisions this revision adds in answer to the review: the desktop lock, the working-agent limit
and the worktree lifetime (decisions 3, 7 and 8). Each carries a recommendation for the user to accept or change.

**Revision 2** follows the blind round one: gpt-auditor `C0 H2 M3 L0`, Opus (plan mode) `C0 H2 M9 L3`.
- **Both raised the slot ambiguity** (R1-H1, F2). Decision 7 now keeps the unlanded-item cap exactly as ADR-0124 and
  ADR-0133 state it, and adds a separate limit on agents working at once, with an observable check and an owner. The
  memory clause and the "second item for the same agent" permission are gone.
- **Opus F1 (High) and gpt-auditor R1-M1:** the draft changed Accepted clauses without naming them. A supersession
  list now follows.
- **gpt-auditor R1-H2:** reading picsee's pane does not serialise GUI runs. Decision 6 adds a shared desktop lock and
  fails closed until picsee takes it.
- **R1-M2:** decision 3 now defines the worktree's lifetime and the checks before reuse.
- **R1-M3:** decision 6 names the Windows owner.
- The Opus cost notes are now in Consequences.

**Revision 3** follows the round-two confirms: gpt-auditor `C0 H2 M1 L0`, Opus `C0 H1 M2 L1`.
- **C (both).** A word that picsee "is not running" describes a single moment. Decision 6's interim now needs the
  user to hold picsee off for the whole run. The user's words: 「You hold picsee off per run (Recommended)」.
- **R2-H1 (gpt-auditor; Opus raised the same at Medium).** A working-only count misses prompts that have been sent
  but have not started yet. Decision 7 now reserves a place at dispatch.
- **F (Medium).** The G528 exceptions are recorded in `docs/audit/audit-log.md` at `eca56b99`. The delegator-made
  commit now has the user's own ruling, 「Ratify G528-4 (Recommended)」.
- **Opus Low.** Decision 3's "or been handed off" is removed.

On acceptance, this ADR partially supersedes or amends:
- **[ADR-0124](0124-two-implementation-slots-and-a-herdr-mixed-model-roster-overlays-rule-70.md) decision 3**,
  the device-role bullet: the device roles are as decision 6 here.
- **[ADR-0133](0133-a-third-codex-implementor-takes-low-tier-items-and-every-codex-agent-runs-with-a-context-cap.md):**
  - decision 1's "one `mdpro-wt/` worktree per item", replaced by decision 3 here;
  - decision 2's clause that a blocked Low-tier item's "worktree … moves with it": the branch and the receipts move,
    and the worktree stays (decision 3);
  - decision 4's launch line and its validity check: for implementors they also carry `-s danger-full-access`
    (decision 4 here).
- **Rule 71's device decisions of 2026-10-20** (「Windows 和mac mini real device test的工作都交给 @claude-imple-1」,
  「claude-imple-1 drives dtrack (Recommended)」), replaced by decision 6.
- **[ADR-0087](0087-device-check-hook-events-are-spooled-on-the-mini-and-replayed-in-sequence.md)** is still
  *Proposed*. This ADR moves only its receiver from the MacBook to the mini, bound to `127.0.0.1`. Its spool, replay,
  dedupe and gap contract is unchanged.
- **CLAUDE.md § Worktrees**: the root path, the naming and the removal clause, for the herdr roster (decision 3).
- **Rule 70:**
  - § The Mac mini: the main checkout now belongs to the delegator;
  - § Reserving numbers: `git fetch origin` replaces `git fetch mac-mini`;
  - verify builds come from `origin`, not from refs pushed to `mac-mini`.

ADR-0131 is unchanged: a kept directory never means a kept conversation. ADR-0124 decision 1 and ADR-0133 decision 2's
slot count are unchanged too (decision 7).

## Context

- **The move.** Until 2026-10-22 the herdr-delegator, the Codex roster (rule 71) and every implementation worktree
  lived on the MacBook. The Mac mini held only the device tester (dtrack) and, earlier, mdpro-device-harness.
  - The user's words: 「这个新落地顺序修改决定落到文档中，然后之后再mini中继续完成，本Macbook的开发在当前任务结束后就移交」
    and 「之后交给mini端的herdr来继续delegate，目前mini上有另外一个project picsee 也用herdr在开发，记得两个project 隔离」.
  - The migration guide, `docs/reference/20261022-migrate-herdr-project-to-mac-mini.md`, was written on the MacBook. As
    of this revision it is in no branch, and it is to be committed from there.
  - The handoff `~/.mdpro-redesign/handoff/herdr-delegator-20261022-migrate-to-mini.md` summarises it.
- **picsee shares the machine.**
  - It runs herdr session `picsee`, with agents named `picsee-delegator`, `gpt-imple-1..3` and `gpt-auditor`: the same
    names as mdpro's. A plain `herdr` reaches the default session, which may not be mdpro's.
  - picsee's tester runs in tmux `picsee-dtrack`, on the same desktop as mdpro's `dtrack`.
- **Resources.** 16 GiB of memory, and one heavy lock, `$HOME/.cache/mdpro-heavy.lock`, shared by both projects.
- **The Codex sandbox on macOS**, as found on 2026-10-22:
  - `workspace-write` makes each worktree's own gitdir (`.git/worktrees/<name>`) read-only, whatever `writable_roots`
    says, so a sandboxed implementor cannot commit;
  - FSEvents never arrive inside the sandbox, so seven live file-watcher tests fail there, while all 344 pass outside;
  - `~/.cache` was not writable, so the heavy lock could not be taken.
- **The device tester.** On the mini it is the Claude session `mac-test` (tmux `dtrack`). Once the delegator runs on
  the same machine, it can reach `mac-test` by `SendMessage`.
- **Worktrees.** The migration created one worktree per Codex agent (`mdpro-wt/gpt-imple-1`, `-2`, `-3`,
  `gpt-auditor`). Codex writes only inside its start directory, and a pane restart is cheaper than a new worktree.

## Options considered

1. **Where development runs.**
   - (a) Stay on the MacBook. Lost: the user moved it.
   - (b) **The mini.** Chosen.
2. **Isolation from picsee.**
   - (a) Rename mdpro's agents. Lost: the rules, briefs and handoffs all use the current names.
   - (b) **A dedicated herdr session `mdpro`.** Chosen.
3. **Codex filesystem access.** The user's words: first 「Keep sandbox; I run full Rust lanes (Recommended)」, then,
   after the gitdir finding, 「Implementors full-access, auditor sandboxed (Recommended)」.
   - (a) Everyone sandboxed, with the delegator committing and running the Rust lanes for them. Lost: every commit
     and every Rust lane would pass through the delegator.
   - (b) Everyone `danger-full-access`, like picsee. Lost: the auditor only reads.
   - (c) **Implementors full access, auditor sandboxed.** Chosen.
4. **Writable roots.** The user's words: 「Global config, like picsee」.
   - (a) A per-agent `-c` override. Lost to the user's choice.
   - (b) **Global roots.** Chosen.
5. **The device role.** The user's words: 「Move it to the mini」, then 「dtrack 已经在mini上，直接 message @mac-test 即可」.
   - (a) claude-imple-1 stays on the MacBook. Lost.
   - (b) A new claude-imple-1 on the mini. Lost: the tester is already there.
   - (c) **The delegator briefs `mac-test` directly.** Chosen.
6. **Serialising GUI runs across projects** (added by this revision).
   - (a) Read the other tester's pane first. Lost: a read is not a reservation. Two idle reads can both start (R1-H2).
   - (b) **A shared desktop lock, and fail closed until picsee takes it.** Recommended.
   - (c) The user schedules every run by hand. Lost: it puts a human in every device run.
7. **Concurrency** (added by this revision).
   - (a) A cap that counts agents at work and replaces the item slots. Lost: it reopens ADR-0124 and ADR-0133.
   - (b) **Keep the item slots and add a working-agent limit.** Recommended.

## Decision

1. **The delegator, the Codex roster and every implementation worktree run on the Mac mini.**
   - The machine is `jack@jacks-Mac-mini`, and the main checkout is `/Users/jack/Documents/mac-app/mdpro`, which the
     delegator owns.
   - Worktrees live in `/Users/jack/Documents/mac-app/mdpro-wt/`.
   - The MacBook does no mdpro development. It refuses SSH from the mini, so its cleanup is the user's to run.
2. **herdr session `mdpro`.**
   - Every herdr command reaches it: inside an mdpro pane through `HERDR_SESSION=mdpro`, and elsewhere with
     `--session mdpro`.
   - Nobody touches session `picsee` or tmux `picsee-dtrack`: no prompt, `send-keys`, kill or restart.
   - Never run `herdr server stop`, and never start or restart the server over SSH.
3. **One persistent worktree per Codex agent**, `mdpro-wt/<agent-name>`.
   - **Lifetime.** It lives as long as the agent is on the roster. It is removed, under rule 25, only when the agent
     is retired. This replaces CLAUDE.md's "remove once merged" for these four directories only.
   - **One branch at a time** (`<type>/<id>-<slug>`, as CLAUDE.md says), so an agent still holds at most one unlanded
     item (ADR-0124).
   - **Before each new grant, the delegator checks the worktree:**
     - `git status --porcelain` prints nothing;
     - the last item has landed;
     - the HEAD has no unpushed commits that are not on `origin`.

     It then makes the new branch from `origin/master` with `git switch -c`. If anything is left over, the grant
     waits. Nothing is discarded without rule 25.
   - **Gitignored state** (`node_modules`, `src-tauri/target`, tdd-guardian scratch) is kept on purpose. Each
     handoff names its own receipts by id, so a receipt from an earlier item is never read as this item's.
   - **A Low-tier item that moves** (ADR-0133 decision 2): the receiving agent's worktree takes the branch and its
     receipts, after the sending worktree detaches. The directory does not move.
   - Verify worktrees keep the name `verify-<sha7>`.
4. **Codex access.**
   - gpt-imple-1, gpt-imple-2 and gpt-imple-3 launch with `-s danger-full-access` plus the rule-71 flags. A reset
     counts only if `argv` shows all of them.
   - gpt-auditor stays `workspace-write`.
   - `~/.codex/config.toml` holds the global `writable_roots` (`~/.mdpro-redesign`, `mdpro/.git` and `~/.cache`,
     beside picsee's) and the five mdpro `trusted` entries. The user edits that file.
5. **Lanes.** Implementors run every lane themselves again, the full Rust lane included. In a sandboxed run, a
   file-watcher failure with no events delivered is evidence of the environment, not of the code. It is settled by a
   run outside the sandbox on the same tree.
6. **Device checks.**
   - **macOS.** The tester is `mac-test` (tmux `dtrack`), briefed by the delegator directly by `SendMessage`. The
     claude-imple-1 row is retired. `mac-test` stays report-only, with the evidence rules of rule 70 § Device-check
     batches.
   - **Windows.** `mac-test` also owns Windows batches, run through the `remote-windows-device-test` skill. Reports
     go to `~/.mdpro-redesign/device/<batch>-report.md`. The prerequisite is an SSH key from the mini on
     `win-desktop`. The user installs it, and the delegator checks it with one non-interactive `ssh` before the
     first Windows brief. Until then, Windows batches wait.
   - **Hook events** go to launchd `com.mdpro.hook-receiver` on the mini, at `127.0.0.1:8787`, and `push.json` points
     there. ADR-0087's contract is otherwise unchanged.
   - **One GUI run at a time across both projects.**
     - The run holds a desktop lock, a directory `$HOME/.cache/desktop-gui.lock` holding an `owner` file (project,
       session, batch, start time). It is taken with `mkdir` before the app is first launched, and released after
       the last GUI step, including through prompts and pauses.
     - **Interrupted owner.** A lock whose owner session no longer exists is broken only by the delegator that owns
       the batch, after it has read the owner file and checked that the session is gone.
     - **Fail closed until picsee takes the same lock.** Until the user confirms that picsee takes it, the delegator
       asks the user before each mdpro GUI batch. The batch starts only after the user confirms that picsee will
       start no GUI run until mdpro's lock is released: the user holds picsee off for the whole run. The user's
       words: 「You hold picsee off per run (Recommended)」. A word that picsee is idle right now is not enough.
7. **Concurrency.**
   - The unlanded-item slots are unchanged: one per session, two general slots, plus ADR-0133's Low-tier slot.
   - **Separately, at most two mdpro implementor agents are occupied at once.**
     - **What counts as occupied.** An implementor is occupied from the moment the delegator dispatches a prompt to
       it until that prompt's background `prompt --wait` has exited and the delegator has read the agent's state. It
       is also occupied while herdr shows it `working` without a dispatch, after a restart.
     - **The check is made on the delegator's own reservations, not on a status snapshot.** Before a dispatch, the
       delegator writes the agent's name into `heartbeat.json` `dispatched`. It removes the name when the wait
       exits, whether settled, stalled, or timed out after a `herdr agent get`.
     - **No third dispatch.** A dispatch that would make three waits for a removal.
     - **After a restart,** the delegator treats every name left in `dispatched` as occupied until `herdr agent get`
       shows that agent `idle` or `done`.
     - An item waiting on audit, CI or a ruling holds its slot but is not occupied.
   - Both projects share the heavy lock. `~/.codex/memories/` is shared with picsee and is never edited.
8. **Procedures that pointed at the MacBook.**
   - Number reservation runs `git fetch origin` and scans every worktree on the mini. The MacBook is no longer
     scanned, because it holds no development.
   - Verify builds come from a branch or SHA on `origin`.

On acceptance, one docs commit links here and edits:
- rule 70 (roster, alias table, § The Mac mini, § Reserving numbers);
- rule 71 (roster, launch lines, device rows);
- CLAUDE.md § Worktrees.

The Status lines of ADR-0124 and ADR-0133 gain "partially superseded by ADR-0134" with the clauses named.

## Consequences

- **Gains.**
  - One machine holds the code, the agents and the device.
  - The tester is one `SendMessage` away, with no SSH hop and no cross-machine hooks.
  - Implementors commit and run every lane again.
  - Agent worktrees keep their `node_modules` and Rust `target`, so a new item starts warm.
- **Costs and what this forecloses.**
  - **`danger-full-access` removes the filesystem sandbox from three agents.** With `approval_policy = "never"` and
    network access on, an implementor can read the user's credentials (keychain-backed `gh`, `~/.ssh`, tokens under
    `~/.mdpro-redesign`) and can push by a path the prefix rules miss (`git -C`, a script, the GitHub API). It can
    also write anywhere the user can, picsee's tree included. The only guards left are `.codex/rules/mdpro.rules`,
    `AGENTS.md` and the delegator's scope check on every handoff.
  - **The global `writable_roots` now matters only for the sandboxed auditor and for picsee's agents.** It lets every
    sandboxed Codex session on the mini write mdpro's `~/.mdpro-redesign` and `~/.cache`. The `mdpro/.git` root does
    not help with commits in a worktree (see Context). It stays only for writes to the main gitdir.
  - **Persistent worktrees can carry state between items.** The pre-grant check covers tracked and untracked files,
    not gitignored ones. A stale build artifact or tdd scratch file can survive into the next item. That cost is
    accepted for the warm start.
  - **The desktop lock binds mdpro alone until picsee takes it.** Until then, each mdpro GUI run waits for the user's
    word.
  - **Two projects share 16 GiB, one heavy lock and one desktop**, so each delays the other.
  - **Name collisions remain.** A command that forgets the session reaches picsee's same-named agent.
  - **The hook history restarted at spool seq 288.** `last-dtrack.sh` prints `missing seq 1..287 (dtrack-mini)` for
    good, because those events stay on the MacBook.
  - **Development does not return to the MacBook without a new ADR.**
- **Gate exceptions from this move.** These are recorded in `docs/audit/audit-log.md` § Gate exceptions at
  `eca56b99`.
  - **G528-4.** The delegator committed `e8fa4b78` (D255-WI-3b fix 3) on gpt-imple-2's behalf, because sandboxed
    Codex could not commit. It also ran the full Rust lanes outside the sandbox.
    - The lanes were authorised by 「Keep sandbox; I run full Rust lanes (Recommended)」.
    - The commit was ratified afterwards by 「Ratify G528-4 (Recommended)」.
  - **G528-3** records the post-cap fix itself, under 「Carry it to the mini」.
