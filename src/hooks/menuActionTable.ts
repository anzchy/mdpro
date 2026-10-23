/**
 * @module hooks/menuActionTable
 * Purpose: the native menu's dispatch table. `dispatchMenuAction` maps one
 * `menu:action` payload (`{ action, value, target }`, emitted by `menu.rs`) to
 * the one App handler it names, writing one `ui.menu.select` line through the
 * caller's `logMenuSelect` and passing that line's actionId, then the
 * receipt-time menu-target token, to the handler. Synchronous and stateless:
 * the subscription, the target filter, the token capture and the window label
 * stay in `useMenuEvents`, which calls this per event.
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
 *   - Every handler gets `(…value args, actionId, token)` (D261). The token is
 *     appended only when the caller passes one; `useMenuEvents` always does.
 *
 * Extracted from `useMenuEvents.ts` unchanged in behaviour (D261-WI-1a).
 * M3b routes exact `editor.<table id>` aliases through the sibling editor
 * table while the existing native Highlight/Table action strings remain here.
 *
 * @coordinates-with src/hooks/useMenuEvents.ts — subscribes and calls dispatchMenuAction
 * @coordinates-with src-tauri/src/menu.rs — emits the action strings this table matches
 * @coordinates-with src/utils/modalTabActionGuard.ts — the D165 / D235 modal refusals
 * @coordinates-with src/utils/menuTargetToken.ts — the token handlers receive
 */
import type { ViewMode } from "../types/editor";
import type { UserPreferences } from "../types/preferences";
import type { MenuTargetToken } from "../utils/menuTargetToken";
import {
  refuseModalOpenWhileModalOpen,
  refuseTabActionWhileModalOpen,
  type ModalOpeningAction,
  type TabChangingAction,
} from "../utils/modalTabActionGuard";
import { dispatchEditorMenuAction } from "./editorMenuActionTable";

/** The `menu:action` event payload `menu.rs` emits to one window (D261). */
export interface MenuActionPayload {
  action: string;
  value?: string | null;
  /** The label of the window Rust addressed; `useMenuEvents` drops any other. */
  target?: string | null;
}

/** A handler with no value argument: `(actionId, token)`. */
type Plain = (actionId?: string, token?: MenuTargetToken) => void;

/** The App handlers a menu action can reach; each is optional. */
export interface MenuHandlers {
  onNew?: Plain;
  onNewWindow?: Plain;
  onOpen?: Plain;
  onSave?: Plain;
  onSaveAs?: Plain;
  onClose?: Plain;
  onExportHtml?: Plain;
  onOpenRecent?: (path: string, actionId?: string, token?: MenuTargetToken) => void;
  onToggleSidebar?: Plain;
  onHighlight?: Plain;
  onInsertTable?: Plain;
  onViewModeChange?: (mode: ViewMode, actionId?: string, token?: MenuTargetToken) => void;
  onCycleViewMode?: Plain;
  onSwitchDocuments?: Plain;
  onToggleFullscreen?: Plain;
  onThemeModeChange?: (mode: UserPreferences["themeMode"], actionId?: string, token?: MenuTargetToken) => void;
  onOpenPreferences?: (actionId: string, page?: "keyboard-shortcuts", token?: MenuTargetToken) => void;
}

/** Writes one `ui.menu.select` line and returns its actionId. */
export type LogMenuSelect = (controlId: string, context?: Record<string, unknown>) => string;

/**
 * Dispatch one menu action to its handler, passing `token` after the actionId.
 * Unknown actions, and known ones with a malformed value, reach nothing and log
 * nothing.
 */
