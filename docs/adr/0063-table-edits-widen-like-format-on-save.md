# 0063. Table edits widen like format-on-save

**Status**: Accepted (2026-10-09, user decision while fixing D49). Supersedes
[ADR-0052](./0052-format-on-save-widens-tables-to-the-widest-row.md).

## Context

D49 (row in
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](../plans/20260912-frontend-backend-sequencing-order.md#d49))
is the defect ADR-0052's Consequences predicted. D44 taught format-on-save to
keep body cells past the header's column count, and every other table writer
still dropped them. A source table with `| 1 | 2 | Z |` under a two-column
header kept `Z` on ⌘S and lost it on any context-menu edit, "Reformat table"
included, with no prompt.

The forces as understood at the time:

- ADR-0052 §3 says "Widening happens in the formatter only." That sentence
  is what made the two writers disagree. Keeping it means accepting the
  same silent loss D44 was fixed for, one menu click away.
- All 13 rewriting context-menu edits funnel through one function,
  `mutableFromModel` (`src/utils/tableEdits/edits.ts`). The MCP row and
  column actions reach the same edits through `applyEdit`.
- The parser truncation stays load-bearing for the same reasons as before:
  cursor locate, the column-count linter, the context-menu context and MCP
  coordinate validation all assume header-width rows.
- Whether MCP should widen or refuse was left open by ADR-0052. It is decided
  separately (ADR-0064), not here.

## Decision

1. ADR-0052 §1, §2, §4 and §5 stand unchanged: widen to the widest row, pad
   the header with empty cells, new columns get `null` alignment, a blank
   overflow cell is a column, log without cell text, no prompt.
2. §3 is replaced: **the parser truncation stays; widening happens in every
   writer that re-serializes a table.** The widening lives in one shared
   write-side helper, `src/utils/tableWiden.ts`, used by the formatter and by
   `mutableFromModel`. It returns rectangular rows. It does not sit in
   `tableParser/`, so nobody "fixes" the truncation next to it.
3. Every context-menu edit widens first, then edits. Blank inserted rows use
   the widened width. Column indices are unchanged, because the context menu
   still resolves a click to a header-width cell, and overflow columns are
   appended after the header's.
4. Each edit that widened logs `editor.table.edit-widened` once, with
   `{action, fromColCount, toColCount}`. `toColCount` is the width before
   the edit's own column insert or delete. No cell text.

## Consequences

- A context-menu edit, ⌘S and "Reformat table" now produce the same table.
  `reformat_table` equals `formatTable` for every model (pinned by law L-5).
  Tables without overflow edit byte-identically to before (frozen oracle).
- **Any edit changes the rendered table.** One click on "Insert row" turns a
  hidden `Z` into a visible column under a blank header, the same surprise
  ADR-0052 accepted for ⌘S, now on every edit.
- **Deleting column 0 of a one-column table no longer deletes the table** when
  a row overflows. A table holding the overflow cells remains under a blank
  header. Deleting the only overflowing row leaves its widened column behind,
  now empty.
- **Overflow columns cannot be targeted.** A right-click on an overflow cell
  resolves to the nearest header-width cell, and "Move column right" on the
  last header column stays disabled. Fixing that means widening the context
  menu's `colCount` and the shared `actionGate.ts`, which WYSIWYG also uses.
  Deferred.
- **The splitter coupling now carries four writers.** The edits depend on
  `splitCellTexts` and `parseRowCells` agreeing on cell boundaries (RC-6).
  A code-span-aware splitter on one side only would misplace cells in all
  of them. W-7, E-19 and the MCP equivalent pin the agreement.
- Each context-menu edit reads `model.raw`, one more `sliceString` of the
  table over the CodeMirror rope (memoized, shared with `tableWriteGuard`).
- **WYSIWYG still loses the cells at load**, as ADR-0052 recorded. Unchanged.
- MCP row and column actions call the same `applyEdit`, so they inherit this
  decision. [ADR-0064](./0064-mcp-table-actions-widen-and-keep-header-width-coordinates.md)
  accepts that and widens `set_cell` too, rather than refusing.
