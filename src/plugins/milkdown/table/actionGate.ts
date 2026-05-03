/**
 * @module table/actionGate
 * Purpose: Mode-agnostic gating logic for table actions. Both the
 * WYSIWYG dispatcher (`contextMenu.ts`) and the source-mode
 * dispatcher (`utils/tableEdits/applyEdit.ts`) import from here so a
 * future tweak (e.g., disable `delete_row` when only the header
 * remains) lands in one place. Audit-fix L4.
 *
 * The path lives under `plugins/milkdown/table/` to colocate with
 * `actionDescriptors.ts` and `types.ts`, which are already shared
 * across modes.
 *
 * @coordinates-with src/plugins/milkdown/table/contextMenu.ts
 * @coordinates-with src/utils/tableEdits/applyEdit.ts
 */

import type { TableActionId, TableContext } from "./types";

/**
 * Returns true when the action should be rejected at this context —
 * currently the move-at-boundary cases. Active/checked state for the
 * alignment radio is computed elsewhere (in `getTableActions`); this
 * function only handles disable.
 */
export function isActionDisabled(
  id: TableActionId,
  ctx: TableContext,
): boolean {
  switch (id) {
    case "move_row_up":
      return ctx.rowIndex <= 0;
    case "move_row_down":
      return ctx.rowIndex >= ctx.rowCount - 1;
    case "move_column_left":
      return ctx.colIndex <= 0;
    case "move_column_right":
      return ctx.colIndex >= ctx.colCount - 1;
    default:
      return false;
  }
}
