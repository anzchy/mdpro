/**
 * @module tableParser/find
 * Purpose: Cell-lookup helpers against a parsed `TableModel`. Lives
 * separately from `parse.ts` so the latter stays under the rule-50
 * size guideline and so consumers that only need cell lookups don't
 * pull in the full parser surface.
 *
 * Not on the Source cursor path: since D12 (ADR-0043 D3) the per-move
 * cell comes from `locate.ts#cellAtOffset` / `cellAtResolvedLine`,
 * which read only the cursor's row. `findCell` is their equivalence
 * oracle and serves whole-model consumers.
 *
 * @coordinates-with src/utils/tableParser/parse.ts
 * @coordinates-with src/utils/tableParser/locate.ts
 */

import type { TableCell, TableModel } from "./types";

/**
 * Locate the cell at a given character offset within the original
 * source. Returns null when the offset is between cells (e.g., inside
 * a `|` separator or in the delimiter row).
 */
export function findCell(model: TableModel, offset: number): TableCell | null {
  for (const cell of model.cells) {
    if (offset >= cell.start && offset < cell.end) return cell;
  }
  return null;
}

/**
 * `findCell` falls back to the nearest cell by offset distance when
 * the strict match fails (delimiter row, pipe boundary, end-of-cell
 * whitespace). Used by the source-mode context menu (audit M4) so a
 * right-click on `|` or `---` still opens the menu and can act on a
 * sensible column. Returns null only when the model has no cells.
 */
export function findCellOrNearest(
  model: TableModel,
  offset: number,
): TableCell | null {
  const exact = findCell(model, offset);
  if (exact) return exact;
  let nearest: TableCell | null = null;
  let nearestDist = Infinity;
  for (const cell of model.cells) {
    const dist =
      offset < cell.start
        ? cell.start - offset
        : offset > cell.end
          ? offset - cell.end
          : 0;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = cell;
    }
  }
  return nearest;
}
