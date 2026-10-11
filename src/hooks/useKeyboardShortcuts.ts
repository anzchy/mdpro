import { useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import { useEditorStore } from "../stores/editorStore";
import { loggingService } from "../services/loggingService";
import type { KeyboardShortcuts } from "../types/preferences";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../types/preferences";
import {
  heading1Command,
  heading2Command,
  heading3Command,
  heading4Command,
  heading5Command,
  heading6Command,
  paragraphCommand,
} from "../plugins/codemirror/headingPlugin";
import { insertLinkCommand } from "../plugins/codemirror/linkPlugin";
import { refuseTabActionWhileModalOpen } from "../utils/modalTabActionGuard";

interface ShortcutHandlers {
  onOpen?: (actionId?: string) => void;
  onSave?: (actionId?: string) => void;
  onClose?: (actionId?: string) => void;
  onNew?: (actionId?: string) => void;
  onHighlight?: (actionId?: string) => void;
  onExportHtml?: (actionId?: string) => void;
  onToggleSidebar?: (actionId?: string) => void;
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

// Detect macOS once at module load. On macOS the primary shortcut modifier is
// Cmd (metaKey); on Windows/Linux it is Ctrl (ctrlKey).
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

/** Test a live KeyboardEvent against a stored shortcut string (e.g. "Cmd+Shift+K").
 *
 *  Modifier tokens:
 *   "Cmd"    → primary modifier: metaKey on macOS, ctrlKey on other platforms
 *   "Ctrl"   → literal ctrlKey
 *   "Option" → altKey
 *   "Shift"  → shiftKey
 *
 *  Key tokens: uppercase letters/digits map case-insensitively; arrow
 *  abbreviations (Up/Down/Left/Right) map to ArrowX; "Space" maps to " ".
 */
function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+");
  let wantCmd = false,
    wantCtrl = false,
    wantOption = false,
    wantShift = false;
  let keyPart = "";

  for (const p of parts) {
    if (p === "Cmd") wantCmd = true;
    else if (p === "Ctrl") wantCtrl = true;
    else if (p === "Option") wantOption = true;
    else if (p === "Shift") wantShift = true;
    else keyPart = p; // last non-modifier segment is the key
  }

  const primaryMod = isMac ? event.metaKey : event.ctrlKey;
  if (wantCmd !== primaryMod) return false;
  if (wantCtrl !== event.ctrlKey) return false;
  if (wantOption !== event.altKey) return false;
  if (wantShift !== event.shiftKey) return false;

  // Normalize the stored key name to what event.key produces
  let normalizedKey: string;
  if (keyPart === "Space") normalizedKey = " ";
  else if (keyPart === "Up") normalizedKey = "ArrowUp";
  else if (keyPart === "Down") normalizedKey = "ArrowDown";
  else if (keyPart === "Left") normalizedKey = "ArrowLeft";
  else if (keyPart === "Right") normalizedKey = "ArrowRight";
  else normalizedKey = keyPart;

  // Single-character keys: compare case-insensitively
  if (normalizedKey.length === 1) {
    return event.key.toUpperCase() === normalizedKey.toUpperCase();
  }
  return event.key === normalizedKey;
}

export function useKeyboardShortcuts({
  onOpen,
  onSave,
  onClose,
  onNew,
  onHighlight,
  onExportHtml,
  onToggleSidebar,
  onCycleViewMode,
  onOpenPreferences,
  onInsertTable,
  onTableAction,
  shortcuts = DEFAULT_KEYBOARD_SHORTCUTS,
}: ShortcutHandlers) {
  const editorView = useEditorStore((state) => state.editorView);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inCodeMirror = !!target?.closest?.(".cm-editor");

      // Editor-specific shortcuts (only fire when CodeMirror has focus)
      if (inCodeMirror && editorView) {
        if (matchesShortcut(event, shortcuts.formatHyperlink)) {
          event.preventDefault();
          loggingService.logShortcut(shortcuts.formatHyperlink, { action: "format.hyperlink" });
          insertLinkCommand(editorView);
          return;
        }
        if (matchesShortcut(event, shortcuts.paragraphParagraph)) {
          event.preventDefault();
          loggingService.logShortcut(shortcuts.paragraphParagraph, { action: "paragraph.paragraph" });
          paragraphCommand(editorView);
          return;
        }
        const headingShortcuts: Array<[string, (view: EditorView) => boolean, string]> = [
          [shortcuts.paragraphHeading1, heading1Command, "paragraph.heading1"],
          [shortcuts.paragraphHeading2, heading2Command, "paragraph.heading2"],
          [shortcuts.paragraphHeading3, heading3Command, "paragraph.heading3"],
          [shortcuts.paragraphHeading4, heading4Command, "paragraph.heading4"],
          [shortcuts.paragraphHeading5, heading5Command, "paragraph.heading5"],
          [shortcuts.paragraphHeading6, heading6Command, "paragraph.heading6"],
        ];
        for (const [sc, cmd, action] of headingShortcuts) {
          if (matchesShortcut(event, sc)) {
            event.preventDefault();
            loggingService.logShortcut(sc, { action });
            cmd(editorView);
            return;
          }
        }
      }

      // App-level shortcuts — evaluated with exact modifier matching via matchesShortcut.
      // "Highlight" has no entry in KeyboardShortcuts yet; keep hardcoded default.
      if (onNew && matchesShortcut(event, shortcuts.fileNew)) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.fileNew, { action: "file.new" });
        if (!refuseTabActionWhileModalOpen("file.new", "shortcut", actionId)) onNew(actionId);
      } else if (onHighlight && !inCodeMirror && matchesShortcut(event, shortcuts.formatHighlight)) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.formatHighlight, { action: "format.highlight" });
        onHighlight(actionId);
      } else if (onExportHtml && matchesShortcut(event, shortcuts.fileExportHtml)) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.fileExportHtml, { action: "file.export_html" });
        onExportHtml(actionId);
      } else if (onToggleSidebar && matchesShortcut(event, shortcuts.viewToggleSidebar)) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.viewToggleSidebar, { action: "view.toggle_sidebar" });
        onToggleSidebar(actionId);
      } else if (onOpen && matchesShortcut(event, shortcuts.fileOpen)) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.fileOpen, { action: "file.open" });
        if (!refuseTabActionWhileModalOpen("file.open", "shortcut", actionId)) onOpen(actionId);
      } else if (onSave && matchesShortcut(event, shortcuts.fileSave)) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.fileSave, { action: "file.save" });
        onSave(actionId);
      } else if (onClose && matchesShortcut(event, shortcuts.fileClose)) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.fileClose, { action: "file.close" });
        // D165: a modal is up (the native accelerator path has the same check).
        if (!refuseTabActionWhileModalOpen("file.close", "shortcut", actionId)) onClose(actionId);
      } else if (onCycleViewMode && !inCodeMirror && matchesShortcut(event, shortcuts.viewCycleViewMode)) {
        // CodeMirror has its own high-precedence Mod-/ binding (see Editor.tsx
        // viewModeKeymap) that calls userViewModeCommands.cycle directly. App
        // passes the same adapter here, so both paths carry the user intent
        // (ADR-0031 step 6). The !inCodeMirror
        // guard prevents this window-level handler from firing a second time
        // when the editor consumes the event. WYSIWYG / non-editor contexts
        // bubble up here and cycle through this branch.
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.viewCycleViewMode, { action: "view.cycle" });
        onCycleViewMode(actionId);
      } else if (onOpenPreferences && matchesShortcut(event, shortcuts.filePreferences)) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.filePreferences, { action: "file.preferences" });
        onOpenPreferences(actionId);
      } else if (onInsertTable && !inCodeMirror && matchesShortcut(event, shortcuts.paragraphTable)) {
        // ⌘⌥T (paragraphTable) — opens TableInsertModal in WYSIWYG mode.
        // CodeMirror gets first dibs (source-mode inserts a literal table is
        // separate Phase 2 work in the table-CRUD plan).
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.paragraphTable, { action: "paragraph.table" });
        onInsertTable(actionId);
      } else if (onTableAction) {
        // Phase 1.5 follow-up — table action shortcuts (Cmd+Option+arrows
        // for insert row/col directions; Cmd+Option+Backspace for delete
        // row; Cmd+Option+Shift+Backspace for delete column). The
        // dispatcher in App.tsx falls through cleanly when the cursor
        // isn't inside a table, so the shortcut is harmless outside.
        const tableShortcuts: Array<[string, TableShortcutAction]> = [
          [shortcuts.tableInsertRowAbove, "insert_row_before"],
          [shortcuts.tableInsertRowBelow, "insert_row_after"],
          [shortcuts.tableInsertColumnLeft, "insert_column_before"],
          [shortcuts.tableInsertColumnRight, "insert_column_after"],
          [shortcuts.tableDeleteRow, "delete_row"],
          [shortcuts.tableDeleteColumn, "delete_column"],
        ];
        for (const [sc, id] of tableShortcuts) {
          if (matchesShortcut(event, sc)) {
            event.preventDefault();
            const actionId = loggingService.logShortcut(sc, { action: `editor.table.${id}` });
            onTableAction(id, actionId);
            break;
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    editorView,
    onClose,
    onCycleViewMode,
    onExportHtml,
    onHighlight,
    onInsertTable,
    onTableAction,
    onNew,
    onOpen,
    onOpenPreferences,
    onSave,
    onToggleSidebar,
    shortcuts,
  ]);
}
