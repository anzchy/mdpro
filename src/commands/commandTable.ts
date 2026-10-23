/**
 * Purpose: the command table (plan docs/plans/20261015-plan-menu-reorganisation.md
 * § 5.5, ADR-0114 K6): one row per command with its menu path, v1 / v2 keys,
 * ownership contexts, availability and route per platform. M1b consumes v2
 * through the applied snapshot in Settings, menus and editors. `menu_layout.json`
 * is generated from this table (M1A-WI-7).
 *
 * @coordinates-with src/commands/rows/*.ts — the rows, one file per group
 * @coordinates-with src/commands/commandHelpers.ts — exhaustive helpers
 * @coordinates-with src/types/preferences.ts — `DEFAULT_KEYBOARD_SHORTCUTS`
 *   is v2; tests/command-table.test.ts holds the two together
 */
import type { KeyboardShortcuts } from "../types/preferences";
import type { CommandId, CommandRow } from "./commandTable.types";
import { APP_ROWS } from "./rows/appRows";
import { EDIT_ROWS } from "./rows/editRows";
import { FILE_ROWS } from "./rows/fileRows";
import { FORMAT_ROWS } from "./rows/formatRows";
import { PARAGRAPH_ROWS } from "./rows/paragraphRows";
import { TABLE_ROWS } from "./rows/tableRows";
import { VIEW_ROWS } from "./rows/viewRows";

export { availabilityContexts, routeLogOwner, type LogOwner } from "./commandHelpers";

export const COMMAND_TABLE: readonly CommandRow[] = [
  ...FILE_ROWS,
  ...EDIT_ROWS,
  ...PARAGRAPH_ROWS,
  ...FORMAT_ROWS,
  ...VIEW_ROWS,
  ...TABLE_ROWS,
  ...APP_ROWS,
];

const BY_ID = new Map<CommandId, CommandRow>(COMMAND_TABLE.map((r) => [r.id, r]));
const BY_FIELD = new Map<keyof KeyboardShortcuts, CommandRow>(
  COMMAND_TABLE.flatMap((r) => (r.prefField === undefined ? [] : [[r.prefField, r] as const])),
);

export function rowById(id: CommandId): CommandRow | undefined {
  return BY_ID.get(id);
}

/** `editor.<table id>` is a wire alias, never a second semantic command ID. */
export function rowByEditorWireAction(action: string): CommandRow | undefined {
  if (!action.startsWith("editor.")) return undefined;
  const id = action.slice("editor.".length);
  const group = id.split(".", 1)[0];
  if (group !== "paragraph" && group !== "format" && group !== "edit" && group !== "table") {
    return undefined;
  }
  const row = BY_ID.get(id);
  return row?.id === id ? row : undefined;
}

export function rowByPrefField(field: keyof KeyboardShortcuts): CommandRow | undefined {
  return BY_FIELD.get(field);
}
