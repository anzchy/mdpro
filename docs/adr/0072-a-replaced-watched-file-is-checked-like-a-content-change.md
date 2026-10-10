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
- **Cost: an own save with no stored hash is reported as external** (D112).
  Decision 1 keeps own ⌘S quiet only when `refresh_after_save` stores the
  hash of the written bytes. It stores no hash in two cases:
  (1) the document is over the 10 MiB hash cap, and such saves happen;
  (2) the post-save read is unstable, or its bytes differ from the bytes
  written. In both cases the own rename is `EmittedModified`. **Today only
  the frontend's 3 s save-suppression window hides this.** D112 closes it,
  and it is a hard precondition of removing that window (D86 WI-4).
- **Cost: one more stat, plus a hash read.** Each replaced-file event stats
  its path. When the baseline's stat matches, it also hashes the file, up to
  ADR-0068's 10 MiB cap.
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
