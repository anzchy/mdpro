# 0065. MCP table actions flush first, and commit the editor before the store

**Status**: Proposed (2026-10-09, user decision while fixing D58, revised after
the user's Codex review the same day). Acceptance waits on the D58 device check.

## Context

D58 (row in
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](../plans/20260912-frontend-backend-sequencing-order.md#d58)),
found by the Codex consult behind
[ADR-0064](./0064-mcp-table-actions-widen-and-keep-header-width-coordinates.md):
`processTableActionEvent` (`src/hooks/mcpTableAction.ts`) rewrote a WYSIWYG
document from the store content without flushing, and wrote the store before
Milkdown's `replaceAll`. The forces as understood on 2026-10-09:

- A WYSIWYG edit reaches the store only when the edit-sync timer fires
  (`src/plugins/milkdown/editSync/`, 200 ms). A table action inside that window
  rewrote the whole document from the older store text, and `replaceAll` then
  put that older text on screen: the typed edit was lost.
- When `replaceAll` threw, the store already held the new content and the
  editor the old one. `replaceAll` also returns **without dispatching** when the
  parser yields no doc, and the old code wrote the store anyway.
- [ADR-0044](./0044-mcp-insert-in-wysiwyg-is-a-wholesale-replace.md) solved the
  same race for `insert_content` with a window-global `flushPendingEdits`, a
  refusal when it fails, then a wholesale rebuild.
- [ADR-0024](./0024-mcp-table-actions-report-their-outcome-by-ack-round-trip.md)
  amendment B asks for compute → validate → commit with the store unchanged
  when the editor fails. Its ack round-trip is not built (D57).
- Scope: only the HTTP-originated `mcp:table_action` event. Neither context
  menu has this race: the WYSIWYG menu runs commands on the live view
  (`src/plugins/milkdown/table/contextMenu.ts`), and the source menu edits live
  CodeMirror, whose `onChange` writes the store at once
  (`src/components/Editor/Editor.tsx`).

## Decision

1. **Flush the target only.** A new `flushPendingEditsFor(documentId, reason)`
   in `src/stores/milkdownEditorStore.ts` runs only the target document's
   flushers, with reason `"mcp-table"`. The global `flushPendingEdits` is
   unchanged. If the flush reports `failed`, refuse: store and editor unchanged,
   `mcp.table.<action>` logged `fail` with reason `"flush failed"`.
2. **Re-read after the flush**: the document, `activeDocumentId`, `viewMode`
   and the editor. The branch is chosen on these values, keyed on `viewMode`,
   not on a null `editorView`. WYSIWYG-active with no editor → refuse.
3. **Milkdown branch, phased apply.** Compute from the post-flush text, then
   apply with `replaceAll` before any store write:
   - newContent is first parsed with the editor's own parser. No doc → refuse
     with no store write, and `replaceAll` is never called;
   - the parsed doc equals the current doc → a legitimate no-op: no dispatch,
     newContent is written to the store and success is logged;
   - after `replaceAll`, the view doc is still the same object → refuse, no
     store write;
   - `replaceAll` throws after the view advanced → write the editor's
     serialized markdown to the store, so the two agree, and log `fail`. If
     that serializer also throws, write newContent instead, since it is what
     the view was given;
   - it throws before the view advanced → refuse, both unchanged;
   - success → write newContent to the store.
4. **Source branch**: `cmView.dispatch` is now caught and logged, but the
   store is still written first. Amendment B is **not** delivered for this
   branch.
5. **Not wholesale.** Table actions keep `replaceAll`. A rebuild through
   `prepareWholesaleReplace` is unnecessary, because `replaceAll` already lands
   on screen, and it would discard undo history and TOC state
   (`src/hooks/wholesaleReplace.ts`).

This reduces the pre-dispatch class of amendment-B failures for the Milkdown
branch by ordering and checking. It does not deliver amendment B.

## Consequences

- **Cost:** the insert path still flushes window-globally (ADR-0044), so the
  two MCP write paths are temporarily inconsistent. A follow-up D row tracks
  moving insert to the per-document flush.
- **Cost:** the Rust route returns `202` right after the emit. A refused action
  leaves the shadow store on the old content, and the caller cannot tell
  "refused" from "not synced yet" without reading back (D57).
- **Cost:** a non-active document is still updated store-only, with no flush
  and no editor. That is the same as before.
- **Cost:** `replaceAll` adds one history entry. Typing within ProseMirror's
  500 ms grouping window can merge with it into one undo step. Cursor and
  selection after the replace are not tested.
- **Cost:** the shadow store is eventually consistent. A successful action
  reaches it about 500 ms later (the 200 ms edit-sync plus the 300 ms MCP sync
  debounce).
- **Cost:** the source branch keeps the store-first order, so a throwing
  CodeMirror listener can still leave the store ahead of the view.
- **Cost:** a normal apply parses newContent twice, once for the pre-check
  and once inside `replaceAll`.
- **Cost:** the store write after a post-dispatch throw is a new store-write
  site, classified `ordinary`.
- `flushPendingEditsFor` runs only the newest registration for the document,
  the same as the global flush. Older ones belong to editors being torn down.
- No new `WholesaleReason`. The success write stays classified `ordinary` in
  `tests/wholesale-path-partition.test.ts`, so TOC coordination is not reset.
