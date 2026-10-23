import { useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import { useEditorStore } from "../stores/editorStore";
import { loggingService } from "../services/loggingService";
import type { ShortcutHandlers, TableShortcutAction } from "./useKeyboardShortcuts.types";
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
import { refuseModalOpenWhileModalOpen, refuseTabActionWhileModalOpen } from "../utils/modalTabActionGuard";
import { matchesShortcut as matchKeyEvent } from "../utils/shortcutMatch";

export type { TableShortcutAction } from "./useKeyboardShortcuts.types";

// Detect macOS once at module load. On macOS the primary shortcut modifier is
// Cmd (metaKey) and Ctrl is a separate secondary modifier; on Windows/Linux the
// primary modifier is Ctrl (ctrlKey) and the Windows/Super key (metaKey) is
// never a shortcut modifier.
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

// Dispatch passes: 1 logical only; 2 the K8 physical-key match, only when no
// binding matched logically, so a logical match on any binding beats a
// physical one on any other (audit b186 F1); 3 off-Mac, the Shift-typed
// symbol fallback (audit b121). Every pass skips a keydown an editor
// already consumed (defaultPrevented). The sets mark the pass an event is in and
// whether some binding has matched it.
const physicalPass = new WeakSet<KeyboardEvent>();
const relaxedPass = new WeakSet<KeyboardEvent>();
const matched = new WeakSet<KeyboardEvent>();

/** Match one keydown against one binding (src/utils/shortcutMatch.ts), feeding
 *  this hook's pass state in and recording a hit for the next pass. */
function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const opts = { isMac, relaxed: relaxedPass.has(event), physical: physicalPass.has(event) };
  const hit = matchKeyEvent(event, shortcut, opts);
  if (hit) matched.add(event);
  return hit;
}

export function useKeyboardShortcuts({
  onOpen,
  onSave,
  onSaveAs,
  onClose,
  onNew,
  onNewWindow,
  onHighlight,
  onExportHtml,
  onToggleSidebar,
  onToggleFullscreen,
  onSwitchDocuments,
  onCycleViewMode,
  onOpenPreferences,
  onInsertTable,
  onTableAction,
  shortcuts = DEFAULT_KEYBOARD_SHORTCUTS,
  shortcutsVersion = 2,
}: ShortcutHandlers) {
  const editorView = useEditorStore((state) => state.editorView);

  useEffect(() => {
    if (shortcuts === null) return;
    const dispatch = (event: KeyboardEvent) => {
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
      // Highlight reads the applied `formatHighlight` chord like the rest.
      if (onNew && matchesShortcut(event, shortcuts.fileNew)) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.fileNew, { action: "file.new" });
        if (!refuseTabActionWhileModalOpen("file.new", "shortcut", actionId)) onNew(actionId);
      } else if (onNewWindow && !isMac && matchesShortcut(event, shortcuts.fileNewWindow)) {
        // Off-Mac only: the native accelerator never reaches Tauri on Windows
        // (D190 WI-1b). No modal refusal: a new window leaves this window's tabs
        // alone, as on the menu path.
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.fileNewWindow, { action: "file.new_window" });
        onNewWindow(actionId);
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
      } else if (onSwitchDocuments && shortcutsVersion >= 2 && matchesShortcut(event, shortcuts.viewSwitchDocuments)) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.viewSwitchDocuments, { action: "view.switch_documents" });
        onSwitchDocuments(actionId);
      } else if (onToggleFullscreen && shortcutsVersion >= 2 && !isMac && shortcuts.viewToggleFullscreen === "F11" && matchesShortcut(event, "F11")) {
        event.preventDefault();
        const actionId = loggingService.logShortcut("F11", { action: "view.toggle_fullscreen" });
        onToggleFullscreen(actionId);
      } else if (onOpen && matchesShortcut(event, shortcuts.fileOpen)) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.fileOpen, { action: "file.open" });
        if (!refuseTabActionWhileModalOpen("file.open", "shortcut", actionId)) onOpen(actionId);
      } else if (onSave && matchesShortcut(event, shortcuts.fileSave)) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.fileSave, { action: "file.save" });
        onSave(actionId);
      } else if (onSaveAs && !isMac && matchesShortcut(event, shortcuts.fileSaveAs)) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.fileSaveAs, { action: "file.save_as" });
        onSaveAs(actionId);
      } else if (onClose && matchesShortcut(event, shortcuts.fileClose)) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.fileClose, { action: "file.close" });
        // D165: a modal is up (the native accelerator path has the same check).
        if (!refuseTabActionWhileModalOpen("file.close", "shortcut", actionId)) onClose(actionId);
      } else if (onCycleViewMode && !inCodeMirror &&
        (matchesShortcut(event, shortcuts.viewCycleViewMode) || matchesShortcut(event, "F6"))) {
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
        if (!refuseModalOpenWhileModalOpen("file.preferences", "shortcut", actionId)) onOpenPreferences(actionId);
      } else if (onInsertTable && !inCodeMirror && matchesShortcut(event, shortcuts.paragraphTable)) {
        // The applied paragraphTable key opens TableInsertModal in WYSIWYG mode.
        // CodeMirror gets first dibs (source-mode inserts a literal table is
        // separate Phase 2 work in the table-CRUD plan).
        event.preventDefault();
        const actionId = loggingService.logShortcut(shortcuts.paragraphTable, { action: "paragraph.table" });
        // D235: not over an open modal (Insert Link, Settings, …).
        if (!refuseModalOpenWhileModalOpen("paragraph.table", "shortcut", actionId)) onInsertTable(actionId);
      } else if (onTableAction && !inCodeMirror) {
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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      dispatch(event);
      // A keydown an editor keymap consumed never reaches a fallback pass
      // (audit b186 round 2: Milkdown's Mod-Shift-` on German Shift+Equal).
      // The logical pass is also skipped once an editor takes ownership.
      if (matched.has(event) || event.defaultPrevented) return;
      physicalPass.add(event);
      dispatch(event);
      if (isMac || matched.has(event)) return;
      relaxedPass.add(event);
      dispatch(event);
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
    onNewWindow,
    onOpen,
    onOpenPreferences,
    onSave,
    onSaveAs,
    onToggleSidebar,
    onToggleFullscreen,
    onSwitchDocuments,
    shortcuts,
    shortcutsVersion,
  ]);
}
