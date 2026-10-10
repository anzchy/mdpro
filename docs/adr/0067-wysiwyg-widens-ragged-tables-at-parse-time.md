# 0067. WYSIWYG widens ragged tables at parse time, padding at the row end

**Status**: Accepted (2026-10-10). Drafted 2026-10-09 for D64/D65 at the
user's request (「a3 起草 ADR，先给 Codex 审 (Recommended)」), revised after the
user's Codex review (ACCEPT WITH CHANGES). The user chose A+ with B deferred
(「采纳 A+，B 暂缓 (Recommended)」) and accepted this text after being told of
the empty-cell and drift costs (「改为 Accepted (Recommended)」).

## Context

D64 and D65 (rows in
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](../plans/20260912-frontend-backend-sequencing-order.md#d64))
were found in the D49/D58 device check
([`docs/test/20261009-d49-d58-device-check.md`](../test/20261009-d49-d58-device-check.md),
F1 and F2). The forces as understood on 2026-10-10:

- **The load premise of ADR-0052 and ADR-0063 is false.** ADR-0052:46-48 and
  ADR-0063:71 say remark-gfm drops overflow cells when a document loads into
  Milkdown. It does not.
  - `mdast-util-gfm-table` 2.0.0 creates every row and cell it finds, with no
    truncation to the header width.
  - preset-gfm 7.18.0 passes all table and row children into the ProseMirror
    table (`lib/index.js:113-125,201-216`).
  - So the PM doc is ragged after load (F2).
- **prosemirror-tables 1.8.5 `fixTables` repairs ragged tables, and can put
  the padding in the wrong place.**
  - It runs as `appendTransaction` in preset-gfm's `tableEditing` and checks
    only tables that a transaction touched.
  - Its choice of side is conditional, and in the observed shapes it inserts
    the missing cells at the **row start** (`dist/index.js:827-845`).
  - Its cells take the schema's default `left` alignment.
- **The serializer already widens ragged tables, correctly.** A throwaway unit
  test on 2026-10-10 used real Milkdown commonmark+gfm with no transformer.
  - A ragged PM table serialized widened and padded at the row end, with blank
    cells and `---` for unaligned columns.
  - An edit in an unrelated paragraph produced the same table text.
  - Only `fixTables` misplaces cells.
- **Any whole-document transaction touches every table.**
  - The MCP table path applies with `replaceAll(newContent)`
    (`src/hooks/mcpTableApplyMilkdown.ts:52`, kept by
    [ADR-0065](./0065-mcp-table-actions-flush-first-and-commit-the-editor-before-the-store.md)).
    So a table action shifts **non-target** ragged tables (D64).
  - Typing inside a ragged table triggers the same repair on that table.
  - The unit repro is byte-identical before D58 (`d785ec9^`), so the defect
    predates ADR-0065. It probably dates from `908d40e`. That is from reading
    the code; it was not run.
- **ProseMirror content enters by more than one path.** Markdown enters through
  remark (`parserCtx`):
  - initial load and Source → WYSIWYG (`src/components/Editor/MilkdownEditor.tsx:119-151`);
  - MCP `replaceAll` (`src/hooks/mcpTableApplyMilkdown.ts:49-52`);
  - MCP insert and write rebuilds (`src/hooks/mcpInsertContent.ts:121-126`,
    `src/hooks/useMcpEvents.ts:86-105`).

  **HTML paste does not go through remark.** It is sanitized, then parsed by
  ProseMirror's DOM parser (`MilkdownEditor.tsx:64-73,145-155`;
  prosemirror-view `dist/index.js:2847-2865`). Plain-text paste also bypasses
  remark: it becomes paragraphs (`dist/index.js:2824-2845`), and GFM's paste
  rule leaves plain-text slices unchanged (preset-gfm `lib/index.js:628-664`).
