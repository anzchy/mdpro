/**
 * @module sourceTableDetection
 * Purpose: Detect when the cursor is inside a GFM table in source mode
 * (Phase 2 WI-2.2). A CodeMirror StateField holds WHERE the cursor's table
 * is — a `TableSpan` — plus the ONE `TableCell` under the cursor (D12,
 * ADR-0043 Decisions 1 and 3). It never holds a `TableModel`.
 *
 * Readers:
 *  - `getTableContext` → the span (no production reader since D41);
 *  - `getActiveTableCell` → the cell, drawn by the cell highlight;
 *  - `hasTableDetection` → only whether the field is installed: Tab's gate
 *    (D41, ADR-0046). Tab classifies REAL lines itself
 *    (`sourceTableTabOwnership.ts`) and never reads the field's value.
 * The whole-table `TableModel` is built only on a user action: each Tab
 * press parses its own (ADR-0043 D5), and the source-mode context menu
 * parses its own at the click position (`sourceTableContextMenu.ts`).
 *
 * Fence guard: positions inside ` ``` ` / ` ~~~ ` blocks give null/null,
 * checked first, so the walker never sees pipe-runs that are code content.
 *
 * Performance: a `docChanged` transaction always runs the full
 * `computeContext` (fence check, `locateTableAtOffset`, `cellAtOffset`)
 * over the editor's own rope via ONE `linesFromText` adapter: never a
 * copy of the document into a string, never a split, and at most
 * `colCount` cells built. A selection-only transaction REUSES the
 * previous span (ADR-0043 Decision 4) when the head is not fenced, the
 * span is non-null with `delimiterIsCandidate`, and the RAW
 * `lineIndexAt(head)` lies in `[headerLine, lastLine]`; it then reads
 * only the owning row via `cellAtResolvedLine`, a constant number of
 * rope reads whatever the row count. Otherwise it re-locates over the
 * same adapter.
 *
 * Invariant: no reuse path may skip the `delimiterIsCandidate` check or
 * run on `docChanged`, and the reuse check uses the raw `lineIndexAt`,
 * never WI-3's adjusted owning-row rule (a header at column 0 under a
 * non-candidate line would otherwise keep a span where a fresh locate
 * gives null). The cached span is valid only for the `Text` it was
 * computed on; because the value is recomputed on every doc change, it
 * always belongs to the current `Text`. Nothing else is cached: the
 * adapter is per-update, and a cache keyed on anything but the exact
 * `Text` instance would retain superseded document states.
 *
 * @coordinates-with src/utils/tableParser/locate.ts
 * @coordinates-with src/plugins/codemirror/textLineSource.ts
 * @coordinates-with src/plugins/codemirror/sourceTableTabOwnership.ts
 * @coordinates-with src/plugins/codemirror/sourceTableContextMenu.ts
 * @coordinates-with src/plugins/codemirror/sourceTableCellHighlight.ts
 */

import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { TableCell, TableSpan } from "../../utils/tableParser";
import {
  cellAtOffset,
  cellAtResolvedLine,
  locateTableAtOffset,
} from "../../utils/tableParser/locate";
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

/**
 * StateField holding the cursor's `{ span, cell }` (ADR-0043 D1/D3/D4).
 * Doc changes always recompute from scratch; selection-only moves go
 * through `reuseOrRelocate`.
 */
const tableContextField = StateField.define<CursorTableContext>({
  create(state) {
    return computeContext(state);
  },
  update(value, transaction) {
    if (transaction.docChanged) return computeContext(transaction.state);
    if (!transaction.selection) return value;
    return reuseOrRelocate(value, transaction.state);
  },
});

/**
 * Fence check first; otherwise locate the span and the head's cell over
 * one rope adapter. Builds no `TableModel` and never flattens the doc.
 * The only path taken on a doc change.
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
 * Selection-only update (ADR-0043 D4). Fence check first; then, over ONE
 * adapter, resolve the RAW `lineIndexAt(head)` and keep `prev.span` (same
 * object) when it is candidate-delimited and the raw line is inside it,
 * reading only the owning row. Otherwise re-locate. Never valid for a
 * transaction that changed the doc: `prev.span`'s line indices belong to
 * the previous `Text`.
 */
function reuseOrRelocate(prev: CursorTableContext, state: EditorState): CursorTableContext {
  const head = state.selection.main.head;
  if (isPositionInFencedCode(state, head)) return NO_CONTEXT;
  const src = linesFromText(state.doc);
  const span = prev.span;
  if (span !== null && span.delimiterIsCandidate) {
    const lineIdx = src.lineIndexAt(head);
    if (lineIdx >= span.headerLine && lineIdx <= span.lastLine) {
      return { span, cell: cellAtResolvedLine(src, span, lineIdx, head) };
    }
  }
  const located = locateTableAtOffset(src, head);
  if (located === null) return NO_CONTEXT;
  return { span: located, cell: cellAtOffset(src, located, head) };
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

/**
 * True when the detection field is installed on `state` — false for a
 * withheld document, whose table extensions are removed. Reads no value.
 */
export function hasTableDetection(state: EditorState): boolean {
  return state.field(tableContextField, false) !== undefined;
}

/** CodeMirror extension that registers the detection field. */
export function tableDetectionExtension(): Extension {
  return [tableContextField];
}
