/**
 * @module TableContextMenu/resolveMenuTarget
 * Purpose: Turns a right-click on a WYSIWYG table cell into the menu's
 * target — the clicked cell's `TableContext` plus a `TableTarget` position
 * strictly inside that cell — or null when no cell can be verified.
 *
 * Pipeline: clicked `td`/`th` element → `view.posAtDOM(cell, 0)` (a
 * position at the start of that cell's content) → strict
 * `computeTableContext` must resolve it to a cell → if `view.posAtCoords`
 * lands strictly inside the SAME cell, that position is kept so the caret
 * lands where the user clicked; otherwise the posAtDOM position is used.
 *
 * Key decisions:
 *   - D87: the DOM cell, not `posAtCoords`, decides which cell is targeted.
 *     A click on a cell border or its padding makes `posAtCoords` return a
 *     cell or row boundary, which used to resolve to the previous cell; the
 *     menu then deleted the wrong row/column.
 *   - No verified cell (posAtDOM throws, or its position is not inside a
 *     cell) returns null: the menu does not open rather than guess.
 *
 * @coordinates-with src/components/Editor/TableContextMenu/index.tsx
 * @coordinates-with src/plugins/milkdown/table/tableContext.ts
 */

import {
  computeTableContext,
  tableCellStartAt,
  type TableTarget,
} from "../../../plugins/milkdown/table/contextMenu";
import type { TableContext } from "../../../plugins/milkdown/table/actionDescriptors";
import type { ResolvedPosLike } from "../../../plugins/milkdown/table/tableContext";

/** The slice of the ProseMirror `EditorView` this module reads. */
export interface MenuViewLike {
  posAtCoords: (coords: { left: number; top: number }) => { pos: number } | null;
  posAtDOM: (node: Node, offset: number) => number;
  state: { doc: { resolve: (pos: number) => unknown } };
}

export interface MenuTarget {
  context: TableContext;
  target: TableTarget;
}

/** Position from `fn`, or null when it throws (a DOM node outside the view). */
function safePos(fn: () => number | null | undefined): number | null {
  try {
    const pos = fn();
    return typeof pos === "number" ? pos : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the menu target for a right-click on `cellEl` (the clicked
 * `td`/`th`) at viewport `coords`. Null when no cell can be verified.
 */
export function resolveMenuTarget(
  view: MenuViewLike,
  cellEl: Element,
  coords: { left: number; top: number },
): MenuTarget | null {
  const { doc } = view.state;
  const resolve = (pos: number) => doc.resolve(pos) as ResolvedPosLike;
  // doc.resolve throws on an out-of-range position: treat it as no cell.
  const cellStartOf = (pos: number): number | null => {
    try {
      return tableCellStartAt(resolve(pos));
    } catch {
      return null;
    }
  };

  const domPos = safePos(() => view.posAtDOM(cellEl, 0));
  if (domPos === null) return null;
  const cellStart = cellStartOf(domPos);
  if (cellStart === null) return null;

  const coordPos = safePos(() => view.posAtCoords(coords)?.pos);
  const pos = coordPos !== null && cellStartOf(coordPos) === cellStart ? coordPos : domPos;

  const context = computeTableContext(view, resolve(pos));
  if (!context) return null;
  return { context, target: { pos, doc } };
}
