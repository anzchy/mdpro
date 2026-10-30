# 0155. A GUI keeper holds the heavy lock in a `holding` state, and releases itself when its GUI lock is gone

## Status

**Accepted, 2026-10-30, as revision 4. Decided by the user**, recorded by herdr-delegator (Claude route). The user's words:
「Accept r4 now (Recommended)」. They were given after round three, in which opus-auditor found nothing blocking and
gpt-auditor's one High was answered in revision 4's text.

Proposed 2026-10-30, drafted by herdr-delegator (Claude route) at the user's request: 「add a new ADR adding a keeper
state.」

That request came after gpt-auditor's plan review of the D312 PR 1 brief
(`~/.mdpro-redesign/herdr-spike/gpt-auditor/D312-brief-plan-r1.md`, H1). The review found that the brief could not defer
ADR-0135's legacy-mode stall mark without a record.

The request replaces the user's earlier answer to the same question, 「Build it, keeper shows stalled (Recommended)」. That
answer was given by `AskUserQuestion` in herdr-delegator's session `e19493da` on 2026-10-30.

Revision 2 folds in round one of the plan review:
- gpt-auditor `~/.mdpro-redesign/herdr-spike/gpt-auditor/ADR-0155-r1.md`: C0 H3 M4;
- opus-auditor `~/.mdpro-redesign/herdr-spike/opus-auditor/ADR-0155-r1.md`: C0 H1 M7 L8.

Revision 3 follows round two:
- gpt-auditor `~/.mdpro-redesign/herdr-spike/gpt-auditor/ADR-0155-r2.md`: C0 H4 M1;
- opus-auditor `~/.mdpro-redesign/herdr-spike/opus-auditor/ADR-0155-r2.md`: C0 H1 M5 L5.

Round two closed every round-one High. It found four new Highs in revision 2's keeper state file and monotonic timer.
The user ruled on 2026-10-30 to drop both and allow one more scoped confirm, beyond ADR-0143's cap:
「Simplify, 1 more round (Recommended)」.

Revision 4 applies text fixes from round three:
- gpt-auditor `~/.mdpro-redesign/herdr-spike/gpt-auditor/ADR-0155-r3.md`: C0 H1 M4;
- opus-auditor `~/.mdpro-redesign/herdr-spike/opus-auditor/ADR-0155-r3.md`: C0 H0 M5 L4, READY.

The changes:
- `--release` becomes idempotent (gpt H1, M1);
- the never-armed release requires the GUI lock to be definitely absent (gpt M2, opus M1);
- a memoryless `stalled` branch is added (opus M2);
- the newest child of any kind is judged, by `ps` elapsed time (gpt M3, opus M3, M4);
- a display test is added (gpt M4, opus M5).

If accepted, it **partially supersedes**
[ADR-0135](0135-one-heavy-lock-tool-serves-every-project-queues-in-arrival-order-and-admits-by-memory.md) in two places:
- **decision 7:** the state set gains `holding`, a keeper holder's stall rule replaces the CPU-idle rule, and the owner
  record gains fields;
- **decision 8:** the clause "every case sets only `MDPRO_HEAVY_LOCK`".

The rest of decision 7 stands: the bare-shell refusal and who acts. D312 builds this ADR (decision 7 below).

## Context

- **How a GUI run takes the locks.** ADR-0150 decision 1 makes a GUI run take the heavy lock, then
  `~/.cache/desktop-gui.lock`.
  - `gui-lock.sh acquire` runs `scripts/heavy-lock.sh --hold <acquisition_id>`. That starts a detached keeper
    (`--keeper <uuid>`).
  - Only then does `gui-lock.sh` create the GUI lock (`gui-lock.sh:215` before `:224`).
  - The keeper holds the heavy lock until `--release <uuid>`. It wakes every 60 s to start a new `sleep`
    (`heavy-lock.sh:234–241`).
- **The stall rule.** ADR-0135 decision 7 marks a `running` holder `stalled` after 10 minutes with no CPU in its group.
  - The mark shows in every waiter's heartbeat and in `status`.
  - A stalled holder of the other project goes to the user.
  - ADR-0135 decision 3 applies decision 7 in legacy mode, so D312 PR 1 must build it.
