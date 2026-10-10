/**
 * @module table/contextMenu
 * Purpose: Public entry point for the WYSIWYG table context menu
 * (WI-1.3). Three layers, one import path:
 *
 *   1. `computeTableContext(view, $pos?)` — impure; reads the live
 *      ProseMirror view to resolve row/column, table dimensions, and the
 *      cell's alignment at `$pos` (the right-clicked position) or at the
 *      caret. Returns null outside a table. Lives in `tableContext.ts`.
 *
 *   2. `getTableActions(ctx)` — pure; given a TableContext, returns the
 *      ordered list of actions with isDisabled / isActive flags. The
 *      React component renders this list directly. Lives here.
 *
 *   3. `dispatchTableAction(editor, id, ctx, target?)` and
 *      `dispatchTableActionDetailed` — run the action on the
 *      right-clicked cell (`target`, D81) or on the caret's cell, after
 *      re-gating it on a fresh context; a target from an older doc is
 *      refused as `stale-position`. Live in `contextMenuDispatch.ts`.
 *
 * @coordinates-with src/plugins/milkdown/table/tableContext.ts
 * @coordinates-with src/plugins/milkdown/table/contextMenuDispatch.ts
 * @coordinates-with src/plugins/milkdown/table/contextMenuCommands.ts
 * @coordinates-with src/components/Editor/TableContextMenu/
 * @coordinates-with src/stores/milkdownEditorStore.ts
 */

import {
  TABLE_ACTION_DESCRIPTORS,
  type TableAction,
  type TableActionId,
  type TableContext,
} from "./actionDescriptors";
import { isActionDisabled } from "./actionGate";

export { computeTableContext } from "./tableContext";
export {
  dispatchTableAction,
  dispatchTableActionDetailed,
  dispatchTableActionFromKeyboard,
  type TableDispatchReason,
  type TableDispatchResult,
  type TableTarget,
} from "./contextMenuDispatch";

/** Pure function — derives the per-cell action list from the context. */
export function getTableActions(ctx: TableContext): TableAction[] {
  return TABLE_ACTION_DESCRIPTORS.map((descriptor): TableAction => {
    const isActive = isActionActive(descriptor.id, ctx);
    const isDisabled = isActionDisabled(descriptor.id, ctx);
    return { ...descriptor, isActive, isDisabled };
  });
}

function isActionActive(id: TableActionId, ctx: TableContext): boolean {
  switch (id) {
    case "align_left":
      return ctx.alignment === "left";
    case "align_center":
      return ctx.alignment === "center";
    case "align_right":
      return ctx.alignment === "right";
    default:
      return false;
  }
}
