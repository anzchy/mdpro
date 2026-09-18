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
 *   - Model refused by `tableWriteGuard` → returns false, and the menu
 *     does not open in the first place (WI-C0 write-boundary backstop)
 *
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts
 * @coordinates-with src/utils/tableWriteGuard.ts
 * @coordinates-with src/plugins/codemirror/textLineSource.ts
 * @coordinates-with src/utils/tableEdits.ts
 * @coordinates-with src/components/Editor/SourceTableContextMenu/
 */

import { EditorSelection, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { findCellOrNearest, type TableModel } from "../../utils/tableParser";
import { parseTableAtOffset } from "../../utils/tableParser/parse";
import { applyEdit } from "../../utils/tableEdits";
import { guardTableWrite } from "../../utils/tableWriteGuard";
import { isPositionInFencedCode } from "./sourceTableDetection";
import { linesFromText } from "./textLineSource";
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
 * offset. Returns null when the offset is outside any table, inside a
 * fenced code block, or on a model the write guard refuses. Audit-fix
 * M4: clicks on the delimiter row or directly on a `|` separator are
 * mapped to the nearest cell so the context menu still opens with a
 * sensible column selection.
 *
 * WI-C0 (plan §3.1 W3): the guard runs HERE rather than only in
 * `dispatchSourceTableAction`, because this function is also what the
 * React shell uses to decide whether to open the menu at all. Refusing
 * here removes the false affordance — no table menu appears over text
 * the guard would not let us rewrite — and covers the dispatch path for
 * free, since dispatch re-enters through this function.
 */
export function computeSourceTableContext(
  state: EditorState,
  pos: number,
): SourceTableContextResult | null {
  if (isPositionInFencedCode(state, pos)) return null;
  // Over the rope (WI-3B): a right-click in a multi-MB document reads
  // the candidate run around `pos` and nothing else.
  const model = parseTableAtOffset(linesFromText(state.doc), pos);
  if (!model) return null;
  if (!guardTableWrite(model, "source.context_menu")) return null;
  const cell = findCellOrNearest(model, pos);
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