- **A keeper defeats that rule both ways.**
  - It is idle by design. The GUI work runs in the app under test and in the tester's pane, and a batch takes up to
    about 45 minutes (rule 70 § Device-check batches). Every batch over 10 minutes would raise a false alarm.
  - Its 60 s wake means its group is never CPU-silent for 10 minutes. A keeper left behind would never be marked stalled
    (gpt H1).
- **Keepers do get left behind.** In one path, `gui-lock.sh release` removes the GUI owner (`:164–166`) and then fails to
  release the keeper (`:242–244`). A retried `gui-lock.sh release` then refuses at `:158–160`, because the GUI owner is
  gone (opus M4). A batch can also simply be abandoned.
- **What the GUI owner records.** Its fields are `project`, `session`, `batch`, `start`, `pid`, `expected_minutes`,
  `purpose` and `acquisition_id` (`gui-lock.sh:24`).
  - `start` is wall-clock local time with an offset.
  - `expected_minutes` is any positive decimal.
  - `pid` is the transient acquirer. It exits once `acquire` returns, so it is not a liveness signal (opus H1).

## Options considered

1. **Build the stall rule as written, so the keeper shows `stalled`.** Lost on two counts. Every long batch raises a false
   alarm. And the 60 s wake still hides a keeper that was left behind.
2. **Defer the stall mark to D312 PR 2.** Lost: the user asked for a keeper state instead. Deferring also leaves legacy
   mode without the backstop.
3. **Exempt every keeper from the stall mark.** Lost: a keeper left behind is never visible, and that is the failure
   decision 7 exists to catch.
4. **A lease the tester renews.** The tester's pane would touch a file every few minutes. Lost:
   - it adds a duty to every tester in both projects;
   - one long Computer Use step that misses a renewal raises a false alarm;
   - the renewal would itself need a protocol.
5. **Count the app under test's CPU.** Lost:
   - the app idles between steps;
   - naming "the app under test" across two projects needs another protocol.
6. **A `holding` state bounded by the batch's declared time, with the keeper's own monotonic timer driving the stall mark
   through a state file** (revision 2). Lost in round two:
   - the state file in the lock directory makes an ordinary release fail (opus H1);
   - the timer has no start that cannot come before GUI acquisition (gpt H4);
   - a keeper that cannot write, and whose GUI lock is gone, never shows `stalled` (gpt H1, H3).
7. **A `holding` state bounded by the GUI owner's own window, with keepers that release themselves once their GUI lock is
   gone, and a stuck keeper read from `ps`.** Chosen.

## Decision

1. **The state.** ADR-0135 decision 7's state set gains `holding`. A waiter computes it afresh on every heartbeat and every
   `status`, with no memory of earlier readings. **Any read error, timeout, parse failure, or identity that changes
   between reads makes the condition false.** The GUI owner is re-read after the process identities are read. A keeper
   holder is `holding` when all four conditions hold:
   1. **The holder is a keeper.**
      - The heavy owner record was written by the tool's own keeper path.
      - Its label `U` matches `gui-lock.sh`'s `uuid4` pattern.
      - Its `pgid` equals its `pid`, so the keeper leads its own process group (D312 PR 1 AC-9).
   2. **The keeper is alive and awake.**
      - It is alive under its recorded `pid`, process start and `uid`, and it is not stopped (`ps` state `T`).
      - Its process group holds only the keeper and its own `sleep`. In new mode, the descriptor holders are only those two.
      - Its newest child, a `sleep` or its own check, started no more than two wake periods ago (decision 3).
   3. **The GUI lock is held for the same acquisition.** "Held" means all of these:
      - `HEAVY_LOCK_GUI_LOCK` is a real directory, not a symlink;
      - its `owner` is a regular file that parses under the GUI-owner schema in `PROTOCOL.md`;
      - its `acquisition_id` equals `U`;
      - its `project` equals the heavy owner's `project`.

      The GUI owner's `pid` is never tested. `HEAVY_LOCK_GUI_LOCK` defaults to `$HOME/.cache/desktop-gui.lock` and can be
      overridden only under `HEAVY_LOCK_TEST=1`.
   4. **The batch window is open:** `now < start + min(expected_minutes, HOLD_MAX) + HOLD_GRACE`, on the wall clock.
      - The window starts at the GUI owner's `start`, which `gui-lock.sh` writes after the heavy lock is admitted
        (`:215` before `:224`). So no admission wait uses up the window.
      - `start` is parsed with its offset.
      - The condition is false if `start` is later than now, or more than 60 s before the keeper's process start.
      - It is also false if `expected_minutes` is not a positive integer.
