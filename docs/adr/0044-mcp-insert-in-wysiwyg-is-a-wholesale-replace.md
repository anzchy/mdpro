# 0044. An MCP insert into a WYSIWYG-active document is a wholesale replace

**Status**: Proposed (2026-09-30). Becomes Accepted only after device
verification (WI-6 of the D35 plan).

## Context

D35, found in the ADR-0042 WI-10 device run
([record](../test/20260930-adr0042-wi10-gui-acceptance.md)): an MCP
`insert_content` into a document that is active and in WYSIWYG returns
success and updates the store (and CodeMirror), but Milkdown never shows it.
The forces as understood on 2026-09-30:

- Milkdown reads content once, at mount, through `defaultValueCtx`; after
  that it rebuilds only when `editorGenerations[id]` is bumped
  (`src/components/Editor/MilkdownEditor.tsx`).
- `handleInsertContent` (`src/hooks/useMcpEvents.ts`) never bumps it.
  `handleWriteDocument` already takes the wholesale path through
  `prepareWholesaleReplace` (`src/utils/wholesaleReplace.ts`).
- Probable data loss, inferred from code and not reproduced: the edit-sync
  controller's next `write()` serializes the stale Milkdown doc over the
  store, erasing the insert. The regression test's red run (D35-2,
  2026-09-30) reproduced it in jsdom.
- An incremental ProseMirror insert would need a mapping from markdown
  offsets to ProseMirror positions. The codebase has no such mapping.
- `flushPendingEdits` flushes every registered document; no per-document
  flush exists.

## Decision

When the target is the active document and `viewMode === "wysiwyg"`:

1. Call `flushPendingEdits("mcp-insert")`, the global flush, as tab switch,
   save and close already do.
2. If the flush reports `failed`, refuse the insert: store and editor
   generation unchanged, `mcp.insert` logged as `fail` with reason
   `"flush failed"`.
3. Otherwise re-read the document, splice the text in, and, in the same
   synchronous block, call `prepareWholesaleReplace(id, "mcp-insert")` (a new
   `WholesaleReason`) and write the store.

Source mode and non-active documents keep the incremental path unchanged.
The branch is keyed on `viewMode`, not on `editorView` being null.

## Consequences

- **Cost:** every WYSIWYG insert loses the cursor position and the undo
  history. The editor is rebuilt.
- **Cost:** TOC coordination is reset. Collapsed headings reopen and heading
  identity is reset. The user chose this over a reload-only path (2026-09-30).
  A reload without the TOC reset would be a half-wholesale path, and the
  wholesale-path partition test cannot express one.
- **Cost:** a refused insert leaves the Rust shadow store, which has already
  reported success to the MCP client, out of step with the frontend until
  the next `mcp_sync_documents` push.
- **Cost:** because the flush is global, one tab whose serializer fails
  blocks WYSIWYG inserts into every tab.
- **Cost:** `position: "cursor"` still resolves to 0 in WYSIWYG, which is
  known and within ADR-0021 / D10(c) scope. It used to be hidden and is now
  visible.
- **Foreclosed:** an incremental ProseMirror insert that preserves cursor
  and undo, until offset mapping exists. Adopting it would take a new ADR
  superseding this one.
- **Benefit:** the insert is no longer silently lost.
  `write_document` and `insert_content` now share one rebuild path.
- **Benefit:** `tests/wholesale-path-partition.test.ts` now classifies the
  insert site as wholesale. The classification is conservative, because the
  static classifier cannot tell the two modes apart.

Related: [ADR-0042](0042-mcp-write-confirmation-is-an-in-window-queued-prompt.md)
(whose device run found this), [ADR-0021](0021-mcp-document-offsets-are-utf16-code-units.md),
D35 in `docs/plans/20260912-frontend-backend-sequencing-order.md`, and the
tests `tests/mcp-insert-wysiwyg-d35.test.ts`,
`tests/mcp-insert-wysiwyg-d35-law.test.ts` and
`tests/mcp-insert-wysiwyg-d35-editor.test.tsx`.
