/**
 * @module sourceTableDetection
 * Purpose: Detect when the cursor is inside a GFM table in source mode
 * (Phase 2 WI-2.2). A CodeMirror StateField holds WHERE the cursor's table
 * is — a `TableSpan` — plus the ONE `TableCell` under the cursor (D12,
 * ADR-0043 Decisions 1 and 3). It never holds a `TableModel`.
 *
 * Readers:
 *  - `getTableContext` → the span, used by Tab nav only as a null gate;
 *  - `getActiveTableCell` → the cell, drawn by the cell highlight.
 * The whole-table `TableModel` is built only on a user action: each Tab
 * press parses its own (`sourceTableTabNav.ts`, ADR-0043 D5), and the
 * source-mode context menu parses its own at the click position
 * (`sourceTableContextMenu.ts`); neither reads this field's contents.
 *
 * Fence guard: positions inside ` ``` ` / ` ~~~ ` blocks give null/null,
 * checked first, so the walker never sees pipe-runs that are code content.
 *
 * Performance: recomputes on `transaction.docChanged ||
 * transaction.selection` — i.e. on every cursor move — over the editor's
 * own rope via ONE `linesFromText` adapter per update: never a copy of the
 * document into a string, never a split. `locateTableAtOffset` walks the
 * candidate run around the cursor and builds no cells; `cellAtOffset`
 * then parses only the row that owns the cursor, so at most `colCount`
 * cells are built per transaction whatever the table's row count. Nothing
 * is cached across transactions (span reuse is D12 WI-6): the adapter is
 * per-call, and a cache keyed on anything but the exact `Text` instance
 * would retain superseded document states.
 *
 * @coordinates-with src/utils/tableParser/locate.ts
 * @coordinates-with src/plugins/codemirror/textLineSource.ts
 * @coordinates-with src/plugins/codemirror/sourceTableTabNav.ts
 * @coordinates-with src/plugins/codemirror/sourceTableContextMenu.ts
 * @coordinates-with src/plugins/codemirror/sourceTableCellHighlight.ts
 */

import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { TableCell, TableSpan } from "../../utils/tableParser";
import { cellAtOffset, locateTableAtOffset } from "../../utils/tableParser/locate";
import { linesFromText } from "./textLineSource";

/**
 * Walk the markdown syntax tree at `pos` and return true if the
 * position sits inside a fenced code block (``` or ~~~). Used to
 * suppress table detection inside code so a cell-shaped line of code
 * doesn't surface as a table.
 */
export function isPositionInFencedCode(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state);
  const node = tree.resolveInner(pos, 1);
  let current: typeof node | null = node;
  while (current) {
    // The markdown grammar tags fenced code blocks as "FencedCode"
    // (with internal nodes "CodeMark" / "CodeText" / "CodeInfo").
    if (current.name === "FencedCode" || current.name === "CodeBlock") {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * The cursor's table context: the span of the table the head is in, and
 * the one cell under the head. `span` null means not in a table (or in a
 * fence); `cell` is also null on the delimiter row or between cells.
 */
interface CursorTableContext {
  readonly span: TableSpan | null;
  readonly cell: TableCell | null;
}

const NO_CONTEXT: CursorTableContext = { span: null, cell: null };

/** StateField holding the cursor's `{ span, cell }` (ADR-0043 D1/D3). */
const tableContextField = StateField.define<CursorTableContext>({
  create(state) {
    return computeContext(state);
  },
  update(value, transaction) {
    if (!transaction.docChanged && !transaction.selection) return value;
    return computeContext(transaction.state);
  },
});

/**
 * Fence check first; otherwise locate the span and the head's cell over
 * one rope adapter. Builds no `TableModel` and never flattens the doc.
 */
function computeContext(state: EditorState): CursorTableContext {
  const head = state.selection.main.head;
  if (isPositionInFencedCode(state, head)) return NO_CONTEXT;
  const src = linesFromText(state.doc);
  const span = locateTableAtOffset(src, head);
  if (span === null) return NO_CONTEXT;
  return { span, cell: cellAtOffset(src, span, head) };
}

/**
 * The span of the table the cursor is in, or null (outside any table,
 * inside a fence, or when the field is not installed). A span carries no
 * cells; callers that need the model parse it themselves.
 */
export function getTableContext(state: EditorState): TableSpan | null {
  return state.field(tableContextField, false)?.span ?? null;
}

/**
 * The table cell under the cursor, or null (delimiter row, outside any
 * table, inside a fence, or when the field is not installed).
 */
export function getActiveTableCell(state: EditorState): TableCell | null {
  return state.field(tableContextField, false)?.cell ?? null;
}

/** CodeMirror extension that registers the detection field. */
export function tableDetectionExtension(): Extension {
  return [tableContextField];
}
