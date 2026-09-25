# 0035. A window that answered the quit prompt is re-checked before the commit

## Status

**Accepted** (2026-09-25), after the implementation (`68d4648`) passed its
device criterion on the release bundle
(`docs/test/20260925-d26-gui-acceptance.md`). That run covered the background-tab
re-prompt, the cap, the draft that survives, and a cancel on a re-prompt. This
record is now immutable. Freezing settled windows (decision 6) is re-opened by a
new ADR, not by editing this one.

**Proposed** (2026-09-24). The choice between this record and the rejected
"freeze settled windows" alternative was put to the user on 2026-09-24 and
decided in favour of the re-check; see *What it foreclosed and why*. It stays
Proposed until the device criterion at the end of *Consequences* has run.

Closes **D26** on
`docs/plans/20260912-frontend-backend-sequencing-order.md` once implemented.
D26 is what currently forbids D16 from being recorded as complete, so this
record is on D16's critical path rather than beside it.

Builds on [ADR-0025](./0025-app-quit-is-deferred-through-a-native-terminate-hook.md)
(two-phase coordinator), [ADR-0027](./0027-a-quit-ack-timeout-draws-a-native-alert.md)
and [ADR-0029](./0029-quit-deadlines-bound-machine-progress-not-people.md)
(deadlines bound machines, not people). None of them is changed by this record.

## Context

The quit coordinator asks every window whether it is dirty (phase 1), then
prompts the dirty ones **one at a time** (phase 2), then commits. A window that
answered is `Settled` and is never asked again — `coordinator.rs:96`,
`(Status::Pending, Answer::Clean) => Status::Settled`.

Nothing stops that window from being edited afterwards. The facts below were
each read from the code, not inferred from the audit report
(`.cc-suite/audits/audit-fix-20260923-153716-findings.md`, finding 1, graded
Critical):

- `handleRequested` (`src/hooks/useQuitGuard.ts:133-138`) replies and returns.
  It sets no latch, disables no editor, and raises no dialog. The window is as
  editable one second after answering as it was before.
- The gap is **unbounded by design**. ADR-0029 deliberately removed the deadline
  once a prompted window acks `delivered`, precisely so a person may read the
  dialog for as long as they like. Every second of that is a second in which
  another window accepts edits nobody will re-read.
- At commit, the coordinator replies YES to `NSTerminateLater` without
  consulting any window. The process dies with those edits in memory.

**The draft autosave is not the backstop it looks like.** `useAutoSave`
(`src/hooks/useAutoSave.ts:15-50`) drafts **only the active document**, no more
often than every 5 s, and at 30 s by default (`src/stores/editorStore.ts:171`;
preferences never load from Rust today, so 30 s is what ships). Therefore:

| Edit made after answering | Outcome |
|---|---|
| In a **background tab** of the settled window | **No draft is ever written. Silent, total loss.** |
| In the active tab, younger than one tick | **Silent loss.** |
| In the active tab, older than one tick | A draft survives; the user meets a *Recover drafts* dialog on next launch |

Even the third row is recovery, not a save: the user answered "nothing of mine
is unsaved", and is then asked to recover something.

Two further constraints shape what may be decided here:

- **The real-device evidence is blind to this path.** R1–R6
  (`docs/test/20260923-d16-gui-acceptance.md` and the BLOCK-1 re-run) are all
  "answer → immediately obeyed". No round edited a window after it answered.
  Whatever is chosen here needs its own device criteria; the existing passes
  transfer nothing.
- **A stuck quit currently has no escape.** ADR-0030's menu escape hatch is
  still unimplemented (`menu.rs:126`, audit finding 2), and a second ⌘Q is
  provably a no-op while `NSTerminateLater` is outstanding. Any decision that
  makes windows unusable for the duration of a quit inherits that risk.

## Decision

**1. The coordinator re-asks every settled window immediately before it
commits.** The re-check is the phase-1 question already implemented
(`app:quit-requested` → `assess` → `clean` / `dirty`), reused rather than
reinvented, so it flushes pending editor state through `assessWindowUnsaved`
exactly as the first round does.

**2. A window that now answers `dirty` re-enters the phase-2 prompt queue.**
The user gets the prompt they would have got had they made the edit earlier.

**3. Each window may be re-prompted at most once per quit request.** Without a
cap, a window edited during every round starves the quit, and an app that
cannot be quit is a worse defect than the one being fixed. The cap makes the
worst case `N windows × 2 prompts` and guarantees termination.