2. **A keeper releases itself when its GUI lock is gone.** On every wake, the keeper checks condition 3 for its own `U`.
   The check runs under a timeout shorter than one wake period.
   - **It arms** when it first sees condition 3 true.
   - **Once armed,** it releases itself when two consecutive wakes find its GUI lock *definitely* gone: `ENOENT` on the
     lock directory, or a parsed owner whose `acquisition_id` is not `U`. It releases through its ordinary exit path,
     which removes the lock directory.
   - **A read error, timeout or parse failure counts as neither present nor gone.** It never triggers a release, and it
     resets the two-wake count.
   - **If it never arms** within `HOLD_ARM` of signalling ready, it releases itself, but only when two consecutive wakes
     after that point find the GUI lock directory definitely absent (`ENOENT`). This covers an acquirer that died
     between `--hold` and writing the GUI owner. An unreadable owner, or one for another acquisition, never releases an
     unarmed keeper. Decision 3 shows that keeper as `stalled` instead.
   - **`--release <U>` is idempotent.** `scripts/heavy-lock.sh --release <U>` exits 0 when no lock is owned by `U`. It
     still re-checks the owner's label, pid and process start before it signals, and it signals only a lock owned by `U`.
     A normal `gui-lock.sh release` that races a self-release therefore succeeds, in any order.
   - **Each self-release** first appends a best-effort `heavy.keeper.self_release` record naming `U` to the tool's log,
     then exits. The record is diagnostic only. A failed append does not stop the release, and nothing reads the record
     to decide anything.
   - **The keeper writes nothing into the lock directory beyond its owner record.** `--hold` keeps its one-argument
     interface, so old and new `gui-lock.sh` and picsee's acquirer need no change.
3. **How a keeper holder's state is shown.** A keeper holder is never judged by the CPU-idle rule.
   - It is **`holding`** while decision 1 holds.
   - It is **`stalled`** when it is alive under its identity and either:
     - it is stopped, or its newest child (a `sleep` or its own check) has an elapsed time, from `ps -o etime=`, of more
       than two wake periods (a keeper too stuck to wake, and so too stuck to release itself); or
     - its process is older than `HOLD_ARM`, and condition 3 is false for a reason other than a definitely absent GUI
       lock directory: an owner for another acquisition, an unreadable or unparseable owner, a symlink, or a project
       mismatch. A keeper in that state can never release itself; or
     - its GUI lock is held for `U` and `now ≥ start + min(expected_minutes, HOLD_MAX) + HOLD_GRACE + one stall period`
       (a batch that overran).
   - It is **`running`** otherwise. This covers:
     - the seconds of a normal release;
     - the arming gap before the GUI owner exists;
     - the two wakes before a self-release;
     - the stall period after the window closes.

   - **A missing child.** A waiter that finds no child of a live, unstopped keeper reads it as `running`. The gap
     between one child and the next lasts milliseconds.
   - **A hung check.** A keeper hung inside its own check is judged by that check's child, which ages like a `sleep`.
   - **A definitely absent GUI lock** reads as `running` for at most two wakes. It is either the seconds of a normal
     release or the wait before a self-release.
4. **The owner's action.**
   - When both locks are still held, the owner runs `gui-lock.sh release`.
   - When the GUI lock is already gone, the keeper ends itself (decision 2), and the owner need not act. If it is stalled
     instead, the owner runs `scripts/heavy-lock.sh --release <U>`.

   Who acts is otherwise unchanged: a stalled keeper of the other project goes to the user, and only its owner or the
   user ends it.
