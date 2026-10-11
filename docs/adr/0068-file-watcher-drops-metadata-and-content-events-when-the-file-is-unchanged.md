# 0068. The file watcher drops metadata and content events when the file is unchanged

**Status**: Accepted (2026-10-11; proposed 2026-10-09; scope amended 2026-10-10). The combined watcher device regression on `819fa2c` passed ([record](../test/20261011-watcher-819fa2c-device-check.md)).. The user approved
the first draft on 2026-10-09 after a Codex review: findings 1, 2, 3 and 6
were adopted, and 4 and 5 went to D68 and D69. On 2026-10-10, after a probe
showed residual FSEvents flags and a second Codex review, the user chose the
widened scope below (Codex-amended option 2). Acceptance waits on the D32
device check. Drafted as 0066 and renumbered to 0068 on 2026-10-10, because
0066 and 0067 were taken on other branches first.
Amended 2026-10-10: decisions 3 and 4 (D86 WI-1..3, after the D32 mini
audit found silent-drop paths). Still Proposed; it becomes Accepted only
after the D32 + D86 device recheck (D86 WI-5).
Amended 2026-10-11: decision 7 (D86 WI-4 removed the frontend's 3 s
save-suppression window).

## Context

D32 (row in
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](../plans/20260912-frontend-backend-sequencing-order.md#d32)):
a clean, unmodified file raises "External change detected". The forces as
understood on 2026-10-09 and 2026-10-10:

- The device run
  ([record](../test/20261009-d32-d55-d56-device-check.md), R6) proved the
  mechanism.
  - Opening an already-watched file again from Finder or `open -a` makes
    LaunchServices rewrite its `com.apple.lastuseddate#PS` extended attribute.
  - FSEvents reports that as `Modify(Metadata(Extended))`.
  - `process_event` in `src-tauri/src/services/file_watcher.rs` maps every
    `Modify(_)` to `modified`.
  - `decideFileChange` (`src/utils/dataLossGuards.ts`) trusts every
    `modified` and prompts.
  - mtime and size never changed. That file was last written about 170 s
    before the re-open, and only the Extended event arrived.
- **FSEvents carries stale flags.** A probe on macOS 26.3.1 with notify 6.1.1
  (2026-10-10):
  - FSEvents accumulates a file's Create, Content and Metadata(Any) flags and
    clears them for every file on a global clock about every 30 s.
  - An xattr write reports Extended alone only when a clear fell between the
    file's last write and the xattr. With 3.5 s between write and xattr, 106
    of 120 trials also reported Content.
  - So a file saved or written up to about 30 s before a re-open gets a
    `Modify(Data(Content))` with unchanged bytes.
- **notify splits one flag set into separate callbacks**, in the order Create,
  Metadata(Any), Extended, Content (notify 6.1.1 `fsevent.rs`). mdpro ignores
  Create but maps Metadata(Any) to `modified`, so an Extended-only filter
  would still prompt on the Any or Content callback.
- Since D59 (`175df31`), recovered documents are watched too. They are always
  dirty, and Reload has default focus. Pressing Enter on the false prompt
  replaces the recovered edits with the disk text. The user holds every
  release until D32 passes its device check.
- FSEvents coalesces flags and gives no ordering guarantee. A debounced event
  can carry a real write. `file_watcher_gate.rs` therefore already refuses to
  let a debounced event refresh state.
- notify 6.1.1 canonicalises the registered path for matching, but reports the
  path FSEvents supplies (`/private/tmp/…` for a `/tmp/…` registration).
- `save_file` brackets `atomic_write` with the self-write mark. The watcher
  callback is asynchronous, so the event for our own write can arrive after
  the mark is cleared.
- Opened files are capped at 10 MiB (`MAX_FILE_SIZE`). A recovered original is
  not re-checked against that cap.

## Decision

1. **Filter in Rust, before emit, and only three kinds:**
   `Modify(Metadata(Extended))`, `Modify(Metadata(Any))` and
   `Modify(Data(Content))`. Create keeps its existing ignore. Every other
   metadata subkind (permissions, ownership, write time, access time),
   `Modify(Any)`, other data subkinds, rename and delete events are routed
   exactly as today. The check runs after the self-write check and before the
   debounce check, so a dropped event never records a debounce entry.
2. **Per-path baseline: `(mtime, size, content hash)`.**
   - mtime is the full-precision `SystemTime`, not the log's millisecond
     `mtime_ms`.
   - The hash is std's `DefaultHasher` (64-bit SipHash) over the bytes read
     from disk. It is never computed from the editor's text. No new dependency.
   - When the file is over 10 MiB or unreadable, the hash is absent.
3. **Drop rule, read coherently through one handle** (amended 2026-10-10,
   D86 ③). One of the three kinds is dropped only if all of these hold:
   - a baseline exists, with a stored hash;
   - the file is opened once; `fstat` on that handle before the read (s1)
     equals the baseline's mtime and size;
   - the bytes read through that handle (only for this candidate, capped at
     10 MiB) hash to the stored hash;
   - the read is proven stable: `fstat` after the read (s2) equals s1 in
     mtime, size and ctime, and a stat of the path (following symlinks)
     names the same device and inode, with the same mtime and size.

   ctime, device and inode are used only as proof that the read was stable.
   They are never stored in the baseline, because a LaunchServices xattr
   write moves ctime, and storing it would bring D32 back. A read that cannot
   be proven stable **fails open**: the event is emitted and no hash is
   stored. This catches a same-length rewrite that restores mtime and a
   rename-over, which the earlier stat-read-stat by path missed. A dropped
   event logs the closed `WatchOutcome` `ignored_unchanged`. In every other
   case the event is emitted as today: no stat, no baseline, a differing
   field, no stored hash, a file over 10 MiB, an unstable read, or a read
   error.
4. **The baseline advances only on these four** (amended 2026-10-10,
   D86 ② and ④):
   - `watch`, including an already-watched re-register, which overwrites it.
     When `open_file` or `open_file_dialog` registers, the entry is
     **seeded from the same single read the document was decoded from**
     (`watch_seeded`), so a write landing between the open and the watch is
     never baselined as unchanged. Other registrations (D59 recovery) take
     their own snapshot. The `file.watch.register` log line names which
     (`baseline`: `seeded`, `snapshot`, `failopen` or `stale_skipped`);
   - an event that was actually emitted as `modified`;
   - a successful `save_file` write, refreshed synchronously right after
     `atomic_write` returns and before the self-write mark clears, and only
     for a registered path, so a late self-write event compares against the
     saved bytes. The hash is kept only if the disk bytes read back equal
     the bytes we wrote. If another writer got in between the rename and the
     read, the entry keeps the stat but no hash, so that writer's event
     still emits;
   - `unwatch`, which removes it.

   Every `watch` and `unwatch` draws a ticket from one global counter while
   it holds the watch-list locks, so ticket order is watch-list order. The
   store applies a register or remove only if its ticket is not older than
   the latest one for that raw path; a remove leaves the ticket behind as a
   tombstone. So a register whose read finishes after a newer unwatch cannot
   bring the baseline back. Each entry carries the ticket that wrote it, and
   a refresh (an emitted `modified`, or a save) writes only if the entry
   still carries the ticket it read, so it never overwrites a newer
   register. Re-registering still overwrites; merging instead is a follow-up
   after D86, not a 0.3.1 blocker (user decision 2026-10-10).

   `Debounced`, `IgnoredKind`, `SelfWrite`, dropped events and failed
   lookups never touch it. That keeps the existing debounce invariant.
5. **One path identity.** The baseline is keyed by the canonicalised path, at
   registration and at lookup. If canonicalising fails, the raw path is used
   and the lookup fails open. The watch list, self-write set and debounce map
   keep their raw keys, unchanged.
6. **Rename and Save As are out of scope.** A rename emits as today and leaves
   the old baseline until that path is unwatched. The new path has no
   baseline, so it fails open. Save As registers no watch (D69). Rename-over
   external saves are D68.
7. **No IPC change; the frontend's save window is gone** (amended
   2026-10-11, D86 WI-4). The `file:changed` payload is unchanged.
   `save_file` gains a `State<FileWatcher>`, which is not visible over IPC.
   The frontend used to drop every `file:changed` for the active path for
   3 s after its own save (`SAVE_SUPPRESS_WINDOW_MS` in `useFileWatcher.ts`).
   Rust now identifies our own saves by itself, through the self-write mark
   held while `save_file` writes (`self_write`) and the baseline bound to the
   written bytes (`ignored_unchanged`), so D86 WI-4 removed that window. It
   also hid a real external change landing within 3 s after ⌘S, and Rust,
   having already advanced its baseline to those bytes, never reported it
   again (D86 ①). The user approved the removal on the condition that a
   ⌘S×20 device probe pass; it passed on `8c996b1` (18 `ignored_unchanged`,
   2 `self_write`, no own-save event reached the frontend;
   [record](../test/20261010-watcher-reprobe-8c996b1-device-check.md)).