- **Empty PM cells serialize as `<br />`.** preset-commonmark writes an empty
  non-terminal paragraph as `<br />` (`lib/index.js:448-474`). The 2026-10-10
  test confirmed it: cells that a test transformer padded came out as `<br />`,
  where `tableWiden` writes a blank cell (`src/utils/tableWiden.ts:67-74`).
- **Alignment.** ProseMirror substitutes an attribute default only for
  `undefined` and keeps an explicit `null` (prosemirror-model
  `dist/index.js:2042-2054`). preset-gfm serializes the stored header
  alignment (`lib/index.js:127-139`), and `markdown-table` writes `null`
  without a colon. In the test, a transformer that did not extend
  `table.align` produced `:-----` for the new column; one that extended it
  with `null` produced `------`.
- [ADR-0063](./0063-table-edits-widen-like-format-on-save.md) (Accepted)
  decided that **every writer that re-serializes a table widens it** to its
  widest row, padding at the row end (`src/utils/tableWiden.ts:57-75`).
  [ADR-0052](./0052-format-on-save-widens-tables-to-the-widest-row.md) is
  already superseded by it.
- **Dirty state** (`src/plugins/milkdown/editSync/`):
  - The baseline is captured by serializing the parsed doc (`plugin.ts:66-74`).
  - `write()` stores nothing when the serialization is unchanged
    (`controller.ts:141-164`).
  - Heading-ID initialization may dispatch a history-free transaction
    (preset-commonmark `lib/index.js:2119-2157`). That is today's behaviour,
    and open-only still writes nothing.
  - Save writes the store verbatim, apart from line-ending and encoding
    restoration and the opt-in reformat (`useDocument.ts:211-234`,
    `file.rs:1247-1267`).

## Options

1. **A — normalize at parse time.** A `$remark` mdast transformer (the hook
   that `highlightMarkPlugin.ts:71-74` already uses) widens every table before
   the PM doc is built. Rejected **as drafted**: it leaves HTML paste uncovered
   and turns synthetic cells into `<br />`.
2. **A+ — A, plus paste normalization and serializer parity.** Chosen; see the
   Decision.
3. **A′ — normalize with a transaction right after load.** Rejected. It reaches
   edit-sync (`plugin.ts:86-90`) and dirties the document even with
   `addToHistory:false` (`controller.ts:177-181`, then `write()`).
4. **B — MCP replaces only the target table node.** Deferred. Two reasons:
   - It cannot fix F2, typing, or D65, which all still go through `fixTables`.
   - Its index mapping can target the wrong table. Source enumeration excludes
     tables inside blockquotes and lists (`src/utils/tableParser/index.ts:43-54`),
     but PM enumeration descends into every container
     (`src/utils/cursorSync/tableMilkdown.ts:35-49`), so `tableIndex` N can
     name different tables on the two sides.

   Raise B again only for a need that A+ leaves open, such as undo granularity
   or selection, and only together with a container-aware index.
5. **D — patch `fixTables` to pad at the row end** (pnpm patch or a fork).
   Rejected. It is a dependency patch, it still repairs only touched tables,
   and it leaves F2's display ragged until a table is touched.

## Decision

Adopt **A+**:

1. **Parse-time widening.** A `$remark` transformer in `src/plugins/milkdown/`
   widens every GFM table in the mdast by ADR-0063's rule:
   - to the widest row, with a blank overflow cell counted as a column;
   - padding at the row end, and widening the header for overflow columns;
   - nested tables, in blockquotes and lists, included.

   It shares its widening core with `src/utils/tableWiden.ts`; the rule is not
   copied. **The transformer dispatches no transaction.**
2. **Explicit `null` alignment.** The transformer extends `table.align` to the
   final width with explicit `null`, so added columns serialize as `---`,
   matching `tableWiden`.
3. **Empty cells serialize as empty cells.** A table-cell serializer rule makes
   a cell whose only content is an empty paragraph serialize as an empty mdast
   cell, never `<br />`. WYSIWYG output for a widened table is then
   byte-identical to `tableWiden`'s.
