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
import { isActionDisabled } from "./actionGate";

interface MilkdownEditorLike {
  action: (fn: (ctx: unknown) => void) => void;
}

interface CommandsLike {
  call: (key: unknown, payload?: unknown) => boolean;
}

interface CtxLike {
  get: (key: unknown) => unknown;
}

interface ResolvedPosLike {
  depth: number;
  pos: number;
  node: (depth: number) => { type: { name: string }; attrs?: { alignment?: string } };
}

/**
 * Walk up from a ResolvedPos to find the nearest table_cell or
 * table_header node and read its alignment attr.
 */
function findCellAlignmentFromPos($pos: ResolvedPosLike): TableCellAlignment {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
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
 * Returns null when `$pos` (or `view.state.selection.$from` when omitted)
 * is not inside a table.
 *
 * Audit fix H1 (commit c306e4b..2b88a66 audit): `findTable` requires a
 * `ResolvedPos`, not a `Selection`. Passing the selection silently
 * returned null for every right-click.
 *
 * Audit fix H5: when a `$pos` is provided, the result reflects that
 * position (typically derived from `view.posAtCoords` for right-clicks),
 * not the cursor position.
 */
export function computeTableContext(
  view: unknown,
  $pos?: ResolvedPosLike,
): TableContext | null {
  const v = view as { state: { selection: { $from: ResolvedPosLike }; doc: unknown } };
  const $from: ResolvedPosLike = $pos ?? v.state.selection.$from;
  const tableInfo = findTable($from as never);
  if (!tableInfo) return null;

  const map = TableMap.get(tableInfo.node);
  // Find which cell the position is in by scanning map.map for the
  // nearest cell pos at or before $from.pos.
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
    alignment: findCellAlignmentFromPos($from),
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

/**
 * Dispatch the Milkdown command(s) for the given action against the
 * active editor. Returns true on success; false if the editor is
 * unavailable, the action is disabled at the fresh table position,
 * the table no longer exists, or the underlying command declined.
 *
 * Composition: deletion commands compose select-then-delete because
 * Milkdown doesn't ship dedicated `deleteRowCommand` /
 * `deleteColumnCommand` — only `deleteSelectedCellsCommand`. The
 * select must succeed before the delete fires (audit fix H4),
 * otherwise a stale selection would be deleted instead of the
 * intended target.
 *
 * Audit fix H3: uses the freshly-recomputed TableContext for command
 * payloads. The original `ctx` (captured at menu-open time) is only
 * used as a hint for which cell the user right-clicked; the dispatch
 * works on the current document state.
 *
 * Audit fix M1: rejects disabled actions before running the command,
 * so callers can dispatch without checking `isActionDisabled`
 * themselves and the boundary case (move at the edge) can never
 * produce out-of-range indices.
 */
/**
 * Keyboard-shortcut entry point. Fresh-computes a TableContext from
 * the live view (no menu-open snapshot), then routes through the
 * standard `dispatchTableAction` so the audit-fix H3 (always-fresh
 * recompute) and M1 (disabled-action gate) paths apply uniformly.
 *
 * Returns false (no-op) when the editor isn't available or the cursor
 * isn't in a table — making the shortcut harmless to fire outside.
 */
export function dispatchTableActionFromKeyboard(
  editor: MilkdownEditorLike,
  id: TableActionId,
): boolean {
  let ctx: TableContext | null = null;
  try {
    editor.action((rawCtx) => {
      const c = rawCtx as CtxLike;
      const view = c.get(editorViewCtx);
      ctx = computeTableContext(view);
    });
  } catch {
    return false;
  }
  if (!ctx) return false;
  return dispatchTableAction(editor, id, ctx);
}

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
      const view = c.get(editorViewCtx);
      // Recompute from the live view so out-of-date row/col indices
      // (e.g. after concurrent typing) don't mutate the wrong cell.
      const fresh = computeTableContext(view);
      if (!fresh) return;
      // Reject disabled actions at the fresh boundary.
      if (isActionDisabled(id, fresh)) return;

      applied = runCommandFor(id, commands, fresh);
    });
  } catch {
    // ProseMirror or Milkdown threw — return false so the caller can
    // surface a toast / log the failure. The catch is intentionally
    // broad: the menu must never crash the editor.
    return false;
  }
  // Suppress unused-parameter warning — `ctx` is kept for API stability
  // (callers pass the menu-open context). Future change may use it for
  // identity comparison against `fresh`.
  void ctx;
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

    case "reformat_table":
      // Phase 3 WI-3.2: in WYSIWYG, "Reformat table" is a visible no-op.
      // Milkdown's GFM serializer emits compact (unpadded) markdown on
      // every keystroke via the listener; padding our way and writing
      // back would be undone the moment the user types. The action is
      // kept in the descriptor catalog for menu parity — source mode
      // does the real work via tableEdits.applyEdit.
      return false;

    case "delete_row":
      // H4 fix: short-circuit on select failure — without the &&, a
      // failed select would leave the existing selection in place and
      // the delete would mutate the wrong row (or worse, the user's
      // current text selection).
      return (
        commands.call(selectRowCommand.key, { index: ctx.rowIndex }) &&
        commands.call(deleteSelectedCellsCommand.key)
      );
    case "delete_column":
      return (
        commands.call(selectColCommand.key, { index: ctx.colIndex }) &&
        commands.call(deleteSelectedCellsCommand.key)
      );
    case "delete_table":
      return (
        commands.call(selectTableCommand.key) &&
        commands.call(deleteSelectedCellsCommand.key)
      );

    default: {
      // Exhaustiveness check — TS will error if a new TableActionId is
      // added without a case here.
      const _exhaustive: never = id;
      void _exhaustive;
      return false;
    }
  }
}
