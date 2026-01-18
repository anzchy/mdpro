import { useEffect } from "react";

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
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey) return;
      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      const inCodeMirror = target?.closest?.(".cm-editor");

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
  }, [onClose, onCycleViewMode, onHighlight, onNew, onOpen, onOpenPreferences, onSave, onToggleSidebar]);
}