export function dispatchMenuAction(
  { action, value }: MenuActionPayload,
  handlers: MenuHandlers,
  logMenuSelect: LogMenuSelect,
  token?: MenuTargetToken,
): void {
  /** The trailing token argument, absent when the caller has none. */
  const t: [MenuTargetToken] | [] = token ? [token] : [];

  /**
   * A tab-changing action: nothing (not even the select line) without a handler,
   * as the optional call did before; refused while a modal is open (D165).
   */
  const runTabAction = (
    tabAction: TabChangingAction,
    controlId: string,
    run: ((actionId: string, ...rest: [MenuTargetToken] | []) => void) | undefined,
    context: Record<string, unknown> = {},
  ) => {
    if (!run) return;
    const actionId = logMenuSelect(controlId, context);
    if (!refuseTabActionWhileModalOpen(tabAction, "menu", actionId)) run(actionId, ...t);
  };

  /** An action that opens its own modal: refused while one is already open (D235). */
  const runModalAction = (
    modalAction: ModalOpeningAction,
    controlId: string,
    run: ((actionId: string, ...rest: [MenuTargetToken] | []) => void) | undefined,
  ) => {
    if (!run) return;
    const actionId = logMenuSelect(controlId);
    if (!refuseModalOpenWhileModalOpen(modalAction, "menu", actionId)) run(actionId, ...t);
  };

  switch (action) {
    case "file.new":
      runTabAction("file.new", "menu.file.new", handlers.onNew);
      break;
    case "file.new_window":
      handlers.onNewWindow?.(logMenuSelect("menu.file.new_window"), ...t);
      break;
    case "file.open":
      runTabAction("file.open", "menu.file.open", handlers.onOpen);
      break;
    case "file.save":
      handlers.onSave?.(logMenuSelect("menu.file.save"), ...t);
      break;
    case "file.save_as":
      handlers.onSaveAs?.(logMenuSelect("menu.file.save_as"), ...t);
      break;
    case "file.close":
      runTabAction("file.close", "menu.file.close", handlers.onClose);
      break;
    case "file.export_html":
      handlers.onExportHtml?.(logMenuSelect("menu.file.export_html"), ...t);
      break;
    case "file.preferences":
      runModalAction(
        "file.preferences",
        value === "keyboard-shortcuts" ? "menu.help.keyboard_shortcuts" : "menu.file.preferences",
        handlers.onOpenPreferences
          ? (actionId, ...rest) => {
              if (value === "keyboard-shortcuts") {
                handlers.onOpenPreferences?.(actionId, "keyboard-shortcuts", ...rest);
              } else if (rest.length > 0) {
                // Ordinary Settings retains D261's (actionId, token) shape.
                (handlers.onOpenPreferences as Plain)?.(actionId, ...rest);
              } else {
                handlers.onOpenPreferences?.(actionId);
              }
            }
          : undefined,
      );
      break;
    case "file.open_recent":
      if (value) {
        // Logged even without a handler, as before D165.
        runTabAction(
          "file.open_recent",
          "menu.file.open_recent",
          (actionId, ...rest) => handlers.onOpenRecent?.(value, actionId, ...rest),
          { filePath: value },
        );
      }
      break;
    case "cycle-view-mode":
      handlers.onCycleViewMode?.(logMenuSelect("menu.view.cycle"), ...t);
      break;
    case "set-view-mode": {
      if (!value) break;
      const mode = value as ViewMode;
      if (mode === "wysiwyg" || mode === "source") {
        handlers.onViewModeChange?.(mode, logMenuSelect("menu.view.set_mode", { mode }), ...t);
      }
      break;
    }
    case "view.toggle_sidebar":
      handlers.onToggleSidebar?.(logMenuSelect("menu.view.toggle_sidebar"), ...t);
      break;
    case "view.switch_documents":
      handlers.onSwitchDocuments?.(logMenuSelect("menu.view.switch_documents"), ...t);
      break;
    case "view.toggle_fullscreen":
      handlers.onToggleFullscreen?.(logMenuSelect("menu.view.toggle_fullscreen"), ...t);
      break;
    case "format.highlight":
      handlers.onHighlight?.(logMenuSelect("menu.format.highlight"), ...t);
      break;
    case "paragraph.table":
      // Wired to the same insert-table flow as the ⌘⌥T shortcut; both
      // open TableInsertModal via tableInsertStore.requestInsert.
      runModalAction("paragraph.table", "menu.format.insert_table", handlers.onInsertTable);
      break;
    case "theme.light":
      handlers.onThemeModeChange?.("light", logMenuSelect("menu.theme.light"), ...t);
      break;
    case "theme.dark":
      handlers.onThemeModeChange?.("dark", logMenuSelect("menu.theme.dark"), ...t);
      break;
    case "theme.system":
      handlers.onThemeModeChange?.("system", logMenuSelect("menu.theme.system"), ...t);
      break;
    default:
      // Synthetic editor aliases share this listener and its D261 token.
      // Unknown aliases retain the no-handler, no-select-line behavior.
      if (action.startsWith("editor.")) dispatchEditorMenuAction(action, token);
      break;
  }
}
