# 0081. External changes are kept per document, and an open reports a change since its read

**Status**: Proposed (2026-10-12, mdpro-a6, for D171 and D111). The user chose
「让 Codex 权衡」 on 2026-10-12. Codex reviewed the options (thread
`01a12dc4-f5f2-7fd2-a00d-e672e192c1fa`) and recommended A for the open path
plus E's retention mechanism. mdpro-delegator ruled the same day: "A +
E-retention, not E's register-side broadcast". Acceptance is relayed by
mdpro-delegator. If accepted, this record partially supersedes
[ADR-0068](0068-file-watcher-drops-metadata-and-content-events-when-the-file-is-unchanged.md):
its Consequences limit "The first write after open can be missed" is closed,
and its limit "Racing refreshes are unordered" is corrected.

## Context

The Rust watcher and the frontend disagree about what an emitted change means.
When the route emits `file:changed` for a path, it also runs
`refresh_if_present` (`file_watcher_route.rs`). The baseline then holds the
external bytes, and later events are compared against them. As far as Rust is
concerned, the change has been delivered. The frontend delivers it only if
the path is the active document's: `useFileWatcher` subscribes for the active
path alone and drops every other path as `other-path`, and it tears the
subscription and its 300 ms debounce down on each tab switch. Nothing
re-checks a file when its tab is activated. So:

1. **D171 (MUST).** Tabs X (active) and Y are open. Another program rewrites
   Y, and the event is dropped. The user switches to Y, which still shows the
   old text, edits it and presses ⌘S. The external change is overwritten, and
   no prompt appears at any point.
2. **D111 ②, ADR-0068's limit "The first write after open can be missed."**
   A write that lands between the open's read and notify registering
   produces no event. A seed check after `register_seeded` could detect it,
   but an emit from inside `open_file` fires before the frontend has
   committed the document. At that moment nothing in the frontend owns the
   path.
3. **D137** (catch-up after an FSEvents restart) emits mostly for open files
   that are not active, so today almost all of its emits would be dropped.
4. **D111 ①, ADR-0068's limit "Racing refreshes are unordered" is
   mis-stated.** It says a stale hash "only fails the next comparison, so the
   cost is a prompt". That is false. Suppose a `refresh_if_present` that read
   the pre-save bytes A lands after `refresh_after_save` stored B. It has the
   same generation, so `put_if_present` accepts it and writes A back. A later
   exact-stat restore to A is then dropped as unchanged, because
   `is_unchanged`'s final check compares only the generation. ADR-0068 is
   Accepted, so its body cannot be corrected in place.
5. **D111 ③.** A fail-open `modified` can be swallowed by the debounce. Since
   D116 that happens only after an earlier emitted `modified` on the same path
   within 500 ms. That emit already prompted, and Reload reads the disk at
   click time.

D165's `useReloadPrompt` already binds the prompt to a document id. The save
path, however, goes straight to `save_file` and never asks whether a change
is pending.

## Options considered

- **A. Report a change since the read in the open's reply.** Add
  `changedSinceRead` to the `open_file`, `open_file_dialog` and Save As
  replies. This is deterministic for the open path and correlated with that
  read, but it changes an IPC contract. On its own it leaves (1) and (3).
- **B. Delayed re-check in Rust**, then emit. Needs no frontend change, but
  it depends on timing, and its emit is still dropped when the file is not
  active.
- **C. Emit from `watch_seeded` synchronously.** This reaches the user only
  when the reopened file is already active.
- **D. Record, don't fix.** Keep both limits. This option has no answer for
  (1), which is MUST.
- **E. A per-path frontend cache fed by a register-side broadcast.** An event
  of `{path, changeType, newPath, timestamp}` identifies neither the read nor
  the document lifetime it belongs to. If reopening clears the cache, a new
  change can be lost; if it keeps the cache, an old change can prompt after it
  was already read in. Codex rejected the broadcast half.