5. **What is shown.** `holding (GUI batch <batch>, until <time>)`.
   - The batch name is printable-escaped, at most 64 characters: each byte outside printable ASCII becomes `\xHH`, and a
     longer name is cut and ends in `…`.
   - The purpose, the session and any command argument are never shown (#550 H2).
   - In D312 PR 1 this appears in waiters' heartbeats. `status` arrives in PR 2 and shows the same line.
6. **Protocol and tests.**
   - The GUI-owner fields that decision 1 reads become part of the tool's protocol 1, written in `PROTOCOL.md`. Changing
     them needs a protocol bump.
   - ADR-0135 decision 7's owner record gains `uid` and `pgid`.
   - ADR-0135 decision 8's tests set `MDPRO_HEAVY_LOCK`, a temporary `HOME`, and `HEAVY_LOCK_TEST=1` with a private
     `HEAVY_LOCK_GUI_LOCK`. They never set only `MDPRO_HEAVY_LOCK`.
7. **Constants and phase.**

   | Constant | Value | Override |
   |---|---|---|
   | `HOLD_MAX`, the hold cap | 120 min | `HEAVY_LOCK_HOLD_MAX_MINUTES`, test-only (`HEAVY_LOCK_TEST=1`) |
   | `HOLD_GRACE`, the hold grace | 15 min | `HEAVY_LOCK_HOLD_GRACE_SECS`, test-only |
   | `HOLD_ARM`, the arming limit | 5 min | `HEAVY_LOCK_HOLD_ARM_SECS`, test-only |
   | wake period | 60 s (today's keeper `sleep`) | `HEAVY_LOCK_KEEPER_WAKE_SECS`, test-only |
   | GUI lock path | `$HOME/.cache/desktop-gui.lock` | `HEAVY_LOCK_GUI_LOCK`, test-only |

   **D312 PR 1** builds all of this in legacy mode, together with ADR-0135 decision 7's stall mark for ordinary holders,
   in waiters' heartbeats. **PR 2** builds new mode and `status`. picsee adopts the same rule when it adopts the tool.

## Consequences

- **Gained.**
  - A healthy GUI batch raises no stall alarm in either project.
  - A keeper whose GUI lock is gone ends itself within about two wake periods, and the next heavy job is not held up.
    This needs no clock and no file in the lock directory.
  - A keeper too stuck to wake shows `stalled` two wake periods after its last `sleep`, without the waiter remembering
    anything.
  - `--hold` keeps its interface, so no caller changes and no version skew arises.
- **Costs.**
  - Every heartbeat and `status` does more work. It reads the GUI owner, re-reads the keeper's identity, and lists its
    process group with the newest `sleep`. That is a few `ps` calls per waiter per minute.
  - The keeper gains a check on every wake, run as a child process with a timeout. It now ends itself on evidence it reads from another tool's lock, so a
    `gui-lock.sh` that renames or moves its lock would make every keeper release itself early. That is why those fields
    become protocol 1.
  - `--release` becomes idempotent, so a mistyped label also exits 0. `gui-lock.sh` always passes its own `U`, and
    `--release` never signals a lock that `U` does not own.
  - **The overrun alarm and the stuck-keeper reading use the wall clock.**
    - A batch that honestly overruns, or runs past 2 h 15 min whatever it declared, shows `stalled` while still live.
    - A wall-clock step moves that alarm by the size of the step: a forward step raises it early, and a backward step
      delays it.
    - The stuck-keeper reading uses `ps` elapsed time, which a wall-clock step also moves. A large backward step can delay
      it, and a large forward step can raise it early.
    - Self-release uses no clock: it counts the keeper's own wakes.
  - D312 PR 1 grows. It must build ADR-0135 decision 7's stall mark (no deferral), this state, the keeper's check and
    self-release, the `--release` success path, and these tests:
    - each condition failing on its own;
    - a dead GUI-owner pid that is still `holding`;
    - the window boundary;
    - both clock directions on the overrun alarm;
    - a project mismatch;
    - a forged keeper owner whose group holds a real job;
    - a delayed admission that does not shorten the window;
    - self-release after two wakes, with no release on a single read error;
    - the never-armed release;
    - a normal release racing a self-release, both before and after the lock is removed, exiting 0 in either order;
    - a failed log append that still releases;
    - an unarmed keeper whose owner is unreadable or for another acquisition at `HOLD_ARM`: no release, `stalled`;
    - a check that hangs, judged by its child's age;
    - a malformed or foreign GUI owner never printing its purpose, its session or a raw argument in a heartbeat;
    - a stopped keeper reaching `stalled`;
    - a release after a self-release leaving no lock directory, so the next `--hold` succeeds.
- **Foreclosed.**
  - Holding the heavy lock idle with no GUI lock. Any future idle-hold use needs its own ADR, not `holding`.
  - A keeper that outlives its GUI lock by more than a few wakes.
