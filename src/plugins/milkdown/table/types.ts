/**
 * @module table/types
 * Purpose: Shared types for the WYSIWYG table context menu (WI-1.3) and
 * the future source-mode table context menu (Phase 2 WI-2.4).
 *
 * The TableContext is the small computed snapshot the React component
 * passes to the pure `getTableActions` function — keeps the gating /
 * isActive / isDisabled logic free of editor mocks in tests.
 */

export const TABLE_ACTION_GROUPS = [
  "insert",
  "move",
  "alignment",
  "destructive",
] as const;

export type TableActionGroup = (typeof TABLE_ACTION_GROUPS)[number];

export type TableActionId =
  | "insert_row_before"
  | "insert_row_after"
  | "insert_column_before"
  | "insert_column_after"
  | "move_row_up"
  | "move_row_down"
  | "move_column_left"
  | "move_column_right"
  | "align_left"
  | "align_center"
  | "align_right"
  | "delete_row"
  | "delete_column"
  | "delete_table";

export type TableCellAlignment = "left" | "center" | "right";

export interface TableContext {
  /** 0-based row index of the active cell. */
  rowIndex: number;
  /** 0-based column index of the active cell. */
  colIndex: number;
  /** Total number of rows in the table (header + body). */
  rowCount: number;
  /** Total number of columns in the table. */
  colCount: number;
  /** Current cell's alignment (defaults to "left" in the gfm schema). */
  alignment: TableCellAlignment;
}

export interface TableActionDescriptor {
  id: TableActionId;
  label: string;
  group: TableActionGroup;
  /** Optional keyboard hint shown right-aligned in the menu (e.g. "↑"). */
  hint?: string;
}

export interface TableAction extends TableActionDescriptor {
  isDisabled: boolean;
  isActive: boolean;
}
