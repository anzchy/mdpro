/**
 * @module table/tableContext
 * Purpose: `computeTableContext(view, $pos?)` — reads the live ProseMirror
 * view to resolve the row/column, table dimensions, and cell alignment at
 * `$pos` (the right-clicked position) or, when omitted, at the caret.
 * Returns null when that position is not inside a table.
 *
 * Split out of `contextMenu.ts` (D81) so the dispatcher
 * (`contextMenuDispatch.ts`) can import it without a circular import;
 * `contextMenu.ts` re-exports it, so callers keep one import path.
 *
 * @coordinates-with src/plugins/milkdown/table/contextMenu.ts
 * @coordinates-with src/plugins/milkdown/table/contextMenuDispatch.ts
 */

import { findTable, TableMap } from "@milkdown/kit/prose/tables";
import type { TableCellAlignment, TableContext } from "./actionDescriptors";

export interface ResolvedPosLike {
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
