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
      if (!event.metaKey) return;
      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      const inCodeMirror = target?.closest?.(".cm-editor");
      if (inCodeMirror && editorView) {
        if (key === "k") {
          event.preventDefault();
          loggingService.logShortcut("Cmd+K", { action: "format.hyperlink" });
          insertLinkCommand(editorView);
          return;
        }
        if (key === "0") {
          event.preventDefault();
          loggingService.logShortcut("Cmd+0", { action: "paragraph.paragraph" });
          paragraphCommand(editorView);
          return;
        }
        if (key >= "1" && key <= "6") {
          event.preventDefault();
          loggingService.logShortcut(`Cmd+${key}`, { action: `paragraph.heading${key}` });
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

      // Cmd+N - New document
      if (key === "n" && !event.shiftKey && onNew) {
        event.preventDefault();
        const actionId = loggingService.logShortcut("Cmd+N", { action: "file.new" });
        onNew(actionId);
      }
      // Cmd+Shift+H - Highlight (not in CodeMirror)
      if (key === "h" && event.shiftKey && onHighlight && !inCodeMirror) {
        event.preventDefault();
        const actionId = loggingService.logShortcut("Cmd+Shift+H", { action: "format.highlight" });
        onHighlight(actionId);
      }
      // Cmd+Shift+L - Toggle Sidebar (Typora convention)
      if (key === "l" && event.shiftKey && onToggleSidebar) {
        event.preventDefault();
        const actionId = loggingService.logShortcut("Cmd+Shift+L", { action: "view.toggle_sidebar" });
        onToggleSidebar(actionId);
      }
      // Cmd+O - Open file
      if (key === "o" && !event.shiftKey && onOpen) {
        event.preventDefault();
        const actionId = loggingService.logShortcut("Cmd+O", { action: "file.open" });
        onOpen(actionId);
      }
      // Cmd+S - Save
      if (key === "s" && !event.shiftKey && onSave) {
        event.preventDefault();
        const actionId = loggingService.logShortcut("Cmd+S", { action: "file.save" });
        onSave(actionId);
      }
      // Cmd+W - Close document
      if (key === "w" && onClose) {
        event.preventDefault();
        const actionId = loggingService.logShortcut("Cmd+W", { action: "file.close" });
        onClose(actionId);
      }
      // Cmd+/ - Cycle view mode (Typora: Source Code Mode toggle)
      // Only intercept when CodeMirror does NOT have focus; if it does, let
      // CodeMirror's built-in toggleLineComment command handle the key.
      if (key === "/" && onCycleViewMode && !target?.closest?.(".cm-editor")) {
        event.preventDefault();
        const actionId = loggingService.logShortcut("Cmd+/", { action: "view.cycle" });
        onCycleViewMode(actionId);
      }
      // Cmd+, - Open Preferences
      if (key === "," && onOpenPreferences) {
        event.preventDefault();
        const actionId = loggingService.logShortcut("Cmd+,", { action: "file.preferences" });
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
