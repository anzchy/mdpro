# 0135. One heavy-lock tool serves every project on the Mac mini, queues in arrival order and admits by memory

## Status

**2026-10-29: extended** (decision 3's legacy-mode set, which now also carries the load guard's admission, runtime stops and GUI exclusion; decision 6 is pulled into phase 1) by [ADR-0150](0150-heavy-and-gui-runs-exclude-each-other-and-a-load-guard-stops-a-job-under-memory-or-cpu-overload.md) decision 8.

**2026-10-29: partially superseded** (decision 6's "Unreadable … start", on macOS hosts) by [ADR-0152](0152-an-unreadable-memory-pressure-reading-on-macos-holds-the-job.md).

**2026-10-29: partially superseded** (decision 6's warn-level start after five minutes) by [ADR-0151](0151-heavy-jobs-are-admitted-against-a-memory-budget-and-cpu-stops-only-the-job-that-causes-it.md).

Accepted, 2026-10-23. Decided by the user, recorded by herdr-delegator. The user's words: 「接受 (Recommended)」,
choosing to accept it and queue D312 behind M1b and D255-WI-3d. The user asked for it the same day:
「查看相关最佳实践，看看machine-wide，如何在多个项目测试间，避免过载前提下，协调多个项目的测试」, then 「开始起草」.
- **Reviewed over three rounds**, blind in round one, by gpt-auditor (`review-plan`) and Opus (`mdpro-fable-auditor`,
  plan mode):
  - r1: `C0 H3 M5 L1` / `C0 H4 M8 L3`;
  - r2: `C0 H2 M3 L0` / `C0 H1 M9 L6`;
  - r3: `C0 H0 M3 L0` / `C0 H0 M3 L5`.
- Revision 4 folds in the round-three Medium and Low items without another round (ADR-0120 cap). Reports:
  `~/.mdpro-redesign/herdr-spike/{gpt-auditor,opus-plan}/ADR-0135-r{1,2,3}.md`; merged verdicts
  `~/.mdpro-redesign/herdr-spike/delegator/ADR-0135-r{1,2}-merged.md`.
- **Not live yet.** Nothing changes until D312 lands (legacy mode) and the user runs the decision 3 barrier.

It:
- partially supersedes [ADR-0134](0134-the-herdr-roster-moves-to-the-mac-mini-isolated-from-picsee.md)
  decision 7's clause "Both projects share the heavy lock": the lock stays shared, and the protocol that takes it
  changes;
- is built by D312.

It keeps:
- rule 10's one heavy job at a time;
- the 2-worker ceiling on unlocked partial runs (D147);
- [ADR-0130](0130-ci-coverage-runs-in-shards-workers-follow-load-and-test-timeouts-are-liveness-bounds.md)'s
  load-following workers.

Evidence: [`docs/reference/20261023-heavy-lock-incident.md`](../reference/20261023-heavy-lock-incident.md).

## Context

- **Two projects share one machine.**
  - Since ADR-0134, mdpro and picsee both develop on the Mac mini: 16 GiB of memory, 4 performance cores and 6
    efficiency cores.
  - Each project runs two or three Codex implementors, plus its auditors and its delegator.
- **Two scripts take one lock, `$HOME/.cache/mdpro-heavy.lock`, by atomic `mkdir`.**
  - mdpro's `scripts/heavy-lock.sh`:
    - writes an `owner` file;
    - reclaims a lock whose owner pid is dead;
    - runs the job in its own process group;
    - on INT/TERM drains that group (TERM, grace, KILL) before releasing (D75).
  - picsee's `scripts/tdd/heavy-lock.py`:
    - first takes its own kernel `flock` on `~/.picsee/locks/heavy.lock`, then the same `mkdir` lock, retrying it
      about every 5 s;
    - never reclaims a stale `mkdir` lock itself;
    - honours `MDPRO_HEAVY_LOCK_HELD` from an mdpro parent;
    - returns 75 rather than nest under another picsee holder;
    - skips the shared lock entirely when `PICSEE_MDPRO_LOCK=off`.
  - The two differ in how a lock outlives its owner, and nothing keeps them in step.
  - mdpro already uses an inherited `flock` once: in `scripts/tdd/red-receipt.mjs`, for the unit-red lane.
- **The incident, 2026-10-23 10:23–10:45.**
  - picsee's `gpt-imple-1` held the lock with `heavy-lock.py zsh -f`, an interactive shell with no job under it.
  - Both mdpro implementors' gates queued behind it.
  - Neither script can tell a held-but-idle lock from a working one; a person found it by reading `owner`.
- **Waiting is a race, not a queue.** Whichever waiter's `mkdir` lands first wins, so a long waiter can starve.
- **Admission ignores memory**, and on this machine memory runs out before CPU.
- **Practice elsewhere** (survey, 2026-10-23). Each of these serialises through one shared point:
  - a token pool: the GNU make jobserver, which Cargo and LLVM honour;
  - a named counting semaphore: GNU `sem`;
  - a queue daemon with per-group limits: pueue;
  - admission by declared CPU and RAM: Bazel `--local_cpu_resources` / `--local_ram_resources`.

## Options considered

1. **Where the code lives.**
   - (a) Two independent scripts, as now. Lost: they drift, and neither alone can fix the incident's class.
   - (b) One installed binary in `~/.local/bin`, called by both. Lost:
     - CI runners and fresh worktrees lack it;
     - nothing pins its version;
     - a change to it bypasses both projects' audit gates, and ADR-0121 rates gate tooling High.
   - (c) **One canonical source repository, `~/Documents/mac-app/heavy-lock`, vendored as a pinned copy into each
     project.** Recommended.
2. **Mechanism.**
   - (a) **Lock plus queue.** Recommended.
   - (b) pueue. Lost: a resident daemon, partial macOS support, and every caller changes.
   - (c) A jobserver token pool. Lost: vitest, `tsc` and Swift test take no tokens.
3. **How many heavy jobs.**
   - (a) **One.** Recommended: two Cargo links, or two coverage runs, exhaust 16 GiB first.
   - (b) Two, or a weight per job. Lost: no memory cost per job type has been measured.
4. **Lock lifetime.**
   - (a) The launcher alone holds the descriptor (`O_CLOEXEC`). Lost: a SIGKILLed launcher frees the lock while its
     job runs.
   - (b) The job alone holds it, with no drain (picsee's model). Lost: a survivor holds the lock invisibly, and a
     boundary that closes descriptors releases it early.
   - (c) **Both: the job inherits it, and the launcher drains the group before closing its own copy.** Recommended.
     This follows `red-receipt.mjs`'s inherited flock and keeps D75.
   - (d) A lease renewed by heartbeat. Lost: a job busy past a missed renewal loses its exclusion.
   - (e) Supervision of every descendant. Lost: macOS has no cgroup-like container, so it cannot be done from user
     space.
5. **Transition.**
   - (a) Mixed operation. Lost: old and new callers overlap (round-one finding B; round-two findings R2-H2 and F1).
   - (b) **The sentinel is the switch, behind an operational barrier, in both directions.** Recommended.
6. **Idle holders.**
   - (a) Kill after N minutes without CPU. Lost: network and timer waits look idle, and killing another project's job
     breaks ADR-0134's isolation.
   - (b) **Refuse a bare shell, report a stalled holder, and let only its owner end it.** Recommended.
7. **Priority.**
   - (a) **Arrival order only**, for now. Recommended.
   - (b) A `gate` class ahead of `iterate`. Lost for now: every caller must label its jobs correctly. Revisit after a
     month of queue data.

## Decision

1. **Code.**
   - **Source and copies.** The canonical source is `~/Documents/mac-app/heavy-lock`: Python 3, standard library
     only, tested on macOS and Linux. Each project vendors a pinned copy with a `VERSION` file. mdpro's copy is
     `scripts/heavy-lock/`, and it changes only through mdpro's gate.
   - **mdpro's wrapper.** `scripts/heavy-lock.sh` becomes a wrapper over that copy and keeps its interface:
     - arguments;
     - exit codes: the child's own; 75 on any wait deadline or refusal to run; 64 on a refused command;
     - `MDPRO_HEAVY_LOCK_WAIT_SECS` and `MDPRO_HEAVY_LOCK_KILL_GRACE_SECS`;
     - the D75 behaviour.
   - **The path override.** `MDPRO_HEAVY_LOCK=<p>` keeps working: it names the legacy path, and it sets the namespace
     to `<p>.ns` unless `HEAVY_LOCK_DIR` is given. Setting both refuses with 64.
   - **Compatibility.** The namespace records a `protocol` number. A copy that finds another number refuses with 75 and
     names both.
   - **picsee** adopts the tool through its own process; mdpro never edits picsee.
2. **Lifetime.**
   - **The lock.** The holder takes `flock` on `<ns>/lock`. `<ns>` is `$HOME/.cache/heavy-lock` unless
     `HEAVY_LOCK_DIR` names another.
   - **Who holds it.** The job inherits the descriptor. The launcher runs the job in a new process group and keeps its
     own copy.
   - **Normal exit.** When the leader exits, the launcher waits for the rest of the group up to the drain cap, then
     sends TERM, waits the grace period, and sends KILL.
   - **INT, TERM, HUP.** The launcher sends TERM, waits the grace period, and sends KILL at once.
   - **Release.** The launcher closes its copy only when the group is empty. If the group survives KILL, it keeps the
     lock, shows `draining` in `status`, and never releases silently.
   - **Never.** The lock is never cleared by `LOCK_UN`, by unlinking the file, or by replacing it.
   - **Protected:**
     - every process in the job's group, while the launcher lives;
     - any process that still holds the descriptor, in any group, for as long as it lives.

     `heavy-lock status` lists the descriptor's holders (`lsof`), with each one's owner record.
   - **Accepted limitations**, shown in `status` where they can be detected:
     - (i) once the launcher is SIGKILLed, any process that does not hold the descriptor, in the group or not;
     - (ii) a process that left the group and dropped the descriptor, which can outlive a normal teardown.
3. **Transition: the sentinel is the switch.**
   - **Modes.** Each acquisition reads the legacy path (`$HOME/.cache/mdpro-heavy.lock`, or `MDPRO_HEAVY_LOCK`):
     - **legacy mode:** the path is absent or a directory. The tool runs the old `mkdir` protocol exactly as
       `heavy-lock.sh` does today, reclaim rules included. Decisions 5 and 7 (nesting, the bare-shell refusal, the
       owner record) and decision 2's normal-exit drain also apply in legacy mode; decisions 4 and 6 do not. Landing
       D312 therefore changes no exclusion, only those additions;
     - **new mode:** the path is a regular file, the sentinel. The tool uses decisions 2 and 4. After taking
       `<ns>/lock` it reads the path again, and if the sentinel is gone it releases and retries;
     - **refused (75):** the path is anything else (a symlink, a device, a FIFO), or `<ns>/migrated` exists while the
       sentinel is absent. A sentinel deleted outside the barrier (a cache cleanup) therefore stops every caller
       instead of dropping back to legacy mode beside a running new-mode holder.
   - **Unmigrated callers in new mode fail closed.**
     - mdpro's old script cannot `mkdir` the file. It finds no owner and never reaches `reclaim`, because its `-d`
       test is false, so it exits 75 at its deadline.
     - picsee's script returns 75 on "not a directory".
     - picsee's own `PICSEE_MDPRO_LOCK=off` bypasses both, and picsee's adoption removes it.
   - **The barrier.** Switching either way, cutover or rollback:
     1. The user stops heavy-job dispatch in both projects. picsee's dispatch is stopped by the user, not by mdpro.
     2. Wait until no launcher process of either kind is alive (`pgrep -f` on both scripts and the tool). That
        excludes an old reclaimer paused between its check and its rename.
     3. Wait until `<ns>/lock` has no holder, the queue is empty, and the legacy path is not a directory.
     4. Re-check step 2, then change the path with `heavy-lock cutover` or `heavy-lock rollback`:
        - cutover creates the sentinel by `open(O_CREAT | O_EXCL)` (a shell's `noclobber` is not equivalent), then
          writes `<ns>/migrated`; any failure stops the transition;
        - rollback removes `<ns>/migrated`, then the sentinel.
     5. Resume dispatch.
   - **Done.** Cutover completes, dated in this Status, when both projects' default branches carry the tool. A
     worktree on an older branch fails closed until it rebases.
4. **Queue (new mode).**
   - **Joining.** Under a `flock` on `<ns>/queue.lock`, a waiter takes the next number from `<ns>/queue.seq`, creates
     `<ns>/queue/<number>` and takes a `flock` on that ticket, all before it releases `queue.lock`.
   - **Liveness.** A ticket is live exactly while its flock is held. A dead waiter's ticket, after a SIGKILL or a
     reboot, is found by a non-blocking probe and removed. No pids, no timestamps.
   - **Order.** The lowest live number takes `<ns>/lock`.
   - **A head that makes no progress.** If the lowest live ticket has not taken a free lock within the head timeout
     (a stopped or wedged waiter), it is marked skipped and the next live, unskipped ticket may take the lock. Each
     ticket is skipped at most once per wait, so several stopped tickets cost one timeout each, not one per turn. A
     skipped waiter that resumes takes the next free turn.
   - **Leaving.** A waiter removes its ticket on acquisition, on deadline, on a signal, and on spawn failure.
   - **What FIFO covers.** Arrival order holds among migrated waiters that make progress and whose holders finish. A
     skipped head loses its place, and a stalled holder still blocks everyone.
5. **Nesting.**
   - The tool exports `HEAVY_LOCK_HELD=1`, `MDPRO_HEAVY_LOCK_HELD=1` (which ADR-0130's worker count reads) and
     `PICSEE_HEAVY_LOCK_HELD=1`.
   - A call that finds any of them runs the command directly, before any ticket or lock, so a nested call never
     queues behind its own parent.
6. **Memory admission (new mode).** Holding the lock, the launcher shows `admitting` in `status` and reads
   `kern.memorystatus_vm_pressure_level` every 5 s.
   - **Normal (1):** start the job.
   - **Warn (2):** keep waiting until the warn time adds up to the warn limit, then start with a logged warning.
     Time spent at warn accumulates and is not reset by a spell at critical.
   - **Critical (4):** wait; never start.
   - **Unreadable** (any non-macOS host, CI included): start, with a logged note.
   - **One deadline** covers queue, lock and admission. When it passes before a start, the launcher exits 75 without
     running the job and releases the lock.
   - **A start reserves nothing.** A later allocation outside the lock can still raise pressure.
7. **Idle holders.**
   - **Refused at the door (64):**
     - a shell with no script operand and no short option cluster containing `c`: `sh`, `bash`, `zsh`, `dash`,
       `ksh`, `fish`, `csh` or `tcsh`, by any path or behind a leading `env`;
     - a shell given `-s`.

     Only single-dash clusters count. Long options never count, and an option's own argument (`-o pipefail`,
     `--rcfile x`) is skipped when looking for the script operand. This refuses the incident's `zsh -f`,
     `bash --norc` and `zsh --no-rcs`, and allows `bash build.sh` and `sh -ec …`. It does not catch
     `sh -c 'exec zsh'` or a REPL.
   - **Stalled, the backstop.** A `running` holder is marked `stalled` when, for the stall period, there is no CPU
     time in the job's process group or in any holder of the descriptor, the launcher excluded. It then shows in
     `status` and in every waiter's heartbeat. The `admitting` and `draining` states are never marked stalled.
     Every waiter and `status` computes it from the owner record and `lsof`, so it needs no live launcher.
   - **Owner record:** project, session (the herdr agent, or `MDPRO_ROLE`), pid, start, command.
   - **Who acts.**
     - Each project's delegator watches `status` for its own jobs.
     - A stalled holder of the other project goes to the user, never to that project's sessions (ADR-0134 decision 2).
     - Only the holder's owner, or the user, ends it.
8. **Tests.**
   - **Where they run.** The vendored copy's tests run in mdpro's unit lane as `tests/tooling/heavy-lock-*.test.ts`.
     They spawn the copy. `heavy-lock-signal.test.ts` is ported, not deleted, so D75 stays in `ci-gate`.
   - **Private namespace.** Every case:
     - sets only `MDPRO_HEAVY_LOCK=<tmp>/legacy`, so the namespace is `<tmp>/legacy.ns`;
     - clears all three `*_HELD` variables, except where it deliberately tests nesting;
     - for a new-mode outer acquisition, asserts that a ticket and the lock were really taken in that namespace; a
       legacy-mode case asserts the `mkdir` lock instead, and a nested call asserts that it took neither.
   - **Cases:**
     - a surviving grandchild after the leader's exit;
     - limitation (i): a same-group worker that closed the descriptor, with the launcher killed during drain;
     - limitation (ii): a worker that left the group and closed the descriptor, with a normal exit;
     - an orphan that keeps the descriptor;
     - a dead ticket, and a stopped head;
     - nesting both ways;
     - each pressure sequence, and a deadline reached during warn;
     - legacy mode against the old script;
     - the sentinel against both old scripts, a deleted sentinel with `migrated` present, and a symlink at the path;
     - a barrier refused while an old launcher, or a new holder, is alive;
     - a skipped head that resumes, and two stopped tickets in a row.

| Constant | Value | Override |
|---|---|---|
| deadline | 30 min | `MDPRO_HEAVY_LOCK_WAIT_SECS` |
| kill grace / drain cap | 10 s / 300 s | `MDPRO_HEAVY_LOCK_KILL_GRACE_SECS` / `HEAVY_LOCK_DRAIN_SECS` |
| warn limit | 5 min | `HEAVY_LOCK_WARN_ADMIT_SECS` |
| stall period | 10 min | `HEAVY_LOCK_STALL_SECS` |
| head timeout | 60 s | `HEAVY_LOCK_HEAD_SECS` |
| queue poll / pressure poll | 1 s / 5 s | — |

## Consequences

- **Gained.**
  - **One protocol,** tested once, with a pinned copy inside each project's gate.
  - **A launcher that dies can't free the lock under its job** while any process still holds the descriptor.
  - **Waiters are served in turn.** A dead waiter can't freeze the queue, and a stopped one at the head is skipped.
  - **A bare shell can't hold the machine,** and a stalled holder is visible to every waiter.
  - **A heavy job never starts into critical memory pressure.**
  - **D312 can land before the switch,** because legacy mode keeps today's exclusion.
- **Costs.**
  - **A third repository,** outside both gates.
    - Only the vendored copies are audited, so a copy can lag the source and the other copy.
    - `protocol` is the compatibility boundary, and changing it needs another barrier in both projects.
  - **The barrier is a coordinated stop of both projects.** It needs the user, and picsee's own adoption first.
  - **Old branches fail closed after the switch.** A worktree on an older branch can't run its heavy lanes until it
    rebases.
  - **Admission adds latency.**
    - Up to the warn limit at warn, and up to the whole deadline at critical.
    - It holds the lock while it waits, so the queue waits too. Releasing and re-queuing would let a later arrival
      jump ahead.
  - **Two limitations stay unprotected.** These are decision 2's (i) and (ii). Detection is best-effort.
  - **A holder can still block everyone until a person ends it,** whether it is a survivor that keeps the descriptor
    or a stalled holder. This decision makes both visible, not self-healing.
  - **No priority.** A landing verifier can wait behind iteration runs.
- **Foreclosed.** Two heavy jobs at once, until the memory cost per job type is measured.
