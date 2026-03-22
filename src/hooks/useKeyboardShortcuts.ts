import { useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import { useEditorStore } from "../stores/editorStore";
import { loggingService } from "../services/loggingService";
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

interface ShortcutHandlers {
  onOpen?: (actionId?: string) => void;
  onSave?: (actionId?: string) => void;
  onClose?: (actionId?: string) => void;
  onNew?: (actionId?: string) => void;
  onHighlight?: (actionId?: string) => void;
  onToggleSidebar?: (actionId?: string) => void;
  onCycleViewMode?: (actionId?: string) => void;
  onOpenPreferences?: (actionId?: string) => void;
}

// Detect macOS once at module load. On macOS the primary shortcut modifier is
// Cmd (metaKey); on Windows/Linux it is Ctrl (ctrlKey). Using an exclusive
// check prevents Ctrl+S from firing on macOS (where it is not a system shortcut)
// and prevents Cmd+S from being required on Windows.
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const modLabel = isMac ? "Cmd" : "Ctrl";

export function useKeyboardShortcuts({
  onOpen,
  onSave,
  onClose,
  onNew,
  onHighlight,
  onToggleSidebar,
  onCycleViewMode,
  onOpenPreferences,
}: ShortcutHandlers) {
  const editorView = useEditorStore((state) => state.editorView);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Require the platform-primary modifier exclusively. On macOS that is Cmd
      // (metaKey); on Windows/Linux it is Ctrl (ctrlKey). We also exclude the
      // non-primary modifier so Cmd+Ctrl+S on macOS is ignored, and Alt is
      // excluded globally to preserve international input (Ctrl+Alt+* AltGr).
      const primaryMod = isMac ? event.metaKey : event.ctrlKey;
      const secondaryMod = isMac ? event.ctrlKey : event.metaKey;
      if (!primaryMod || secondaryMod || event.altKey) return;

      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      const inCodeMirror = target?.closest?.(".cm-editor");
      if (inCodeMirror && editorView) {
        if (key === "k" && !event.shiftKey) {
          event.preventDefault();
          loggingService.logShortcut(`${modLabel}+K`, { action: "format.hyperlink" });
          insertLinkCommand(editorView);
          return;
        }
        if (key === "0") {
          event.preventDefault();
          loggingService.logShortcut(`${modLabel}+0`, { action: "paragraph.paragraph" });
          paragraphCommand(editorView);
          return;
        }
        if (key >= "1" && key <= "6") {
          event.preventDefault();
          loggingService.logShortcut(`${modLabel}+${key}`, { action: `paragraph.heading${key}` });
          const commandMap: Record<string, (view: EditorView) => boolean> = {
            "1": heading1Command,
            "2": heading2Command,
            "3": heading3Command,
            "4": heading4Command,
            "5": heading5Command,
            "6": heading6Command,
          };
          const command = commandMap[key];
          if (command) command(editorView);
          return;
        }
      }

      // Cmd/Ctrl+N - New document
      if (key === "n" && !event.shiftKey && onNew) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(`${modLabel}+N`, { action: "file.new" });
        onNew(actionId);
      }
      // Cmd/Ctrl+Shift+H - Highlight (not in CodeMirror)
      if (key === "h" && event.shiftKey && onHighlight && !inCodeMirror) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(`${modLabel}+Shift+H`, { action: "format.highlight" });
        onHighlight(actionId);
      }
      // Cmd/Ctrl+Shift+L - Toggle Sidebar (Typora convention)
      if (key === "l" && event.shiftKey && onToggleSidebar) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(`${modLabel}+Shift+L`, { action: "view.toggle_sidebar" });
        onToggleSidebar(actionId);
      }
      // Cmd/Ctrl+O - Open file
      if (key === "o" && !event.shiftKey && onOpen) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(`${modLabel}+O`, { action: "file.open" });
        onOpen(actionId);
      }
      // Cmd/Ctrl+S - Save
      if (key === "s" && !event.shiftKey && onSave) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(`${modLabel}+S`, { action: "file.save" });
        onSave(actionId);
      }
      // Cmd/Ctrl+W - Close document
      if (key === "w" && !event.shiftKey && onClose) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(`${modLabel}+W`, { action: "file.close" });
        onClose(actionId);
      }
      // Cmd/Ctrl+/ - Cycle view mode (Typora: Source Code Mode toggle)
      // Only intercept when CodeMirror does NOT have focus; if it does, let
      // CodeMirror's built-in toggleLineComment command handle the key.
      if (key === "/" && onCycleViewMode && !target?.closest?.(".cm-editor")) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(`${modLabel}+/`, { action: "view.cycle" });
        onCycleViewMode(actionId);
      }
      // Cmd/Ctrl+, - Open Preferences
      if (key === "," && !event.shiftKey && onOpenPreferences) {
        event.preventDefault();
        const actionId = loggingService.logShortcut(`${modLabel}+,`, { action: "file.preferences" });
        onOpenPreferences(actionId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    editorView,
    onClose,
    onCycleViewMode,
    onHighlight,
    onNew,
    onOpen,
    onOpenPreferences,
    onSave,
    onToggleSidebar,
  ]);
}