## Consequences

- **Gained**: re-opening a watched file no longer prompts, whether it was last
  written long ago or seconds ago. A recovered dirty document no longer risks
  its edits on this false prompt.
- **Gained**: content changed with mtime and size restored is still caught,
  because the hash differs. This closes the miss an mtime-and-size-only filter
  would have opened.
- **Cost: the extra reads.** Each candidate event with equal stat reads the
  file again, up to 10 MiB. One residual burst (Any, Extended, Content) can
  read it three times, up to 30 MiB. Measured in a debug build on 2026-10-10
  (median of 5 per `is_unchanged`): 1 MiB 2.5 ms, 5 MiB 13.8 ms, 10 MiB
  26.3 ms, so a three-event burst on a 10 MiB file costs about 79 ms on the
  watcher thread, not the UI thread. These are debug-build figures and an
  upper bound; a release build was not measured.
  Each emitted `modified` and each save re-reads the file to refresh the
  hash. An emitted change makes the frontend reload anyway; a save already
  holds the bytes.
- **Cost: a content event with unchanged bytes no longer prompts.** A write
  followed by a revert to the same bytes, seen after the revert, has nothing
  for Reload to load, so it is dropped. A metadata-only change reported as
  `Metadata(Any)` (a Finder tag or comment, for example) no longer prompts
  either. Permission, ownership and timestamp subkinds still prompt, as today.
