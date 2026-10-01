# 0044. An MCP insert into a WYSIWYG-active document is a wholesale replace

**Status**: Proposed (2026-09-30). Becomes Accepted only after device
verification (WI-6 of the D35 plan) and the D37 device re-check.
2026-10-01: D37 device re-check passed 8/8 (release build of `66cb742`);
D35 WI-6 still pending.

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

- **Cost:** every WYSIWYG insert loses the undo history. The editor is
  rebuilt. Keyboard focus and the caret are carried across the rebuild only
  when the editor was focused before it (D37, amended 2026-10-01; mechanism in
  `src/utils/milkdownFocusCarry.ts`, `src/utils/caretAnchor.ts` and
  `src/hooks/useMilkdownFocusRestore.ts`). The carry applies to every
  wholesale reason, so `write_document` gets it too. An unfocused editor,
  including one left unfocused by a click on a non-focusable area, carries
  nothing.
- **Cost (D37):** the caret is mapped by a structural diff of the old and new
  documents, so it is only as good as the diff:
  - Two MCP edits in one React render map across the combined diff.
    "Hello world|" plus "A " at the start and " B" at the end gives
    "A Hello world B|", not "A Hello world| B". No keystroke is lost.
  - A caret strictly inside a rewritten region lands at the region's start.
  - The diff is ambiguous: `a→aba` is equally "ab before" and "ba after". A
    tie goes to the candidate in the same paragraph at the same offset,
    otherwise to the left one.
  - Monotonicity holds only for inserts, not for deletions or rewrites. Only
    one head is carried, so this is not visible to the user.
- **Cost (D37):** restore is O(n) on the UI thread. A document above
  `CARET_ANCHOR_MAX_DOC_SIZE` (12,000,000) skips the diff and keeps the
  clamped head. The cap was sized from Node timings (15–30 ms near 10 MB).
  On the device (2026-10-01, release build, one M-series machine) a
  9,318,971-byte document logged `durationMs` 8, so the cap stays. The old
  document is held until the record is consumed or dropped. The 10 s TTL
  safety net had about 7 s of headroom there: restore fired 2.9 s after the
  reload. That is a single measurement on a fast machine and proves nothing
  for slower ones. A document over 25,000 structural elements is forced to
  Source mode (`editor.large_document.degrade`, trigger `structure`) and never
  reaches the carry, so only long-paragraph documents exercise the cap.
- **Cost (D37):** with two confirm prompts queued, focus survives but the
  caret goes to the end of the document after the second approval, a visible
  jump (D38, recorded, not fixed). The confirm dialog returns focus to the
  element that held it at open and falls back to the end of the active
  editor when that element is gone.
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
- **Foreclosed:** an incremental ProseMirror insert that preserves undo and
  an exact caret, until offset mapping exists. D37 gives up a step-by-step
  caret mapping for batched edits: it would need each step's markdown at arm
  time, which `prepareWholesaleReplace` does not have. Adopting it would take a new ADR
  superseding this one.
- **Benefit:** the insert is no longer silently lost.
  `write_document` and `insert_content` now share one rebuild path.
- **Benefit (D37):** typing straight after an MCP write or insert, or after
  approving its confirm prompt, no longer loses keystrokes, and the restore
  never takes focus away from a dialog or input.
- **Benefit:** `tests/wholesale-path-partition.test.ts` now classifies the
  insert site as wholesale. The classification is conservative, because the
  static classifier cannot tell the two modes apart.

Related: [ADR-0042](0042-mcp-write-confirmation-is-an-in-window-queued-prompt.md)
(whose device run found this), [ADR-0021](0021-mcp-document-offsets-are-utf16-code-units.md),
D35, D37 and D38 in `docs/plans/20260912-frontend-backend-sequencing-order.md`, and the
tests `tests/mcp-insert-wysiwyg-d35.test.ts`,
`tests/mcp-insert-wysiwyg-d35-law.test.ts` and
`tests/mcp-insert-wysiwyg-d35-editor.test.tsx`.
