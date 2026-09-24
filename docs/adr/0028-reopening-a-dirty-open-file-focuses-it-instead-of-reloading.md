# 0028. Reopening a file that is already open and dirty focuses it instead of reloading

## Status

**Proposed** (2026-09-23). Closes **D20** on
`docs/plans/20260912-frontend-backend-sequencing-order.md` once implemented.

**Corrected in place while Proposed** (2026-09-24), before any code: decision 2
is replaced, decisions 1, 4 and 5 are sharpened, and the entry-point table is
completed. The review that forced this, and the option rejected, are recorded
under *Correction* at the end.

**Known gaps completed after review** (2026-09-24), still while Proposed: gaps
(b)–(e) were added under *Consequences*, and decision 2 now names the id-only
shape (gap d) beside the race.

**Entry-point table corrected after GUI acceptance** (2026-09-24), still
while Proposed. The real-app run
(`docs/test/20260924-d20-gui-acceptance.md`) showed that a file sent to an
already-running app from Finder does not reach an existing window at all: it
opens a new one. The table's first row is corrected below; the scope of the
decision is unchanged, and the uncovered cross-window case is recorded as
gap (f) and as defect D29.

## Context

A document's id is derived from its path, so opening a file that is already
open produces the **same id** and `upsertDocument` overwrites the existing
entry. Three entry points do this, all in `src/hooks/useDocument.ts`:

| Entry point | Reached by |
|---|---|
| `openDocumentFromPath` | Open Recent, launch paths, the `?open=` URL param, drag-and-drop, and single-instance `file:open` — which is emitted only when `main` is the sole window. A Finder open or "Open With" on a running app arrives as `RunEvent::Opened` and always creates a **new** window, whose `?open=` load reaches this function against an empty store (gap f) |
| `openDocumentFromDialog` | ⌘O / the Open dialog landing on an already-open file |
| `openDocumentWithEncoding` | `EncodingDialog` only — shown after a read **fails to decode**; there is no reopen-with-encoding menu command today |

All three read the file, call `prepareWholesaleReplace`, then `upsertDocument`
with the freshly decoded document. None of them looks at `isModified` first.
The disk content therefore replaces the buffer and the dirty flag is cleared,
with no prompt. Unsaved changes are gone.

This predates D15 but D15 made it worse in a useful way: before it, the
WYSIWYG editor was not rebuilt, so the old content stayed on screen and the
loss was invisible until the next save. Since `wholesaleReplace` was
introduced, the editor is rebuilt and the user watches their work disappear.

Three forces pull against each other:

- **Reopening is also how a user refreshes.** A clean document whose file
  changed underneath is legitimately re-read this way. The file watcher covers
  the common case, but not a file changed while mdpro was not watching.
- **Reopen-with-encoding is not a refresh.** Its whole purpose is to re-decode
  the same bytes. Silently declining to reload would make the command appear
  broken — the user picked an encoding and nothing changed.
- **A dialog cannot ask before it reads.** `openDocumentFromDialog` only learns
  the path from the dialog's result, which already carries the decoded
  document. Any check there happens after the read, not before it.

## Decision

1. **A dirty document is never replaced by an open action.** Every open path
   **switches to the existing tab** and leaves its buffer untouched. No prompt:
   focusing loses nothing and the user's next save still writes their edits.
   This covers the **decode-failure exit too**: when a read of an open, dirty
   document fails to decode (dirty judged after the flush, as in
   decision 5), mdpro focuses it instead of showing
   `EncodingDialog`. "Never replaced" does not mean "never read" — the paths
   read first, so the check sits after the read on success *and* failure.
2. **The encoding reopen refuses, it does not ask — for now.** With decision 1
   covering the decode-failure exit, a dirty document can reach
   `openDocumentWithEncoding` only through a race (an MCP write dirtying it
   while `EncodingDialog` is open), or the id-only shape in *Known gaps* (d).
   There, it keeps the buffer, focuses the
   tab and returns an explicit refusal, never a silent success; the user is
   told by a toast. A **Discard changes and reload / Cancel** confirmation is
   deferred to the deliberate *Reopen with encoding* command, which is wanted
   and will land with its own record. It must go through the same guard.
3. **A clean document reloads, as it does today.** The behaviour change is
   scoped to the target's `isModified`. "Reopen to refresh" keeps working.
4. **One guard owns the write.** A shared helper beside `wholesaleReplace.ts`
   takes the decoded result and does, with **no `await` between steps**:
   flush → read the store through `getState()` → decide → only if allowed,
   `prepareWholesaleReplace` and `upsertDocument`. The guard runs **before**
   preparation, because preparation discards pending editor edits. It must
   run after the file read's await; a flush at entry only is not enough. The
   target is matched **by id or by path**: Save As keeps a document's id while
   changing its path, so the id alone misses it. The id match and the path
   match can be two different documents; the write happens only if **every**
   match is clean. If both are dirty, or the flush failed, the id match is
   the one focused. All three open functions,
   and the future command, write through this helper.
