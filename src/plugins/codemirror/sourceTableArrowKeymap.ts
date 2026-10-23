/** Source table commands own applied arrow chords only while a writable table is active. */
import type { KeyBinding } from "@codemirror/view";
import { appliedKey } from "../../commands/appliedKeymap";
import type { Platform } from "../../commands/commandTable.types";
import type { AppliedShortcuts } from "../../types/keyboardShortcuts";
import type { KeyboardShortcuts } from "../../types/preferences";
import { loggingService } from "../../services/loggingService";
import { computeSourceTableContext, dispatchSourceTableAction } from "./sourceTableContextMenu";
import type { TableActionId } from "../milkdown/table/types";

const ACTIONS: readonly [keyof KeyboardShortcuts, TableActionId][] = [
  ["tableInsertRowAbove", "insert_row_before"],
  ["tableInsertRowBelow", "insert_row_after"],
  ["tableInsertColumnLeft", "insert_column_before"],
  ["tableInsertColumnRight", "insert_column_after"],
  ["tableDeleteRow", "delete_row"],
  ["tableDeleteColumn", "delete_column"],
];

export function sourceTableArrowKeymap(applied: AppliedShortcuts | null, platform: Platform): KeyBinding[] {
  return ACTIONS.flatMap(([field, action]) => {
    const chord = appliedKey(applied, field, platform);
    if (!chord) return [];
    return [{ key: chord, run: (view) => {
      const pos = view.state.selection.main.head;
      if (!computeSourceTableContext(view.state, pos)) return false;
      const actionId = loggingService.logShortcut(applied!.bindings[field].state === "bound" ? applied!.bindings[field].chord : "", { action: `editor.table.${action}` });
      const ok = dispatchSourceTableAction(view, action, pos);
      loggingService.logEventSync({ level: ok ? "info" : "warn", event: `editor.table.${action}`, status: ok ? "success" : "fail", actionId });
      return ok;
    } }];
  });
}
