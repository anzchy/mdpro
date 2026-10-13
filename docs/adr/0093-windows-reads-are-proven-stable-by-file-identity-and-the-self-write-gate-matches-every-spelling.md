# 0093. Windows reads are proven stable by file identity, and the self-write gate matches every spelling

**Status**: Accepted (2026-10-13). User decided, relayed by mdpro-delegator,
after a Codex deliberation: 「两个伴随修复 + (a) same-file」. Partially
supersedes
[ADR-0068](0068-file-watcher-drops-metadata-and-content-events-when-the-file-is-unchanged.md)
decision 3 for Windows only: there, a read is proven stable by file identity
plus `(mtime, size)`, not by ctime and inode. It also overturns D159's "off
Unix every read is unstable" (a sequencing-doc decision, never an ADR).
Amends ADR-0068 decision 1's scope: on Windows `Modify(Any)` joins the kinds
the unchanged check applies to. ADR-0068 decision 7 (no timed save window)
stands unchanged. Unix behaviour is unchanged.
Status note (2026-10-14, delegator, body unchanged): the Consequences
bullet saying WI-5 folds `strip_verbatim` into `path_plain` did not happen.
They stay separate because the gate key is compared, never used for I/O,
while `simplify_verbatim` must keep reserved names verbatim
([D190 row](../plans/20260912-frontend-backend-sequencing-order.md#d190)).

## Context

D190 W2 (Windows audit, `docs/test/windows-audit-20261012-claude/run-notes.md`,
item 016): on Windows every save raised "External change detected".
`atomic_write` renames a temp file over the document. notify 6.1.1 drops the
temp's events (it watches a single file) and maps ReadDirectoryChangesW's
answer for the target to `Remove(Any)` then `Modify(Name(To))`. The device
log showed the `Remove` inside the save mark (`self_write`) and the
rename-to after it with `unchangedCheck=unstable`, emitted as `modified`.

The forces as understood on 2026-10-13:

- **The unchanged check could never say "unchanged" on Windows.** D159
  (`b3eb3a4`, 2026-10-11) made the read compile there by setting
  `STABILITY_PROVABLE = cfg!(unix)`. That was deliberate fail-open: with no
  stable std accessor for ctime or file identity, no read was ever stable,
  no hash was stored at register, and every event that reached the check
  emitted. Its cost, "an extra prompt is better than a dropped one", turned
  out to be a prompt on every save.
- **The self-write gate is a synchronous bracket.** notify delivers on its
  own thread, so which of the save's events land inside the mark is timing.
  On macOS almost none do; the unchanged check is what really keeps a save
  silent there.
- **The gate matched by exact path.** The save marks `canonicalize`'s
  spelling, which on Windows is `\\?\C:\…`, while notify reports the
  spelling the file was watched under (`C:\…` from the Open dialog). And it
  was a set, so the first of two overlapping saves of one path unmarked the
  second (deliberation finding, device item 6).
- **Windows `Modify(Any)` bypassed the check.** notify maps
  FILE_ACTION_MODIFIED to `Modify(Any)` with no subkind, and ADR-0068
  decision 1 never listed it, so a better read alone could not drop it.
- No Windows runner executes `cargo test`. The macOS host can only run the
  Windows branches through test seams (`with_portable_proof`,
  `with_windows_kinds`). Only a Windows device check can establish the
  Windows API, NTFS, sharing and notification behaviour.

Evidence: the Codex deliberation, job `review-plan-mv65ns54-0wrsp9`, saved
at `~/.mdpro-redesign/handoff/mdpro-codex-audit-20261013-1211-d190wi2-deliberation.json`.
It ranked (e) first and (a) second, and raised the three companion findings
above.

## Options considered

- **(a) `same-file` 1.0.6 identity + `(mtime, size)`** (chosen). The read
  handle's identity is taken before the read. After the read, a fresh open of
  the path must give the same identity. `(mtime, size)` must be unchanged on
  the handle and on the fresh open. `same-file` is a safe API already in the
  dependency graph (notify → walkdir). It gives no ChangeTime and no 128-bit
  ReFS id.
- **(b) Direct `GetFileInformationByHandle` + `(mtime, size)`.** This gives
  the same protection as (a) but adds unsafe code that mdpro owns. It only
  pays off as (e).
- **(c) `(mtime, size)` only.** Rejected: it loses rename-over detection.
  Equal metadata does not show the bytes came from the file now at the path.
- **(d) Keep fail-open and suppress by saved hash in the route.** Rejected:
  safe suppression needs a coherence check, which is this same question
  again. And `refresh_after_save` already stores the written-bytes hash.
- **(e) Identity + `FILE_BASIC_INFO.ChangeTime` + `(mtime, size)` through a
  small `windows-sys` wrapper.** Codex's first choice: Windows does have a
  change time. It lost on cost: a direct `windows-sys` dependency, unsafe FFI
  that mdpro owns, and Windows-only code that `cargo test` never runs. **It
  is the contained follow-up** if the Windows device check shows the
  missing-ChangeTime gap matters.
- **(f) Deny write sharing during the read.** Rejected: it briefly stops
  other programs from opening the file for writing, which is a compatibility
  cost for a watcher. It also still needs the identity check, because
  delete sharing allows replacement.

## Decision

1. **The off-Unix stability proof is identity + `(mtime, size)`**
   (`file_watcher_baseline_read_proof.rs`). `begin` keeps the read handle's
   `(mtime, size)` and the `same_file::Handle` of a duplicate of it, i.e. a
   fresh open bound to the path. `holds` stats the handle again, then opens
   the path fresh, and needs the same identity and the same `(mtime, size)`
   on both. **Any query error fails open** (unstable, the event emits).
   **Never compare against a stored or pre-save identity:** an atomic save
   changes the path's identity legitimately. Unix keeps ADR-0068 decision 3's
   proof, bit-identical.
2. **The self-write gate matches by one normalised key, counted**
   (`file_watcher_gate.rs`). Both the mark and the event key are computed
   outside the mutex. The key is the canonical path; for a file that does not
   exist yet, its canonical parent joined with its name; failing both, the
   absolute lexical path, then the raw path. Any `\\?\` disk or `\\?\UNC\`
   verbatim prefix is then stripped. Marks are counted per key, so a path
   stays marked until its last overlapping save ends. The mark is still only
   the synchronous bracket around the write: no timed window (ADR-0068
   decision 7).
3. **On Windows `Modify(Any)` is a checked kind**
   (`file_watcher_baseline_kind.rs`), behind the same baseline check, so a
   real write still emits. Every other host keeps exactly ADR-0080's five
   kinds.
4. `same-file` becomes a direct dependency, at the 1.0.6 the lockfile
   already had; the lockfile gains only the direct edge.

## Consequences

- On Windows mdpro's own save no longer prompts, and Windows gets ADR-0068's
  unchanged drop at all: register stores a hash, and `file.watch.register`
  now logs `seeded`/`snapshot` where it logged `failopen`.
- **Accepted limits of the Windows proof** (each makes a real change look
  unchanged, so the event is dropped):
  - A writer that already held the file open writes same-length bytes during
    the read and leaves `(mtime, size)` as they were. Windows updates the
    last-write time fully only when the writing handle closes, so the writer
    need not restore the mtime itself.
  - A same-length rewrite that restores the mtime, landing between the read
    and the re-stat.

  A later notify event can repair either case but is not guaranteed:
  ReadDirectoryChangesW can overflow and discard records. (e) would narrow
  both.
- **ReFS, SMB and removable volumes:** `same-file`'s 64-bit file index is not
  guaranteed unique on ReFS. Network and removable filesystems may report
  identity or timestamps differently. Where a query fails the read fails
  open; where it succeeds with a weak id the limit above applies. Validating
  them, or explicitly restricting them to fail-open, is a device-check item.
- The gate now does a `canonicalize` (plus a parent `canonicalize` for a new
  file) per mark, per end and per `modified` candidate event. That is a few
  syscalls, all outside the mutex.
- On Unix the gate's key changes from the raw path to the canonical one. A
  mark and an event under different spellings of one file now match on
  macOS too. Unix routing is otherwise bit-identical.
- `strip_verbatim` duplicates the verbatim rule that D190-WI-5's
  `path_plain` will own. WI-5 folds it in.
- **New direct dependency:** `same-file` 1.0.6 (and through it
  `winapi-util` / `windows-sys` 0.61.2 on Windows, already resolved). Its
  MSRV is below the locked Windows floor.
- The Windows behaviour is specified only through seams on the macOS host.
  The landing condition is a windows-latest build-only run; acceptance is a
  Windows device check (the D190 row's WI-2 list).
- Documentation drift noted by the deliberation and not fixed here: ADR-0068
  decision 4 still says the save refresh reads back, but since D112 it
  stores the written-bytes hash without reading.
