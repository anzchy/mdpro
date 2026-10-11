# 0072. A replaced watched file is checked like a content change

**Status**: Proposed (2026-10-10). The coordinator approved the design for
D68 + D101. It becomes Accepted after the watcher device recheck (D86 WI-5),
which covers D32, D68 and D86 together. It builds on
[ADR-0068](0068-file-watcher-drops-metadata-and-content-events-when-the-file-is-unchanged.md)
and does not change it.

## Context

- **D68, confirmed on a device on 2026-10-10.** An external editor that saves
  by writing a temporary file and renaming it over the document gets no
  prompt at all. The watch is non-recursive on the file itself. notify 6.1.1's
  FSEvents backend reports that rename as one `Modify(Name(Any))` event with
  one path. It never pairs the two sides of a rename. `process_event` dropped
  every single-path rename (`IgnoredRenameSinglePath`) and every `Create`
  (`IgnoredKind`). A later ⌘S then silently overwrote the external edit.
- **D101.** mdpro's own ⌘S saves the same way (`atomic_write`: a temporary
  file, then a rename). Its rename events arrive with `ownEvent:false`.
  notify never sets `MarkSelf` on macOS (`fsevent.rs:275`), so own and
  external renames carry identical events. The D86 ⌘S×20 probe showed all
  40 events as `ignored_rename_single_path`. Fixing D68 alone would make
  every ⌘S prompt.
- **Two constraints.** The self-write mark (`file_watcher_gate.rs`) is
  cleared about 12 ms before FSEvents delivers. It cannot tell the two cases
  apart either. After each save, `refresh_after_save` stores the hash of the
  bytes that mdpro wrote. That hash is the one thing that does tell them
  apart.

## Decision

1. A single-path `Modify(Name(_))` event, in any rename mode, or any `Create`
   event, is treated as a **replaced file** while its path still exists.
   It is routed like a content modification: the self-write check, then
   ADR-0068's `is_unchanged`, then the debounce. If it is emitted, it is
   emitted as `modified`, and the baseline is refreshed.
   - **Own ⌘S:** the event is `SelfWrite` inside the mark. After the mark it
     is `IgnoredUnchanged`, because the baseline already holds the written
     bytes.
   - **External replace with different bytes:** the event is
     `EmittedModified`.
2. The IPC contract does not change. No `selfSave` field and no new outcome
   are added. The frontend already handles `modified`.
3. If the path is gone (the file was moved away), the event is still
   `IgnoredRenameSinglePath`. A `Create` on a missing path is still
   `IgnoredKind`. Two-path renames are unchanged.
4. D101's acceptance is restated to match this decision. Before: "⌘S
   renames are `ownEvent:true`". Now: "own ⌘S is classified as own
   (`ignored_unchanged`, or `self_write` inside the mark) and does not
   prompt; an external `mv` of different bytes emits `modified`."

## Consequences

- **Gained:** an atomic external save prompts. Own saves still do not
  prompt. No frontend change is needed.
- **Cost: an exact restore is silent.** An external replace is
  `IgnoredUnchanged` only when its bytes and its full-precision mtime and
  size all equal the baseline, for example `cp -p` followed by `mv`. Reload
  would load nothing new. An identical-bytes replace with a new mtime, the
  usual case, still prompts once. That prompt is spurious, but no change is
  lost.
- **Cost: a replace inside the own-save mark is suppressed.** An external
  replace that lands during mdpro's own write and refresh is `SelfWrite`.
  The window is a few milliseconds.
- **Closed by D112: an own save with no stored hash.** Decision 1 keeps own
  ⌘S quiet only when `refresh_after_save` stores the hash of the written
  bytes. It used to re-read the file and store no hash when (1) the
  document was over the 10 MiB hash cap, or (2) the post-save read was
  unstable or differed from the bytes written; the own rename was then
  `EmittedModified`, hidden only by the frontend's 3 s save-suppression
  window. Since D112 it stores the hash of the written bytes, uncapped,
  without a read, and the path's on-disk stat taken after the rename; since
  D129 that stat is stored only when its size equals the written length,
  and is `None` otherwise. `is_unchanged` reads up to the stored size when
  that is over the cap. Only a save (`refresh_after_save`, or the Save As
  seed since D69) can record such a size with a hash, and the size it
  records is always the written length (D129), so entries from a register
  or a refresh keep the cap.
