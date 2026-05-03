/**
 * @module table/actionDescriptors
 * Purpose: Single source of truth for the table context menu actions.
 * Both the WYSIWYG menu (WI-1.3) and the planned source-mode menu
 * (Phase 2 WI-2.4) read this catalog so labels, ordering, and grouping
 * stay consistent across modes.
 *
 * Logged event family per WI-1.7: `editor.table.<id>` (see
 * src/services/loggingService.ts conventions).
 */

import type {
  TableActionDescriptor,
  TableActionId,
} from "./types";

export type {
  TableActionDescriptor,
  TableActionId,
  TableAction,
  TableActionGroup,
  TableCellAlignment,
  TableContext,
} from "./types";
export { TABLE_ACTION_GROUPS } from "./types";

/**
 * Ordered catalog. Order in this array == display order in the menu.
 * `editor.table.<id>` is the canonical structured-log event for each
 * action — keep in sync with the pinned vocabulary in WI-1.7.
 */
export const TABLE_ACTION_DESCRIPTORS: readonly TableActionDescriptor[] = [
  // Insert
  { id: "insert_row_before",    label: "Insert row above",     group: "insert" },
  { id: "insert_row_after",     label: "Insert row below",     group: "insert" },
  { id: "insert_column_before", label: "Insert column left",   group: "insert" },
  { id: "insert_column_after",  label: "Insert column right",  group: "insert" },

  // Move (boundary-disabled at edges)
  { id: "move_row_up",          label: "Move row up",          group: "move", hint: "↑" },
  { id: "move_row_down",        label: "Move row down",        group: "move", hint: "↓" },
  { id: "move_column_left",     label: "Move column left",     group: "move", hint: "←" },
  { id: "move_column_right",    label: "Move column right",    group: "move", hint: "→" },

  // Alignment (one is isActive at a time)
  { id: "align_left",           label: "Align left",           group: "alignment" },
  { id: "align_center",         label: "Align center",         group: "alignment" },
  { id: "align_right",          label: "Align right",          group: "alignment" },

  // Destructive (visually demoted via CSS)
  { id: "delete_row",           label: "Delete row",           group: "destructive" },
  { id: "delete_column",        label: "Delete column",        group: "destructive" },
  { id: "delete_table",         label: "Delete table",         group: "destructive" },
];

/** Quick lookup for action descriptors by id. */
export const TABLE_ACTION_BY_ID: Record<TableActionId, TableActionDescriptor> =
  Object.fromEntries(
    TABLE_ACTION_DESCRIPTORS.map((d) => [d.id, d]),
  ) as Record<TableActionId, TableActionDescriptor>;