**4. Before the YES, every document still dirty in any window gets a draft
written — not only the active one.** This is the backstop for the residue
decision 3 leaves behind, and for a window that is edited between its second
answer and the commit. The draft gate stays closed to *autosave*; this one
writer runs inside the commit, before the discard list is deleted, so a
document the user chose to discard is not resurrected by it.

*Correction (2026-09-25, while Proposed, after implementation review).* "Not
resurrected" holds only for a discarded document the user has **not** edited
since. A document discarded and then edited again — its window already capped,
or the edit landing after the last re-check — is drafted by the backstop, and as
first built the commit then deleted that draft because the id was still on the
discard list, losing the newer edit with nothing in the log to show it. The
`drafted` reply now names those documents in `documentIds`; Rust honours an id
only if that same window discarded it, and drops it from the delete list only
when no other window's discard of it stands. `app.quit.commit` counts them as
`undiscarded` — a count, never the ids. The newer edit wins over the older
discard.

**5. A failed draft write does not strand the quit** (ADR-0025 §4). It is
logged as `app.quit.commit` `status: fail` with counts only, and the quit
proceeds. Stranding the app on a failed backstop trades a bounded loss for an
unbounded one.

**6. This decision is re-openable when ADR-0030 ships.** Freezing settled
windows is the stronger fix — it removes the class instead of narrowing it —
and it was rejected here only because a frozen window plus a stuck quit is
today an unrecoverable app. That argument expires with the escape hatch.

## Consequences

**What it gives up.**

- **The defect is narrowed, not eliminated.** An edit made after a window's
  second answer, or between the last re-check and the YES, is still not
  prompted. It is recoverable via decision 4 rather than lost, which is a
  weaker guarantee than "never loses an edit".
- **Quitting gets slower and more talkative.** Every quit now pays an extra
  round trip per window, and a user who edits after answering is asked twice.
  A prompt that appears a second time will read as a bug to someone who does
  not know why.
- **The commit phase gets longer and gains a failure mode it did not have.**
  Writing drafts for every dirty document across every window happens while
  `NSTerminateLater` is outstanding. The backstop has its own 2 s deadline,
  and when it expires the quit **commits** with the missing windows counted
  (`draftMissing` in `app.quit.commit`, status `fail`) rather than routing to
  ADR-0027's alert. A slow disk therefore costs up to 2 s of quit latency and
  some drafts, not a native alert.

  *Correction (2026-09-24, while Proposed, before implementation).* This
  bullet first said a slow disk "has a new way to reach" the ADR-0027 alert.
  Design review rejected that routing: the alert's Quit Without Saving drops
  every discard the user already accepted (ADR-0027 §5), so sending a slow
  disk there would turn a partial draft loss into a wholesale one. The
  deadline commits instead.
- **More state in the coordinator.** A per-window "already re-prompted" bit
  must be carried on the request and cleared with it. The exhaustive domain
  runner (`coordinator_domain_tests.rs`) has to grow the re-check transition,
  or it will keep reporting full coverage of a machine it no longer models.

**What it foreclosed and why.**

- **Freeze settled windows** (make them read-only until the quit resolves).
  Correct by construction, and the right end state. Rejected **for now** only
  because ADR-0030's escape hatch does not exist: a quit that wedges would
  leave every window read-only with no way back. Decision 6 keeps this open.
- **Do nothing and document it.** Rejected: the loss is silent, and for a
  background tab it is total. The audit graded it Critical, and the project's
  own posture is "no write the user cannot see the result of".
- **Re-check without a cap.** Rejected under decision 3: livelock.

**What must still be proved on a real device.** The automated lanes cannot
reach any of this — the repo has no integration lane, and jsdom has no second
window. At minimum: two windows, one answers `clean`, it is then edited in a
**background tab** while the other window's dialog is up, and the quit must
prompt it. Until that runs, this record stays Proposed and **D16 stays
incomplete**.

## Not decided here

- ADR-0030's escape hatch (audit finding 2) — its own work item.
- Audit findings 3, 6, 7, 10, 13 and 17, which are separate behaviour choices
  in the same subsystem.
- Whether `useAutoSave` should draft non-active documents in general. That is a
  draft-recovery question; decision 4 is scoped to the commit path only.
