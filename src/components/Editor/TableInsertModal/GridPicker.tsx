/**
 * @module GridPicker
 * Purpose: Visual rows × cols picker — hover (or arrow-key navigate)
 * to highlight the rect from top-left to the cursor; click (or Enter)
 * to commit. Notion-/Typora-style. Numeric inputs in the parent
 * modal cover values >10.
 *
 * @coordinates-with src/components/Editor/TableInsertModal/index.tsx
 */

import { useState } from "react";

interface GridPickerProps {
  /** Maximum dimensions of the visual grid (rows / cols). */
  maxRows: number;
  maxCols: number;
  /** Currently selected dimensions (drives the highlight). */
  rows: number;
  cols: number;
  /**
   * Called when the user clicks a cell or commits via keyboard.
   * The parent translates this into a numeric-input update too.
   */
  onPick: (rows: number, cols: number) => void;
}

export function GridPicker({ maxRows, maxCols, rows, cols, onPick }: GridPickerProps) {
  // Local hover state — a separate "preview" rectangle that overrides
  // the committed selection while the pointer is inside the grid.
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null);

  const activeRow = hovered?.row ?? rows;
  const activeCol = hovered?.col ?? cols;

  return (
    <div
      className="grid-picker"
      role="grid"
      aria-label={`Pick a grid size — currently ${rows} by ${cols}`}
      onMouseLeave={() => setHovered(null)}
    >
      {Array.from({ length: maxRows }, (_, rIdx) => {
        const r = rIdx + 1;
        return (
          <div className="grid-picker-row" role="row" key={r}>
            {Array.from({ length: maxCols }, (_, cIdx) => {
              const c = cIdx + 1;
              const isHighlighted = r <= activeRow && c <= activeCol;
              return (
                <button
                  key={c}
                  type="button"
                  role="gridcell"
                  aria-selected={isHighlighted}
                  className={`grid-picker-cell${isHighlighted ? " is-highlighted" : ""}`}
                  onMouseEnter={() => setHovered({ row: r, col: c })}
                  onClick={() => onPick(r, c)}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