5. **The flush comes first**, via `assessWindowUnsaved` with a new reopen
   reason. "Dirty" is judged on the **target document only**, not on other
   tabs. If the flush fails, it is window-wide and cannot tell which buffer
   lost edits, so treat the target as dirty: refusing is the safe direction.

## Consequences

- **Gives:** unsaved work survives every open path, including the
  decode-failure exit and the encoding reopen. The protection is code, not
  prose, so a future reopen command cannot bypass it without failing a test.
- **Costs:**
  - **⌘O on a dirty file becomes a no-op that looks like one.** A user who
    reopens a dirty file *wanting* the disk content now has to discard the
    buffer first — close the tab, or reopen with the same encoding. We are
    trading a rare deliberate action for a common accidental one.
  - **A dirty file whose disk bytes no longer decode is focused silently.**
    The user is not told the file on disk changed under them; that is the
    file watcher's job, and it does not cover a change made while mdpro was
    not watching.
  - **The encoding reopen can refuse what the user just chose.** Only via
    the race in decision 2. The toast keeps it from looking like a no-op,
    but it is still a refusal of an explicit choice.
  - **The dialog still reads the file it will not use.** Wasted IO on a path
    where the check cannot come first. Harmless, but it means "we never read a
    file we are not going to open" is not an invariant we can claim.
  - **The confirmation is owed, not dropped.** The reopen-with-encoding
    command inherits the job of deciding whether to add a third dialog next
    to window-close and quit.
- **Forecloses:** treating `upsertDocument` as a safe idempotent write. Every
  caller that can land on an existing id now has to answer "what if it is
  dirty?" first. `src/utils/wholesaleReplace.ts` is the right place to enforce
  that, since it is already the single entry point for whole-buffer
  replacement.
- **Not decided here:** what a *third-party* wholesale replace should do —
  draft recovery, MCP `write_document`, and the file watcher's reload all route
  through `wholesaleReplace` too. They have their own answers (the watcher
  already prompts) and are out of scope. This record covers the three open
  paths only.
- **Known gaps, not closed here.** No data is lost in any of them; each is a
  wrong or missing focus, a dialog that should not show, or a stale label.
  - **(a) Dirtiness, not ordering.** If the user edits *and saves* inside the
    read's await, the document is clean again when the result lands, so the
    older read reloads over the newer buffer. Nothing is lost, because the
    newer content is on disk, but the tab shows stale text until the next
    reload. Fixing it needs a revision or request-ordering token.
  - **(b) The string-fallback decode error has no path.** When the error
    arrives as a message rather than `FileError::EncodingError`,
    `parseEncodingError` yields path `""`. `openDocumentFromPath` falls back to
    its argument, but `openDocumentFromDialog` has none, so the decode-failure
    exit finds no match and `EncodingDialog` can show for a dirty file. Picking
    an encoding then re-decodes nothing (`handleEncodingSelect` returns early on
    an empty path); any re-decode that did reach the dirty document would be
    refused by the guard.
  - **(c) A clean path-only match opens a second tab.** A clean document whose
    path equals the opened file but whose id differs (the Save As shape) is
    not replaced in place: the decoded document is written under its own id
    beside it, as before this record.
  - **(d) The decode-failure exit matches by path only.** A dirty document
    whose id equals the opened path's id but whose path moved (after Save As)
    is not focused. `EncodingDialog` shows, and the re-decode is refused with
    the toast. So decision 2's "only through a race" is not strictly true.
    Fixing it needs Rust to return the path-derived id in
    `FileError::EncodingError`. Pinned by D-9a in
    `tests/d20-reopen-dirty-hook.test.tsx`.
  - **(e) Recent Files records the focused tab's path.** When an id match
    whose path changed is focused, callers record the returned document's
    path, not the path the user opened.
  - **(f) The guard is per window; some opens create a window.** Document
    stores are per window, and a Finder open on a running app (and a
    single-instance open when more than `main` exists) goes to a new window
    via `open_file_in_new_window` in `src-tauri/src/main.rs`. The new window
    has nothing to match, so the file loads from disk beside a dirty copy in
    another window. Nothing in that window is replaced — verified on the real
    app — but the two copies diverge. Routing to the window that already has
    the path is a cross-window decision outside this record (D29).

## Correction (2026-09-24)

The first draft had decision 2 prompt on reopen-with-encoding. A review
claimed that prompt was unreachable once decision 1 landed. An independent
review (Codex) showed the claim was **wrong**: both open paths read before any
check. A dirty file whose bytes had become undecodable therefore reached
`EncodingDialog` and then the reopen, with no race needed. The fix is to put
the decode-failure exit under decision 1, which leaves only the race.

The product owner confirmed that a deliberate *Reopen with encoding* command
is wanted. So dropping the dirty guard (keeping only prose) was rejected: that
command would bring back the silent clobber. Building the confirmation prompt
now was also rejected. It would have to be added to the single
`ConfirmDialog` driven by `quitDialogModel` (priority, cancellation, target
tracking) for a command that does not exist yet.
