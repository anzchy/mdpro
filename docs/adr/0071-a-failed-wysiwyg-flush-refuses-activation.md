# 0071. A failed WYSIWYG flush refuses activation

**Status**: Proposed (2026-10-10, mdpro-a3 for D92). Accepted (2026-10-10,
delegator reserved the number and approved the decision; user graded D92
「BLOCK，进 0.3.1 门禁 (Recommended)」).

Complements
[ADR-0028](0028-reopening-a-dirty-open-file-focuses-it-instead-of-reloading.md)
decision 5 and does not supersede it: decision 5 decides whether a document is
dirty and refuses to *replace its content*; this ADR decides whether the
editor may be *left at all*.

## Context

WYSIWYG edits reach `documentStore` only when the Milkdown flush controller
serializes them. `flushPendingEdits` returns `written`, `clean` or `failed`.
Before D92, the tab switch (`documentStore`) and the mode switch
(`editorStore.flushWhenLeavingWysiwyg`) dropped that status. When the
serializer threw (D90 made this reachable by dragging a table into a cell),
the switch went ahead, the editor unmounted, the unmount flush failed too, and
the document reopened from its last captured content. The edit that failed
and everything typed after it were lost with only a warn log.

⌘S already refused in this state (`saveService`), and ⌘W already prompted
(`dataLossGuards`). Tab switching, view-mode switching and the routes that
activate a document programmatically (Finder reopen via `openWriteGuard`,
`file:open-in-window`, MCP `create_document`) did not.

## Decision

1. When the flush for the active document returns `failed`, **activation of
   another document and leaving WYSIWYG are refused**. The user stays where
   they are, a shared toast says so (`src/utils/flushRefusal.ts`), and a
   `tab.switch` / `view.mode.change` `fail` event is logged.
2. `setActiveDocumentId` / `setActiveDocument` return whether the switch
   happened, and `setViewMode` / `cycleViewMode` return early on refusal.
   Callers that update other state after activating (editor store, MCP events,
   open routes) do so only on success.
3. `openWriteGuard` refuses only when the *active* document's own flush
   fails. Its logs keep `success` for the guard's decision and add `activated`
   for whether the tab actually became active.
4. **Close and autosave are not guarded.** Close already goes through the
   unsaved-changes prompt. Autosave neither switches nor unmounts the editor,
   and the last successfully flushed content is the newest recoverable draft.
   Guarding it would leave no draft at all.

## Consequences

- **The user is stuck on the document** until the serializer stops throwing.
  Undoing the offending edit is the way out; there is no "switch anyway". We
  accept this because the alternative is silent data loss.
- **The refusal toast can be shadowed** by a later toast in the same slot,
  such as the draft-recovery or encoding-reopen notice. The log event remains
  the reliable record.
- **Close and autosave are deliberately exempt** (decision 4). A failed flush
  therefore still produces a draft that predates the failing edit.
- **Every new activation path must go through the guard or be listed here as
  exempt.** That covers future MCP tools, open routes and window-level
  activation. A path that calls the store setter and ignores its return value
  reopens D92.
- A refused large-document auto-degrade stays in WYSIWYG and does not retry
  in a loop. The user keeps a slow editor until the flush succeeds.
- Only unit tests verify this so far. It has not been checked on a device.
