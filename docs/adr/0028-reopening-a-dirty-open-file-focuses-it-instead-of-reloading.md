# 0028. Reopening a file that is already open and dirty focuses it instead of reloading

## Status

**Proposed** (2026-09-23). Closes **D20** on
`docs/plans/20260912-frontend-backend-sequencing-order.md` once implemented.

## Context

A document's id is derived from its path, so opening a file that is already
open produces the **same id** and `upsertDocument` overwrites the existing
entry. Three entry points do this, all in `src/hooks/useDocument.ts`:

| Entry point | Reached by |
|---|---|
| `openDocumentFromPath` | ⌘O onto a recent file, Finder "Open With", single-instance `file:open` |
| `openDocumentFromDialog` | the Open dialog landing on an already-open file |
| `openDocumentWithEncoding` | Reopen with a different encoding |

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

1. **A dirty document is never replaced by an open action.** `⌘O`, the Open
   dialog, Finder "Open With" and the single-instance file-open path all
   **switch to the existing tab** and leave its buffer untouched. No prompt:
   there is nothing to decide, because focusing loses nothing and the user's
   next save still writes their edits.
2. **Reopen-with-encoding asks.** Because re-decoding is the point of the
   command, a dirty document gets a confirmation with exactly two choices:
   **Discard changes and reload** and **Cancel**. Cancel leaves the buffer and
   the dirty flag alone. There is no "save first" third option — saving would
   write the buffer in the *old* encoding and then re-read it, which is a
   different operation from the one the user asked for.
3. **A clean document reloads, as it does today.** The behaviour change is
   scoped to `isModified`. This keeps "reopen to refresh" working, and it is
   the smaller diff. The user can see which case they are in: the dirty dot is
   the difference.
4. **The check is on the document in the store at the moment of the upsert**,
   read through `useDocumentStore.getState()`, not through a captured value.
   The open path is asynchronous — the file read sits between the user's
   gesture and the write — and an edit can land inside that window. This is
   the same class of race as D15 and D19.
5. **The flush comes first.** "Dirty" means dirty *after* flushing pending
   WYSIWYG edits, via the shared `assessWindowUnsaved` from D16 WI-5. A
   WYSIWYG edit still inside the 200 ms edit-sync timer has not reached the
   store yet, so a check that skips the flush reads `isModified === false` and
   discards it — exactly the bug this record exists to prevent. If the flush
   fails, treat the document as dirty: refusing to reload is the safe
   direction.

## Consequences

- **Gives:** unsaved work survives every open path. The one command whose
  purpose is to re-read gets an explicit, reversible confirmation rather than
  silent destruction.
- **Costs:**
  - **⌘O on a dirty file becomes a no-op that looks like one.** A user who
    reopens a dirty file *wanting* the disk content now has to discard the
    buffer first — close the tab, or reopen with the same encoding. We are
    trading a rare deliberate action for a common accidental one.
  - **The two paths now behave differently**, and the difference is not
    self-evident from the menu. Reopen-with-encoding prompts; ⌘O does not.
    The justification is real but it has to be learned.
  - **The dialog still reads the file it will not use.** Wasted IO on a path
    where the check cannot come first. Harmless, but it means "we never read a
    file we are not going to open" is not an invariant we can claim.
  - **A third confirmation dialog** joins window-close and quit. Each one is
    defensible alone; together they are a growing tax on the user's attention,
    and the next one should be weighed against removing one of these.
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