- **A + E-retention (chosen).** E's per-document retention fixes (1) and (3).
  A's reply field fixes (2) without an event racing the frontend's commit.

## Decision

**A + E-retention.**

- **Retention (D171, frontend).** Each window has one `file:changed`
  listener for its whole lifetime. The listener records an event at once
  against every open document whose path matches. Records are keyed by
  document lifetime and carry a sequence number; the path is only the lookup
  index. Only the prompt's presentation is debounced, never the recording.
  - **Activation:** activating a document shows its pending change through
    `useReloadPrompt` and does not consume it.
  - **Close:** removes only that document's record.
  - **Save As:** retires the old path's record once the new path is applied.
  - **Reload:** on success, clears only the sequence it reloaded; on failure
    it keeps the record.
  - **Ignore:** acknowledges only the displayed sequence.
  - **Save:** re-checks for an unresolved pending change when the queued save
    is about to call `save_file`, and does not write while one is pending.
- **Open-time check (D111, Rust + IPC).** `changedSinceRead: boolean` is
  added to the open and Save As replies.
  - **The comparison:** a coherent fresh read is compared with the **seed
    passed to `watch_seeded`**, not with the current baseline, which a notify
    callback may already have refreshed.
  - **Fail-open:** a missing hash, an unstable read or a failed read counts as
    changed.
  - **The baseline:** the probe never advances the baseline, and it never
    restores the seed over a newer legitimate refresh.
  - **Logging:** `watch_seeded` keeps its one log line, which gains a
    `seedCheck` field.
  - **The frontend:** attaches the flag to the document the open guard
    actually committed (an open can focus an existing dirty document without
    installing the read) and feeds it into the retention store.
- **ADR-0068.** Limit "The first write after open can be missed"
  (:227–230) is closed by the open-time check. Limit "Racing refreshes are
  unordered" (:216–219) is corrected to: a stale refresh can store
  pre-save bytes at the current generation, so a later exact-stat restore to
  those bytes is dropped as unchanged; the cost is a lost prompt, not an extra
  one. It stays a recorded limit: advancing the generation in
  `put_if_present` would risk a prompt storm. Decision 4 (when the baseline
  advances) gains no exception, because nothing here emits without advancing
  it: the open-time check emits nothing, and retention changes only the
  frontend.
- **③** stays a recorded limit with no code change. Letting a fail-open
  result bypass the debounce would admit "maybe changed" where "definitely
  changed" is held back. It would also add prompts from the torn reads of the
  app's own saves.

## Consequences

- **Gained:** a change to a file in a background tab prompts when the tab is
  shown, and ⌘S cannot overwrite it unseen. A write between an open's read and
  registration is reported to that open. D137's catch-up emits become useful.
- **Cost: an IPC contract change.** Three replies gain a field. The Rust
  replies and the TypeScript types must change together, and any caller that
  ignores the field keeps the old gap.
- **Cost: frontend state with lifetimes.** A store, a window-lifetime
  listener and a save-time check replace a single hook. Each lifecycle edge
  (activation, close, Save As, Reload, Ignore, save) is a place where the
  record can be wrongly kept or wrongly cleared, and each needs a test.
- **Cost: a save can be refused.** With a pending change, ⌘S, and a queued
  save, show the prompt instead of writing until the user reloads or ignores.
  That is deliberate, but it is a new way for a save not to happen.
- **Cost: conservative prompts.** A boolean is not a file revision. A write
  after the open-time check but before the frontend commits is caught by
  retention, so the same change can prompt twice, and a fail-open read
  prompts for a file that did not change.
- **Not covered: two windows on one path (D173).** The Rust watch list has no
  owner count, closing the file in one window unwatches it for both, and
  one window's save is treated as a self-write for every window. Retention
  cannot repair events that are never emitted. D173 owns that.
- **Forecloses:** a frontend that drops events for documents it is not
  showing, and a save path that writes without asking whether a change is
  pending.
