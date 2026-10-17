/**
 * @module hooks/menuActionTable
 * Purpose: the native menu's dispatch table. `dispatchMenuAction` maps one
 * `menu:action` payload (`{ action, value }`, emitted by `menu.rs`) to the one
 * App handler it names, writing one `ui.menu.select` line through the
 * caller's `logMenuSelect` and passing that line's actionId to the handler.
 * Synchronous and stateless: the subscription, the focus check and the
 * window label stay in `useMenuEvents`, which calls this per event.
 *
 * Key decisions:
 *   - Every action string `menu.rs` emits has its own arm; `default` is the
 *     only place an unknown action is ignored, and it stays a no-op (no
 *     handler, no select line). `tests/menu-action-table.test.ts` reads the
 *     emitted set from `menu.rs` and checks each one reaches one handler.
 *   - No handler, no select line: an optional handler that is absent writes
 *     nothing. The exception is Open Recent, which logs even without a
 *     handler, as it did before D165.
 *   - Tab-changing actions (close, new, open, open recent), and Insert Table
 *     and Preferences, which open a modal of their own (D235), are refused
 *     while a modal is open (D165). On macOS the accelerator reaches this
 *     table whatever the DOM does, so the check is here, after the
 *     `ui.menu.select` line, which the refusal line shares its actionId with.
 *   - `set-view-mode` acts only on `wysiwyg` / `source`; `file.open_recent`
 *     only on a non-empty path. Anything else reaches nothing.
 *
 * Extracted from `useMenuEvents.ts` unchanged in behaviour (D261-WI-1a).
 *
 * @coordinates-with src/hooks/useMenuEvents.ts — subscribes and calls dispatchMenuAction
 * @coordinates-with src-tauri/src/menu.rs — emits the action strings this table matches
 * @coordinates-with src/utils/modalTabActionGuard.ts — the D165 / D235 modal refusals
 */
import type { ViewMode } from "../types/editor";
import type { UserPreferences } from "../types/preferences";
import {
  refuseModalOpenWhileModalOpen,
  refuseTabActionWhileModalOpen,
  type ModalOpeningAction,
  type TabChangingAction,
} from "../utils/modalTabActionGuard";

/** The `menu:action` event payload `menu.rs` emits. */
export interface MenuActionPayload {
  action: string;
  value?: string | null;
}

/** The App handlers a menu action can reach; each is optional. */
export interface MenuHandlers {
  onNew?: (actionId?: string) => void;
  onNewWindow?: (actionId?: string) => void;
  onOpen?: (actionId?: string) => void;
  onSave?: (actionId?: string) => void;
  onClose?: (actionId?: string) => void;
  onExportHtml?: (actionId?: string) => void;
  onOpenRecent?: (path: string, actionId?: string) => void;
  onToggleSidebar?: (actionId?: string) => void;
  onHighlight?: (actionId?: string) => void;
  onInsertTable?: (actionId?: string) => void;
  onViewModeChange?: (mode: ViewMode, actionId?: string) => void;
  onCycleViewMode?: (actionId?: string) => void;
  onThemeModeChange?: (mode: UserPreferences["themeMode"], actionId?: string) => void;
  onOpenPreferences?: (actionId?: string) => void;
}

/** Writes one `ui.menu.select` line and returns its actionId. */
export type LogMenuSelect = (controlId: string, context?: Record<string, unknown>) => string;

/**
 * Dispatch one menu action to its handler. Unknown actions, and known ones with
 * a malformed value, reach nothing and log nothing.
 */
export function dispatchMenuAction(
  { action, value }: MenuActionPayload,
  handlers: MenuHandlers,
  logMenuSelect: LogMenuSelect,
): void {
  /**
   * A tab-changing action: nothing (not even the select line) without a handler,
   * as the optional call did before; refused while a modal is open (D165).
   */
  const runTabAction = (
    tabAction: TabChangingAction,
    controlId: string,
    run: ((actionId: string) => void) | undefined,
    context: Record<string, unknown> = {},
  ) => {
    if (!run) return;
    const actionId = logMenuSelect(controlId, context);
    if (!refuseTabActionWhileModalOpen(tabAction, "menu", actionId)) run(actionId);
  };

  /** An action that opens its own modal: refused while one is already open (D235). */
  const runModalAction = (
    modalAction: ModalOpeningAction,
    controlId: string,
    run: ((actionId: string) => void) | undefined,
  ) => {
    if (!run) return;
    const actionId = logMenuSelect(controlId);
    if (!refuseModalOpenWhileModalOpen(modalAction, "menu", actionId)) run(actionId);
  };

  switch (action) {
    case "file.new":
      runTabAction("file.new", "menu.file.new", handlers.onNew);
      break;
    case "file.new_window":
      handlers.onNewWindow?.(logMenuSelect("menu.file.new_window"));
      break;
    case "file.open":
      runTabAction("file.open", "menu.file.open", handlers.onOpen);
      break;
    case "file.save":
      handlers.onSave?.(logMenuSelect("menu.file.save"));
      break;
    case "file.close":
      runTabAction("file.close", "menu.file.close", handlers.onClose);
      break;
    case "file.export_html":
      handlers.onExportHtml?.(logMenuSelect("menu.file.export_html"));
      break;
    case "file.preferences":
      runModalAction("file.preferences", "menu.file.preferences", handlers.onOpenPreferences);
      break;
    case "file.open_recent":
      if (value) {
        // Logged even without a handler, as before D165.
        runTabAction(
          "file.open_recent",
          "menu.file.open_recent",
          (actionId) => handlers.onOpenRecent?.(value, actionId),
          { filePath: value },
        );
      }
      break;
    case "cycle-view-mode":
      handlers.onCycleViewMode?.(logMenuSelect("menu.view.cycle"));
      break;
    case "set-view-mode": {
      if (!value) break;
      const mode = value as ViewMode;
      if (mode === "wysiwyg" || mode === "source") {
        handlers.onViewModeChange?.(mode, logMenuSelect("menu.view.set_mode", { mode }));
      }
      break;
    }
    case "view.toggle_sidebar":
      handlers.onToggleSidebar?.(logMenuSelect("menu.view.toggle_sidebar"));
      break;
    case "format.highlight":
      handlers.onHighlight?.(logMenuSelect("menu.format.highlight"));
      break;
    case "paragraph.table":
      // Wired to the same insert-table flow as the ⌘⌥T shortcut; both
      // open TableInsertModal via tableInsertStore.requestInsert.
      runModalAction("paragraph.table", "menu.format.insert_table", handlers.onInsertTable);
      break;
    case "theme.light":
      handlers.onThemeModeChange?.("light", logMenuSelect("menu.theme.light"));
      break;
    case "theme.dark":
      handlers.onThemeModeChange?.("dark", logMenuSelect("menu.theme.dark"));
      break;
    case "theme.system":
      handlers.onThemeModeChange?.("system", logMenuSelect("menu.theme.system"));
      break;
    default:
      // An action this build does not know: no handler, no select line.
      break;
  }
}
