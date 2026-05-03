/**
 * @module sourceTableTabNav
 * Purpose: Tab / Shift-Tab cell navigation in source mode (Phase 2
 * WI-2.3). Mirrors the WYSIWYG WI-1.4 contract:
 *   - Tab → next cell; on the last cell of the last row, append a new
 *     row preserving column count and alignment, then move into it.
 *   - Shift-Tab → previous cell; no-op at the first header cell.
 *   - Outside a table OR inside a fenced code block → return false so
 *     the default editor Tab handler (which also handles d170f9c
 *     code-block indentation) gets a turn.
 *
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts
 * @coordinates-with src/utils/tableParser.ts
 */

import type { Command, KeyBinding } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { findCell } from "../../utils/tableParser";
import { getTableContext } from "./sourceTableDetection";

/**
 * Move to the next cell. Returns true if handled, false to let the
 * default Tab handler run.
 */
export const tableTabCommand: Command = (view) => {
  const ctx = getTableContext(view.state);
  if (!ctx) return false;

  const cursor = view.state.selection.main.head;
  const current = findCell(ctx, cursor);

  // If cursor is in the delimiter row (findCell returns null), no-op
  // — let the editor's default Tab handler insert a tab.
  if (!current) return false;

  // Find the next cell in row-major order.
  const idx = ctx.cells.indexOf(current);
  const next = ctx.cells[idx + 1];

  if (next) {
    view.dispatch({
      selection: EditorSelection.cursor(next.start),
    });
    return true;
  }

  // Last cell of the last row → append a new row and place cursor in
  // its first cell.
  appendBlankRow(view, ctx);
  return true;
};

/** Move to the previous cell. */
export const tableShiftTabCommand: Command = (view) => {
  const ctx = getTableContext(view.state);
  if (!ctx) return false;

  const cursor = view.state.selection.main.head;
  const current = findCell(ctx, cursor);
  if (!current) return false;

  const idx = ctx.cells.indexOf(current);
  if (idx <= 0) return false; // first cell of the header — no-op

  const prev = ctx.cells[idx - 1];
  view.dispatch({
    selection: EditorSelection.cursor(prev.start),
  });
  return true;
};

/**
 * Append a blank row to the table by writing a new line at ctx.end
 * matching the column count + alignment, then move the cursor into
 * its first cell.
 */
function appendBlankRow(view: import("@codemirror/view").EditorView, ctx: import("../../utils/tableParser").TableModel) {
  // Build the new row text: `| <pad> | <pad> | … |\n`. Use a single
  // space inside each cell so the cursor lands on a sensible spot
  // even if column widths differ.
  const blank = "|" + " | ".repeat(ctx.colCount) + "\n";
  // Wait — that produces `|  | … | ` with double-space at the start.
  // Use a slightly different shape: `| `, then cells joined by ` | `,
  // then ` |\n`.
  const cells = new Array(ctx.colCount).fill(" ");
  const newRow = "|" + cells.map((c) => c + " ").join("|") + "|\n";

  // ctx.end may not include a trailing newline if the table was the
  // last block in the doc. Insert at ctx.end; if the source's
  // ctx.end-1 is `\n`, our newline is well-placed; if not, prepend `\n`.
  const insertPos = ctx.end;
  const docText = view.state.doc.toString();
  const needsLeadingNewline =
    insertPos > 0 && docText[insertPos - 1] !== "\n";
  const insertion = (needsLeadingNewline ? "\n" : "") + newRow;

  // Cursor goes to the first cell content — that's `insertPos +
  // (leading newline?) + 2` (after `| `).
  const cellOffset = insertPos + (needsLeadingNewline ? 1 : 0) + 2;

  view.dispatch({
    changes: { from: insertPos, insert: insertion },
    selection: EditorSelection.cursor(cellOffset),
  });

  void blank;
}

/** Keymap entries to register on the source editor. */
export const sourceTableTabKeymap: KeyBinding[] = [
  { key: "Tab", run: tableTabCommand },
  { key: "Shift-Tab", run: tableShiftTabCommand },
];