4. **Paste is normalized separately.** A `transformPasted` (slice) normalizer
   end-pads every table in an HTML paste before dispatch. Plain-text paste
   keeps its current behaviour (paragraphs), and a test pins it.
5. **The invariant:** Markdown-derived PM tables are rectangular before
   EditorState creation. HTML/DOM paste is normalized separately before
   dispatch. Synthetic empty cells serialize as empty cells, never `<br />`;
   added alignments remain explicit `null`.
6. **F2 becomes the specified behaviour.** WYSIWYG shows overflow cells under
   empty header cells, the same widening that source-mode edits and
   format-on-save produce.
7. **ADR-0063 remains Accepted; ADR-0067 corrects its Consequence line 71.**
   ADR-0063's decision still holds, and this ADR extends its rule to the
   Milkdown parse and paste paths. ADR-0052:46-48 carries the same false
   premise, and that ADR is already superseded.
8. **D65:** A removes the observed ragged precondition. D65 remains unproven
   until the command-level and device regressions pass.

## Consequences

- **Opening without editing does not dirty the document and does not change
  disk bytes.** The transformer dispatches no transaction. The heading-ID
  transaction that may run at init already exists today, and edit-sync
  suppresses an unchanged serialization, so the store keeps the file's text
  and save writes it unchanged.
- **The first edit rewrites ragged tables. This is existing behaviour and an
  unavoidable visible diff.** Today's serializer already widens every ragged
  table on any edit (2026-10-10 test), so editing one paragraph rewrites tables
  elsewhere in the file. A+ does not add this diff, and with Decision 3 it adds
  no `<br />` to it. The user still sees changes they did not type.
- **Cost:** the empty-cell rule applies to **every** empty table cell, not only
  synthetic ones. Measured on 2026-10-10 before the rule landed: an empty cell
  already in the file always serialized as `<br />`, even in the load-time
  baseline. Opening wrote nothing, because the baseline matched, but the first
  edit anywhere in the document wrote `<br />` into the store. With the rule it
  comes back blank (`tests/table-empty-cell-serialize.test.ts` E-1). This
  changes output for files that never had a ragged table.
- **Cost:** three new pieces of editor-internal code, each a place where
  behaviour can drift from `tableWiden`: the transformer, the serializer rule
  and the paste normalizer. Parity tests are the only guard.
- **Cost:** any future path that builds PM content outside remark and outside
  the paste normalizer can reintroduce D64, because `replaceAll` stays whole
  document (ADR-0065).
- **Cost:** one more parse-time pass on every load. It is linear in table
  cells; there is no measurement and no benchmark (E39).
- **Gives up:** showing the file's exact ragged shape in WYSIWYG. Source mode
  remains the place to see it.
- Padding at the row end keeps every existing cell's column index, so the
  source ↔ WYSIWYG cursor mapping by index stays stable.
- **Required tests (tdd-guardian):** the D64 repro and the 2026-10-10
  alignment test are kept as red tests.
  - **mdast:** overflow, short rows, end padding, blank overflow, nested
    tables in blockquotes and lists, escaped pipes, CJK.
  - **Real Milkdown load:** a rectangular `TableMap`, cell order preserved,
    explicit-`null` alignment.
  - **D64 MCP repro**, plus typing inside and outside each ragged shape.
  - **D65:** every menu command, on formerly ragged tables.
  - **Paste:** an HTML ragged-table paste is normalized; plain-text paste
    behaviour is pinned.
  - **Load-only:** through the timer, the heading-ID transaction, flush and
    unmount, the store is unchanged and the document is clean.
  - **Mode switch:** Source ↔ WYSIWYG without an edit leaves the store
    unchanged; first-edit normalization is asserted explicitly.
  - **MCP:** the write, insert and remount paths.
  - **Exact `tableWiden` parity:** no `<br />`, no added `:---`, and an
    idempotent round trip.
