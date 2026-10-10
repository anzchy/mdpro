/**
 * @module table/tableContext
 * Purpose: `computeTableContext(view, $pos?)` — reads the live ProseMirror
 * view to resolve the row/column, table dimensions, and cell alignment at
 * `$pos` (the right-clicked position) or, when omitted, at the caret.
 * Returns null when that position is not strictly inside a table cell.
 * `tableCellStartAt($pos)` returns the position just before that cell, so
 * callers can tell whether two positions are in the same cell.
 *
 * Split out of `contextMenu.ts` (D81) so the dispatcher
 * (`contextMenuDispatch.ts`) can import it without a circular import;
 * `contextMenu.ts` re-exports it, so callers keep one import path.
 *
 * Key decisions:
 *   - D87: the cell is resolved strictly — the nearest `table_cell` /
 *     `table_header` ancestor of `$pos` inside the innermost table, located
 *     with `TableMap.findCell`. A position that is not inside a cell (at a
 *     cell's start boundary, or between two rows) returns null instead of
 *     being guessed. The old `map.map` scan resolved such positions to the
 *     PREVIOUS cell, and the menu then deleted the wrong row/column.
 *
 * @coordinates-with src/plugins/milkdown/table/contextMenu.ts
 * @coordinates-with src/plugins/milkdown/table/contextMenuDispatch.ts
 * @coordinates-with src/components/Editor/TableContextMenu/resolveMenuTarget.ts
 */

import { findTable, TableMap } from "@milkdown/kit/prose/tables";
import type { TableCellAlignment, TableContext } from "./actionDescriptors";

export interface ResolvedPosLike {
  depth: number;
  pos: number;
  node: (depth: number) => { type: { name: string }; attrs?: { alignment?: string } };
  /** Position just before the ancestor node at `depth` (ProseMirror `ResolvedPos.before`). */
  before: (depth: number) => number;
}

interface StrictCell {
  /** Depth of the cell node in `$pos`. */
  depth: number;
  /** The innermost table holding the cell. */
  table: NonNullable<ReturnType<typeof findTable>>;
}

function isCellName(name: string): boolean {
  return name === "table_cell" || name === "table_header";
}

/**
 * The cell `$pos` is strictly inside: a cell ancestor that is a direct
 * child of a row of the innermost table (depth = table depth + 2). Null for
 * positions outside a table or between cells/rows.
 */
function strictCellAt($pos: ResolvedPosLike): StrictCell | null {
  const table = findTable($pos as never);
  if (!table) return null;
  const depth = table.depth + 2;
  if ($pos.depth < depth || !isCellName($pos.node(depth).type.name)) return null;
  return { depth, table };
}

/** Alignment attr of the cell node, defaulting to left. */
function cellAlignment($pos: ResolvedPosLike, depth: number): TableCellAlignment {
  const align = $pos.node(depth).attrs?.alignment;
  if (align === "left" || align === "center" || align === "right") return align;
  return "left";
}

/**
 * Position just before the cell `$pos` is strictly inside, or null when it
 * is not inside a cell (D87). Two positions are in the same cell exactly
 * when this returns the same number for both.
 */
export function tableCellStartAt($pos: ResolvedPosLike): number | null {
  const cell = strictCellAt($pos);
  return cell ? $pos.before(cell.depth) : null;
}

/**
 * Read row/column coordinates and table size from the live view.
 * Returns null when `$pos` (or `view.state.selection.$from` when omitted)
 * is not strictly inside a table cell (D87: no guessing at boundaries).
 *
 * Audit fix H1 (commit c306e4b..2b88a66 audit): `findTable` requires a
 * `ResolvedPos`, not a `Selection`. Passing the selection silently
 * returned null for every right-click.
 *
 * Audit fix H5: when a `$pos` is provided, the result reflects that
 * position (the right-clicked cell, see `resolveMenuTarget.ts`), not the
 * cursor position.
 */
export function computeTableContext(
  view: unknown,
  $pos?: ResolvedPosLike,
): TableContext | null {
  const v = view as { state: { selection: { $from: ResolvedPosLike }; doc: unknown } };
  const $from: ResolvedPosLike = $pos ?? v.state.selection.$from;
  const cell = strictCellAt($from);
  if (!cell) return null;

  const map = TableMap.get(cell.table.node);
  let rect: { left: number; top: number };
  try {
    rect = map.findCell($from.before(cell.depth) - cell.table.start);
  } catch {
    // findCell throws when the offset is not a cell start in the map.
    return null;
  }

  return {
    rowIndex: rect.top,
    colIndex: rect.left,
    rowCount: map.height,
    colCount: map.width,
    alignment: cellAlignment($from, cell.depth),
  };
}
