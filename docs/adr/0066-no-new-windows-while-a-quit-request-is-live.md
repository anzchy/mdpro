# 0066. No new windows while a quit request is live

**Status**: Proposed (2026-10-10, taken while fixing D74 under the branch audit
MoSCoW pass; awaiting user acceptance). Narrows the window set that
[ADR-0035](./0035-a-window-that-answered-the-quit-prompt-is-re-checked-before-commit.md)
re-checks; does not supersede it.

## Context

D74 (row in
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](../plans/20260912-frontend-backend-sequencing-order.md#d74))
came from the 2026-10-09 branch audit. A quit request snapshots its windows
when it begins (`quit_guard/request.rs`). The phase-1 ask, the phase-2 prompt
and the ADR-0035 backstop all iterate that snapshot. A window opened after the
snapshot — New Window, or a Finder open of a file that is not already open —
is never asked, never prompted and never drafted, so edits made in it while
another window shows the unsaved-changes prompt are lost at the commit.

The forces as understood at the time:

- Two fixes were on the table: **enrol** late windows into the live request,
  or **refuse** to create them while it is live.
- Enrolling means reopening phase 1 mid-prompt: a new round, a new ask, and
  re-ordering the one-dirty-window-at-a-time prompt queue. The coordinator's
  state machine has no such transition, and every new one has cost a defect.
- `WebviewWindowBuilder::build` blocks on the main thread, where
  `applicationShouldTerminate:` takes the coordinator mutex. Holding the mutex
  across a build can deadlock, so neither fix can be fully atomic.
- A quit prompt is short-lived and modal in intent; the user is mid-decision.

## Decision

1. While a quit request is live — any phase, the ADR-0027 native alert
   included — `create_window` returns `window_refused_quit_pending`, and the
   external-open route refuses a file that would need a new window
   (`file.open.route` outcome `refused-quit-pending`).
2. Opening a file that is already open still focuses its window; broadcast
   events are unchanged. Creation works again as soon as the coordinator drops
   the request (commit or cancel).
3. The gate is read under the coordinator lock, the lock is dropped, then the
   window is built (`quit_guard/window_gate.rs`). No effect runs under the lock.
4. The frontend maps the refusal to `null`: New Window does nothing, with no
   error toast, and logs `window.create` cancelled with `reason: quit_pending`.

## Consequences

- The snapshot stays complete for every window created through these two
  paths, so ADR-0035's backstop covers every window that can hold edits.
- **Cost:** New Window is silently inert while the prompt is up; nothing on
  screen says why.
- **Cost:** a Finder open of a new file during the prompt is dropped, not
  queued. It is logged, not toasted; the user must open it again after
  cancelling the quit.
- **Cost:** a residual race remains. A quit that begins between the gate check
  and the build still misses that window, exactly as before D74. Closing it
  would need enrolment or building under the lock, both rejected above.
- Forecloses enrolment as the default answer for late windows; a future need
  to keep windows opening during quit writes a new ADR that supersedes this one.
