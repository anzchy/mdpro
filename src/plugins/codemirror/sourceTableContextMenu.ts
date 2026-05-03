/**
 * @module sourceTableContextMenu
 * Purpose: Source-mode (CodeMirror) table-context-menu plumbing
 * (Phase 2 WI-2.4). Two surfaces:
 *
 *   1. `computeSourceTableContext(state, pos)` — impure read against the
 *      live editor state. Returns the parsed `TableModel` plus a
 *      `TableContext` (rowIndex, colIndex, sizes, alignment) at the
 *      given offset, or null when out of any table or inside a fenced
 *      code block. The React shell (`SourceTableContextMenu`) uses this
 *      to populate `getTableActions(ctx)` for menu rendering.
 *
 *   2. `dispatchSourceTableAction(view, id, pos)` — re-parses fresh
 *      (audit H3 — never trust stale ctx between menu open and click),
 *      computes the edit via `tableEdits.applyEdit`, and dispatches a
 *      single CodeMirror transaction that splices the new source into
 *      `[model.start, model.end)` and places the cursor at
 *      `model.start + result.cursorOffset`.
 *
 * Mirror of the WYSIWYG `dispatchTableAction` semantics:
 *   - Disabled actions (move at boundary) → returns false
 *   - Stale/out-of-table position → returns false
 *   - Fenced-code position → returns false (fence guard)
 *
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts
 * @coordinates-with src/utils/tableEdits.ts
 * @coordinates-with src/components/Editor/SourceTableContextMenu/
 */

import { EditorSelection, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { findCell, parseTableAt, type TableModel } from "../../utils/tableParser";
import { applyEdit } from "../../utils/tableEdits";
import { isPositionInFencedCode } from "./sourceTableDetection";
import type {
  TableActionId,
  TableCellAlignment,
  TableContext,
} from "../milkdown/table/types";

export interface SourceTableContextResult {
  ctx: TableContext;
  model: TableModel;
}

/**
 * Compute the table context (and underlying model) at the given source
 * offset. Returns null when the offset is not inside any table cell —
 * including positions in the delimiter row, between cells, or inside a
 * fenced code block.
 */
export function computeSourceTableContext(
  state: EditorState,
  pos: number,
): SourceTableContextResult | null {
  if (isPositionInFencedCode(state, pos)) return null;
  const source = state.doc.toString();
  const model = parseTableAt(source, pos);
  if (!model) return null;
  const cell = findCell(model, pos);
  if (!cell) return null;
  const align = model.alignments[cell.col];
  const alignment: TableCellAlignment =
    align === "left" || align === "center" || align === "right"
      ? align
      : "left";
  const ctx: TableContext = {
    rowIndex: cell.row,
    colIndex: cell.col,
    rowCount: model.rowCount,
    colCount: model.colCount,
    alignment,
  };
  return { ctx, model };
}

/**
 * Apply the table action at the given right-click offset. Re-parses
 * fresh from the live state — does NOT trust a snapshot taken at
 * menu-open. Returns true when the edit was applied.
 */
export function dispatchSourceTableAction(
  view: EditorView,
  id: TableActionId,
  pos: number,
): boolean {
  const fresh = computeSourceTableContext(view.state, pos);
  if (!fresh) return false;
  const result = applyEdit(fresh.model, fresh.ctx, id);
  if (!result) return false;

  const cursorAbs = fresh.model.start + result.cursorOffset;
  view.dispatch({
    changes: {
      from: fresh.model.start,
      to: fresh.model.end,
      insert: result.source,
    },
    selection: EditorSelection.cursor(cursorAbs),
  });
  return true;
}
