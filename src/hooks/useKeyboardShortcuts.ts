import { useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import { useEditorStore } from "../stores/editorStore";
import {
  heading1Command,
  heading2Command,
  heading3Command,
  heading4Command,
  heading5Command,
  heading6Command,
  paragraphCommand,
} from "../components/Editor/extensions/heading";
import { insertLinkCommand } from "../components/Editor/extensions/link";

interface ShortcutHandlers {
  onOpen?: () => void;
  onSave?: () => void;
  onClose?: () => void;
  onNew?: () => void;
  onHighlight?: () => void;
  onToggleSidebar?: () => void;
  onCycleViewMode?: () => void;
  onOpenPreferences?: () => void;
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
          insertLinkCommand(editorView);
          return;
        }
        if (key === "0") {
          event.preventDefault();
          paragraphCommand(editorView);
          return;
        }
        if (key >= "1" && key <= "6") {
          event.preventDefault();
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
        onNew();
      }
      // Cmd+Shift+H - Highlight (not in CodeMirror)
      if (key === "h" && event.shiftKey && onHighlight && !inCodeMirror) {
        event.preventDefault();
        onHighlight();
      }
      // Cmd+Shift+L - Toggle Sidebar (Typora convention)
      if (key === "l" && event.shiftKey && onToggleSidebar) {
        event.preventDefault();
        onToggleSidebar();
      }
      // Cmd+O - Open file
      if (key === "o" && !event.shiftKey && onOpen) {
        event.preventDefault();
        onOpen();
      }
      // Cmd+S - Save
      if (key === "s" && !event.shiftKey && onSave) {
        event.preventDefault();
        onSave();
      }
      // Cmd+W - Close document
      if (key === "w" && onClose) {
        event.preventDefault();
        onClose();
      }
      // Cmd+/ - Cycle view mode (Typora: Source Code Mode toggle)
      if (key === "/" && onCycleViewMode) {
        event.preventDefault();
        onCycleViewMode();
      }
      // Cmd+, - Open Preferences
      if (key === "," && onOpenPreferences) {
        event.preventDefault();
        onOpenPreferences();
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