- **Cost: an own save whose event-time check fails open is reported as
  external.** `is_unchanged` still needs one stable read that hashes to the
  stored value (ADR-0068 decision 3). If that read fails, or is torn by a
  metadata change (an xattr or Spotlight write in the same instant), the own
  rename is `EmittedModified`. This is kept on purpose: dropping on stat
  alone, or retrying, would give up "drop only on proven-equal bytes". Once
  D86 WI-4 removes the 3 s window, this residual is **user-visible as an
  "External change detected" prompt on the user's own save**. It is rare and
  loses nothing (Reload loads the bytes just saved). The `file.watch.event`
  log line says which case it was: its `unchangedCheck` field is
  `read_failed` or `unstable` here, and `stat_differs` or `hash_differs` for
  a real external change (D112-WI-2).
- **Cost: two more ways an own save shows as external, or goes unseen.**
  (a) The post-save stat fails, or (since D129) its size is not the written
  length because another writer replaced the file after our rename. The
  entry then has no stat, so the check answers `no_baseline` and the own
  rename emits; in the second case the event is the other writer's change
  too, so the prompt is right. (b) The per-path debounce (500 ms,
  `file_watcher_gate.rs`) runs only after a check that did not answer
  `unchanged`, so an own rename that passes the check is never debounced.
  One that fails open within 500 ms of an earlier emit for the same path is
  `Debounced` rather than `EmittedModified`: the false prompt is suppressed
  and the log line keeps the check's reason. The converse also holds: an own
  rename that does emit opens a 500 ms window in which a failed-check
  external event for that path is `Debounced` and does not advance the
  baseline, so the prompt the own rename raised is the only one.
- **Cost: one more stat, plus a read.** Each replaced-file event stats its
  path. Every checked event with a stored stat and hash then reads the file
  once, up to ADR-0068's 10 MiB cap or the size a save recorded (D112), plus
  one byte, before it compares anything. A stat that differs from the
  baseline skips only the hash, not the read. Each save also hashes its own
  bytes once. Measured on 10.5 MB / 20 MiB: about 2–4 ms per save (on the
  save command) and 4–7 ms per check (on the watcher thread) in a release
  build; 60–80 ms each in a debug build.
- **Limit: a large saved document is read whole on every event.** A save
  has no `MAX_FILE_SIZE` check, and the save path hashes the written bytes
  uncapped by design (D112), so the stored size lifts the read cap for that
  path. A saved document of tens of MB costs a full read plus a hash on
  every watcher event for it. This is recorded, not fixed.
- **Note: two `unchangedCheck` values that look wrong but are not.** A plain
  `Remove` logs `not_checked`: the route runs the check only for a replaced
  file or a filtered kind (`file_watcher_route.rs`). And a deleted file whose
  event path is not already the canonical spelling can log `no_entry` rather
  than `read_failed`: `baseline_key` falls back to the raw path when
  `canonicalize` fails on a missing file, and that key does not match the
  canonical one the entry was stored under.
- **Not covered: a file moved away** (D107). The document keeps its old
  path, and ⌘S recreates the file there. This is unchanged.
- **Not covered: two spellings of one path** (D106). They share or split a
  baseline, as under ADR-0068 L6.
- **Not covered: Linux.** inotify watches the inode, and after a
  rename-over it watches the old inode, so later edits go unseen. This ADR
  is macOS-first and does not re-arm the watch.
- **Forecloses:** telling own saves from external saves by event metadata.
  As long as notify gives no reliable self-marker, the content comparison is
  the only discriminator.
