/**
 * @module TableInsertModal
 * Purpose: React inline modal for inserting a GFM table in WYSIWYG
 * mode. Mirrors LinkInsertModal's lifecycle and ARIA contract;
 * extends with a 10×10 visual grid picker and numeric inputs (1-50).
 *
 * Lifecycle:
 *   - Renders when useTableInsertStore.pendingCallback is set.
 *   - Initial dimensions: 3 body rows × 3 cols (Notion default).
 *   - User picks via grid hover-and-click OR types into numeric inputs.
 *   - Submit (Enter / Insert button) → `pendingCallback(rows, cols)`.
 *   - Cancel (Esc / Cancel button / backdrop click) → `clearPending()`.
 *   - Inline error region (role=alert) surfaces when the callback
 *     returns false (cursor inside an existing table).
 *
 * Semantics: `rows = N` means N **body** rows. The resulting GFM
 * table has `rows + 1` total rows because the header row is always
 * added. The live count text makes this explicit.
 *
 * @coordinates-with src/stores/tableInsertStore.ts
 * @coordinates-with src/plugins/milkdown/table/insertTable.ts
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx
 */

import { useEffect, useId, useRef, useState } from "react";
import { useTableInsertStore } from "../../../stores/tableInsertStore";
import { loggingService } from "../../../services/loggingService";
import { GridPicker } from "./GridPicker";

const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 3;
const GRID_MAX_ROWS = 10;
const GRID_MAX_COLS = 10;
const ABS_MIN = 1;
const ABS_MAX = 50;

function clampDim(value: number): number {
  if (!Number.isFinite(value)) return ABS_MIN;
  return Math.max(ABS_MIN, Math.min(ABS_MAX, Math.round(value)));
}

export function TableInsertModal() {
  const pendingCallback = useTableInsertStore((state) => state.pendingCallback);
  const [rows, setRows] = useState<number>(DEFAULT_ROWS);
  const [cols, setCols] = useState<number>(DEFAULT_COLS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rowsInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const countId = useId();

  const isOpen = pendingCallback !== null;

  // Reset state and focus the rows input when the modal opens.
  useEffect(() => {
    if (isOpen) {
      setRows(DEFAULT_ROWS);
      setCols(DEFAULT_COLS);
      setErrorMessage(null);
      requestAnimationFrame(() => rowsInputRef.current?.focus());
      loggingService.logEventSync({
        level: "info",
        event: "ui.table-modal.open",
        status: "success",
        actionId: loggingService.generateActionId(),
        context: { screen: "wysiwyg" },
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    const cb = useTableInsertStore.getState().pendingCallback;
    if (!cb) return;

    const safeRows = clampDim(rows);
    const safeCols = clampDim(cols);
    setRows(safeRows);
    setCols(safeCols);

    // The callback returns boolean if the dispatcher follows the
    // runInsertTable contract; treat undefined as success for callbacks
    // that don't surface a result (legacy / no-op fallback paths).
    const result = (cb as (r: number, c: number) => boolean | void)(safeRows, safeCols);
    const succeeded = result !== false;

    loggingService.logEventSync({
      level: succeeded ? "info" : "warn",
      event: "ui.table-modal.submit",
      status: succeeded ? "success" : "fail",
      actionId: loggingService.generateActionId(),
      context: { screen: "wysiwyg", rows: safeRows, cols: safeCols },
    });

    if (!succeeded) {
      // WI-1.1 acceptance: failure shows inline error, modal does NOT auto-close.
      setErrorMessage(
        "Cursor is inside another table. Close this dialog, click outside the existing table, then try again.",
      );
      return;
    }

    useTableInsertStore.getState().clearPending();
  };

  const handleCancel = () => {
    useTableInsertStore.getState().clearPending();
    loggingService.logEventSync({
      level: "info",
      event: "ui.table-modal.cancel",
      status: "cancel",
      actionId: loggingService.generateActionId(),
      context: { screen: "wysiwyg" },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        className="dialog-card table-insert-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={countId}
        onKeyDown={handleKeyDown}
      >
        <h3 className="dialog-title" id={titleId}>
          Insert Table
          <span className="dialog-title-hint">⌘⌥T</span>
        </h3>

        <GridPicker
          maxRows={GRID_MAX_ROWS}
          maxCols={GRID_MAX_COLS}
          rows={rows}
          cols={cols}
          onPick={(r, c) => {
            setRows(r);
            setCols(c);
          }}
        />

        <div className="table-insert-count" id={countId} aria-live="polite">
          {rows} × {cols} (header + {rows} body row{rows === 1 ? "" : "s"} × {cols} col
          {cols === 1 ? "" : "s"})
        </div>

        <div className="table-insert-divider">— or specify —</div>

        <div className="table-insert-numeric">
          <label className="table-insert-label">
            Rows
            <input
              ref={rowsInputRef}
              type="number"
              min={ABS_MIN}
              max={ABS_MAX}
              value={rows}
              onChange={(e) => setRows(clampDim(Number(e.target.value)))}
              className="table-insert-input"
            />
          </label>
          <label className="table-insert-label">
            Cols
            <input
              type="number"
              min={ABS_MIN}
              max={ABS_MAX}
              value={cols}
              onChange={(e) => setCols(clampDim(Number(e.target.value)))}
              className="table-insert-input"
            />
          </label>
        </div>

        {errorMessage ? (
          <div className="table-insert-error" role="alert">
            {errorMessage}
          </div>
        ) : null}

        <div className="dialog-actions">
          <button className="toolbar-button" onClick={handleCancel} type="button">
            Cancel
          </button>
          <button
            className="toolbar-button toolbar-button--primary"
            onClick={handleSubmit}
            type="button"
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