- **Cost: path variants fail open.** A registration whose case or Unicode
  normalisation differs from the FSEvents path, and that canonicalising does
  not unify, finds no baseline and prompts as today. So does a renamed
  document, a file over 10 MiB, and an unreadable file.
- **Cost: re-registering overwrites the baseline.** Suppose an external write
  was swallowed by the existing 500 ms debounce, and the file is then
  re-opened. The next residual event matches the new baseline and is dropped.
  Before this ADR, that event's false prompt happened to surface the earlier
  write. The debounce miss itself is pre-existing.
- **Gained: a real external change right after ⌘S prompts** (D86 WI-4). A
  sync client, a formatter or a `git checkout` landing within 3 s after a
  save used to be dropped by the frontend window and never re-reported.
- **Cost: an own-save event that fails open now prompts** (D86 WI-4). With
  the frontend window gone, nothing hides an own-save event that lands after
  the mark clears and whose check cannot prove the file unchanged
  (`unchangedCheck` `unstable`, `read_failed` or `no_baseline`). It raises one
  "External change detected" prompt. That is rare (none in the ⌘S×20 probe)
  and loses nothing: Reload loads the bytes just saved.
- **Cost: a 64-bit non-cryptographic hash.** An accidental collision would hide
  a real change. We accept that chance; an adversary who can write the file
  does not need a collision.
- **Cost: more shared state.** The baseline map sits under its own mutex, taken
  in the event callback, `watch`/`unwatch` and `save_file`. It is never held
  while another lock is taken, and no file I/O runs under it. Since the D86
  amendment it also holds the latest ticket per raw path ever watched or
  unwatched; those tombstones are never pruned, one small entry per path
  for the life of the process.
- **Cost: failing open on an unstable read** (D86 amendment, accepted by the
  user 2026-10-10). An xattr write, chmod or touch that lands during the few
  milliseconds of a hash read makes that event prompt once, even though the
  bytes are unchanged. Outside the read window the D32 case is still
  filtered. No unexpected unstable read appeared in the test suites except
  on a FIFO, which can never be proven stable. The device rate is measured
  by the D86 WI-5 recheck; if it is high, this comes back for discussion.
  A register or remove that lands on the path during that read also fails
  open, because the check re-reads the slot generation after the read (D109).
- **Limits found during D86 review and audit** (2026-10-10, recorded, not fixed):
  - **Racing refreshes are unordered.** `refresh_if_present` checks the
    generation but does not advance it, so of two refreshes racing on one
    path the slower one stores its bytes. A stale hash only fails the next
    comparison, so the cost is a prompt, not a dropped change.
  - **The cap bounds size, not time.** A read of a FIFO or another blocking
    file waits in `File::open` / `read` until a writer feeds or closes it,
    and holds the watcher thread while it waits.
  - **Coarse timestamps.** On a filesystem whose mtime and ctime are coarser
    than the read (some Linux setups), a same-size rewrite during the read
    can leave both stats equal and pass as stable. The tests that pin
    stability run on macOS only.
  - **The first write after open can be missed.** A write landing between
    the open's read and notify registering produces no event. The seed
    baseline (the opened bytes) catches the next write, but that first one
    never prompts.
- **Cost: the open path's read is capped.** `open_file`, `open_file_dialog`
  and `reload_file` read once, up to the cap plus one byte. A file that
  passes the size check but reads past 10 MiB (it grew, or it is a device
  behind a symlink) is refused as too large rather than read unbounded.
- **Forecloses**: deciding "did the file really change" in the frontend for this
  case. `decideFileChange` keeps trusting every `modified`.
- **Not decided here**:
  - the release hold, which since 2026-10-10 lifts only when both D32 and D68
    pass their device checks. D32's check covers:
    recovered dirty document, `/tmp` path form, re-opening an open file, and
    re-opening within 30 s of a save;
  - removing paths from the D32 diagnostic log lines, a separate commit after
    D32 is ✅;
  - H6, D68 and D69. D68 was confirmed on device on 2026-10-10: a rename
    onto a watched path arrives as a single-path `Modify(Name(Any))`, is
    logged `ignored_rename_single_path`, and never prompts. D68 is expected
    to build on this baseline to decide whether such a rename changed the
    bytes. That work is not part of this decision.
