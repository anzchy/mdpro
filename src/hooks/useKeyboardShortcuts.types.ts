/**
 * @module hooks/useKeyboardShortcuts.types
 * Purpose: the handler props and table action ids of `useKeyboardShortcuts`,
 * split out to keep the hook under its size budget (D190-WI-7).
 *
 * @coordinates-with src/hooks/useKeyboardShortcuts.ts
 */
import type { KeyboardShortcuts } from "../types/preferences";

export interface ShortcutHandlers {
  onOpen?: (actionId?: string) => void;
  onSave?: (actionId?: string) => void;
  onSaveAs?: (actionId?: string) => void;
  onClose?: (actionId?: string) => void;
  onNew?: (actionId?: string) => void;
  /**
   * Fires for `fileNewWindow` (default ⌘⇧N / Ctrl+Shift+N) **off-Mac only**.
   * On Windows the native menu accelerator never fires (WebView2 keeps the key
   * from Tauri's accelerator hook, D190 WI-1b), so the hook covers it there. On
   * macOS the native accelerator owns the key and the hook stays out of it, so
   * nothing fires twice. Wired in App.tsx to the same call as the menu path.
   */
  onNewWindow?: (actionId?: string) => void;
  onHighlight?: (actionId?: string) => void;
  onExportHtml?: (actionId?: string) => void;
  onToggleSidebar?: (actionId?: string) => void;
  onToggleFullscreen?: (actionId?: string) => void;
  onCycleViewMode?: (actionId?: string) => void;
  onOpenPreferences?: (actionId?: string) => void;
  /**
   * Fires for `paragraphTable` (default ⌘⌥T). Opens the Insert Table
   * modal via `tableInsertStore.requestInsert`. Wired in App.tsx.
   */
  onInsertTable?: (actionId?: string) => void;
  /**
   * Fires for the 6 in-table shortcuts (insert row above/below,
   * insert column left/right, delete row, delete column). The
   * dispatcher in App.tsx routes to the WYSIWYG or source-mode
   * dispatcher based on the active viewMode and falls through to a
   * no-op when the cursor isn't inside a table.
   */
  onTableAction?: (id: TableShortcutAction, actionId?: string) => void;
  /** Live keyboard shortcut map. Defaults to DEFAULT_KEYBOARD_SHORTCUTS. */
  shortcuts?: KeyboardShortcuts;
}

export type TableShortcutAction =
  | "insert_row_before"
  | "insert_row_after"
  | "insert_column_before"
  | "insert_column_after"
  | "delete_row"
  | "delete_column";
