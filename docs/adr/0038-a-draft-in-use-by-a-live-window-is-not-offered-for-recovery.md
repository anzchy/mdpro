# 0038. A draft in use by a live window is not offered for recovery

**Status**: Accepted (2026-09-26); partially superseded: decision 4 (refusal when the file is open only in the calling window, and the silent row drop) by [ADR-0127](0127-recover-merges-into-a-tab-of-the-calling-window-and-an-in-use-refusal-is-told.md)

## Context

Every mdpro window, on mount, calls `cleanup_old_drafts` and then `list_drafts`,
and shows a *Recover drafts* dialog from that snapshot (D27, `src/App.tsx`
mount effect). Drafts are keyed by document id alone. A file-backed id is a
hash of the raw path, so every window shares one draft per path. A bundle
records nothing about which window, or which run of the app, is using it.
Recovery bypasses both the open route (ADR-0033) and the reopen guard
(ADR-0028). It builds a document and upserts it into the window's store
directly.

Reading the code on 2026-09-26 showed three paths that were worse than a
stale list:

- **(b)** Discard in window B deletes a draft that window A recovered and is
  still editing. A keeps its buffer but has no crash protection until its next
  autosave.
- **(c)** Recover in B of a draft whose document is open and dirty in A
  succeeds, because A's autosave resets `recovered` to false. The same file is
  then dirty in two windows. Both windows write one bundle, either save
  overwrites the file, and that save deletes the draft the other window still
  depends on. A *fresh* listing in a newly opened window produces this too, so
  it is not only a staleness bug.
- **Cleanup**: `cleanup_old_drafts` runs on every window mount. It deletes
  recovered bundles whose `last_modified` is more than 7 days old, and
  recovery does not refresh that timestamp. Opening window B can therefore
  delete the old draft that A has just recovered.

A stale Recover after a Discard fails with `NotFound`. That is cosmetic: no
path was found that brings back content the user had discarded.

The shadow store knows which documents are open in which window, but it is
best-effort. Content syncs are debounced, and a failed sync is not retried
(ADR-0033). It cannot be the only guard.

Codex was consulted on the design. It recommended owner metadata, a check in
Rust at click time, a separate guarded discard command, and cleanup that
skips drafts still in use. The owner design was corrected in review: window
labels are not unique across runs (`main` recurs), so a label alone would make
a draft left by a crashed earlier run look live forever.

## Decision

1. **A draft bundle records its owner**: a per-launch session id plus the
   window label. `save_draft` stamps the calling window, and so does a
   successful recovery. Bundles without an owner still load, with the owner
   absent.
2. **"Live" is decided by one pure rule.** The owner is live if its session id
   is the current process's and its label is an existing window. A draft whose
   id or path is open in any window's shadow-store entry is also treated as in
   use; path comparison follows ADR-0033's `same_file`.
3. **Listing hides drafts in use.** A recovered draft whose owner is dead is
   listed again. That is the case of a crash after recovery but before the
   next autosave. A recovered draft with no owner keeps today's behaviour and
   is hidden.
4. **Recover and the dialog's Discard re-check in Rust at click time**, under
   one process-wide draft lock held from the check until the write or delete.
   A draft in use is refused with a typed error, and the UI drops the row
   without upserting anything. Discard in the dialog gets a new guarded
   command. `delete_draft` keeps its semantics, because a successful save
   deletes its own draft while the document is still open.
5. **Recovery refreshes `last_modified`, and cleanup skips live-owned
   drafts.**

## Consequences

- The paths that lost crash protection and duplicated documents, (b) and (c),
  are closed at the point of action, not only in the list.
- **The bundle format gains a field.** Older builds ignore it when reading, but
  a draft written by an older build has no owner. For those drafts the
  shadow-store check is the only guard, and that check is best-effort.
- **Two IPC contracts change.** `DraftError` gains variants the frontend must
  handle, and a new command is added. `recover_draft` now needs the calling
  window.
- **A draft lock now serialises draft operations across windows.** Operations
  are short file reads and writes, but a slow disk now stalls every window's
  draft actions, not just one.
- **Given up for now:** focusing the window that holds the document instead of
  refusing; a `drafts:changed` broadcast that would refresh stale dialogs
  (they still show dead rows until clicked); and per-window draft ids. The
  dialog still appears in every new window whenever unowned drafts exist.
- There is no automated cross-window test. That needs the app lane
  (ADR-0034), so device checks stand in for it.
