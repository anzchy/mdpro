/**
 * @module table/contextMenu
 * Purpose: Two layers behind the WYSIWYG table context menu (WI-1.3):
 *
 *   1. `computeTableContext(view)` — impure; reads the live ProseMirror
 *      view to resolve current row/column, table dimensions, and the
 *      cell's alignment. Returns null when the cursor is not in a table.
 *
 *   2. `getTableActions(ctx)` — pure; given a TableContext, returns the
 *      ordered list of actions with isDisabled / isActive flags. The
 *      React component renders this list directly.
 *
 *   3. `dispatchTableAction(editor, id, ctx)` — runs the matching
 *      Milkdown command(s) against the active editor. Composes
 *      select-then-delete for the destructive actions because Milkdown
 *      doesn't ship dedicated delete-row / delete-column commands.
 *
 * @coordinates-with src/components/Editor/TableContextMenu/
 * @coordinates-with src/stores/milkdownEditorStore.ts
 */

import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  deleteSelectedCellsCommand,
  moveColCommand,
  moveRowCommand,
  selectColCommand,
  selectRowCommand,
  selectTableCommand,
  setAlignCommand,
} from "@milkdown/kit/preset/gfm";
import { findTable, TableMap } from "@milkdown/kit/prose/tables";
import {
  TABLE_ACTION_DESCRIPTORS,
  type TableAction,
  type TableActionId,
  type TableCellAlignment,
  type TableContext,
} from "./actionDescriptors";

interface MilkdownEditorLike {
  action: (fn: (ctx: unknown) => void) => void;
}

interface CommandsLike {
  call: (key: unknown, payload?: unknown) => boolean;
}

interface CtxLike {
  get: (key: unknown) => unknown;
}

interface ProseMirrorViewLike {
  state: {
    selection: {
      $from: {
        depth: number;
        pos: number;
        node: (depth: number) => { type: { name: string }; attrs?: { alignment?: string } };
      };
    };
  };
}

/**
 * Walk up from the selection to find the nearest table_cell or
 * table_header node and read its alignment attr.
 */
function findCellAlignment(view: ProseMirrorViewLike): TableCellAlignment {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const name = node.type.name;
    if (name === "table_cell" || name === "table_header") {
      const align = node.attrs?.alignment;
      if (align === "left" || align === "center" || align === "right") {
        return align;
      }
      return "left";
    }
  }
  return "left";
}

/**
 * Read row/column coordinates and table size from the live view.
 * Returns null when the cursor is not inside a table.
 */
export function computeTableContext(view: unknown): TableContext | null {
  // Treat `view` as a ProseMirror EditorView with the minimum API we need.
  // The actual type comes from @milkdown/kit/prose/view; this loose
  // typing keeps the test surface small.
  const v = view as { state: { selection: unknown; doc: unknown } } & ProseMirrorViewLike;
  const tableInfo = findTable(v.state.selection as never);
  if (!tableInfo) return null;

  const map = TableMap.get(tableInfo.node);
  // Find which cell the selection is in by scanning map.map for the
  // nearest cell pos at or before $from.pos.
  const $from = (v.state.selection as { $from: { pos: number } }).$from;
  const cellRel = $from.pos - tableInfo.start;
  let cellIndex = -1;
  for (let i = 0; i < map.map.length; i += 1) {
    if (map.map[i] >= cellRel) break;
    if (i === 0 || map.map[i] !== map.map[i - 1]) cellIndex = i;
  }
  if (cellIndex < 0) cellIndex = 0;

  const colIndex = cellIndex % map.width;
  const rowIndex = Math.floor(cellIndex / map.width);

  return {
    rowIndex,
    colIndex,
    rowCount: map.height,
    colCount: map.width,
    alignment: findCellAlignment(v),
  };
}

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

function isActionDisabled(id: TableActionId, ctx: TableContext): boolean {
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

/**
 * Dispatch the Milkdown command(s) for the given action against the
 * active editor. Returns true on success; false if the editor is
 * unavailable, the action is disabled, or the underlying command
 * declined to apply.
 *
 * Composition: deletion commands compose select-then-delete because
 * Milkdown doesn't ship dedicated `deleteRowCommand` /
 * `deleteColumnCommand` — only `deleteSelectedCellsCommand`.
 * Move commands compute their `from`/`to` from the TableContext.
 */
export function dispatchTableAction(
  editor: MilkdownEditorLike,
  id: TableActionId,
  ctx: TableContext,
): boolean {
  let applied = false;
  try {
    editor.action((rawCtx) => {
      const c = rawCtx as CtxLike;
      const commands = c.get(commandsCtx) as CommandsLike;
      // Re-validate that the cursor is still inside a table before
      // dispatching — guards against the document mutating between
      // menu open and click (mirrors the image-menu fix from #389).
      const view = c.get(editorViewCtx);
      const stillThere = computeTableContext(view);
      if (!stillThere) return;

      applied = runCommandFor(id, commands, ctx);
    });
  } catch {
    // ProseMirror or Milkdown threw — return false so the caller can
    // surface a toast / log the failure. The catch is intentionally
    // broad: the menu must never crash the editor.
    return false;
  }
  return applied;
}

function runCommandFor(
  id: TableActionId,
  commands: CommandsLike,
  ctx: TableContext,
): boolean {
  switch (id) {
    case "insert_row_before":
      return commands.call(addRowBeforeCommand.key);
    case "insert_row_after":
      return commands.call(addRowAfterCommand.key);
    case "insert_column_before":
      return commands.call(addColBeforeCommand.key);
    case "insert_column_after":
      return commands.call(addColAfterCommand.key);

    case "move_row_up":
      return commands.call(moveRowCommand.key, {
        from: ctx.rowIndex,
        to: ctx.rowIndex - 1,
      });
    case "move_row_down":
      return commands.call(moveRowCommand.key, {
        from: ctx.rowIndex,
        to: ctx.rowIndex + 1,
      });
    case "move_column_left":
      return commands.call(moveColCommand.key, {
        from: ctx.colIndex,
        to: ctx.colIndex - 1,
      });
    case "move_column_right":
      return commands.call(moveColCommand.key, {
        from: ctx.colIndex,
        to: ctx.colIndex + 1,
      });

    case "align_left":
      return commands.call(setAlignCommand.key, "left");
    case "align_center":
      return commands.call(setAlignCommand.key, "center");
    case "align_right":
      return commands.call(setAlignCommand.key, "right");

    case "delete_row":
      commands.call(selectRowCommand.key, { index: ctx.rowIndex });
      return commands.call(deleteSelectedCellsCommand.key);
    case "delete_column":
      commands.call(selectColCommand.key, { index: ctx.colIndex });
      return commands.call(deleteSelectedCellsCommand.key);
    case "delete_table":
      commands.call(selectTableCommand.key);
      return commands.call(deleteSelectedCellsCommand.key);

    default: {
      // Exhaustiveness check — TS will error if a new TableActionId is
      // added without a case here.
      const _exhaustive: never = id;
      void _exhaustive;
      return false;
    }
  }
}
