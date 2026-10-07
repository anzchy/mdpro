# 0052. Format-on-save widens tables to the widest row

**Status**: Accepted (2026-10-07, user decision while fixing D44).

## Context

D44 (row in
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](../plans/20260912-frontend-backend-sequencing-order.md#d44);
device evidence in `docs/test/20261002-dtrack-device-retest.md` §3 F1): with
auto-reformat-on-save on, ⌘S dropped every body cell beyond the header's
column count. `| g | h |Z` was saved as `| g | h |` (padded), and `Z` was gone, with no
prompt.

The forces as understood at the time:

- GFM ignores excess cells, so the rendered table never showed `Z`. In source
  mode, though, `Z` is text the user typed, and the save deleted it from disk
  without a word. Rendering semantics had become a write.
- The cells were dropped twice: the row parser truncates each row to the
  header (`src/utils/tableParser/rowCells.ts`), and `serializeRows` truncates
  again to the alignment count.
- The parser truncation is load-bearing. Cursor locate, the column-count
  linter, MCP coordinate validation and the pinned "E6 truncate" test all
  assume a row has exactly the header's column count.
- The two options were to prompt before reformatting or to keep the cells.
  The user chose to keep them and not to prompt.

## Decision

1. `formatTable` / `formatAllTables` (`src/utils/tableFormatter.ts`) widen
   each table to its own widest row. The cells inside the header's columns
   come from the parsed model, as before. Only the overflow is read back from
   the row's own line with `splitCellTexts`, trimmed the way the parser trims.
2. The header is padded with empty cells. New columns get default alignment
   (`null`, `---`). Shorter rows are padded with empty cells. A blank
   overflow cell (`| g | h | |`) still counts as a column.
3. The parser truncation stays. Widening happens in the formatter only.
4. Each widened table logs `editor.table.format-widened` with
   `{start, end, fromColCount, toColCount}`, and never cell text.
5. No prompt is shown.

## Consequences

- ⌘S from source mode no longer loses cells. Tables without overflow format
  byte-identically to before.
- **⌘S from WYSIWYG still cannot keep them.** remark-gfm drops excess cells
  when the document loads into Milkdown, so the cells are already gone before
  the save. This is not fixed here.
- **The other table writers still truncate.** The source context menu's
  edits, including "Reformat table" (`src/utils/tableEdits/edits.ts`), and
  the MCP/HTTP table tools (`src/utils/tableMcp.ts`) drop overflow on any
  edit. They were deferred, and a new D-row is proposed for them. Until then
  the same table keeps `Z` on ⌘S and loses it on a context-menu reformat.
  Widen-versus-refuse for MCP is its own lasting choice.
- **Saving changes the rendered table.** Before the save GFM hides `Z`; after
  it `Z` is a visible column. A user who relied on GFM's "ignore the excess"
  semantics gets a wider table they may not expect.
- **New columns have an empty header cell.** GFM requires a header for every
  column, and there is no text to put there, so the header reads as blank.
- The formatter now depends on `splitCellTexts` and the parser agreeing on
  cell boundaries (pinned by RC-6 and the D44 property test). A change to one
  splitter without the other would misplace overflow cells.
