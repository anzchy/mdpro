import { useEffect } from "react";

interface ShortcutHandlers {
  onOpen?: () => void;
  onSave?: () => void;
  onClose?: () => void;
  onNew?: () => void;
  onHighlight?: () => void;
  onToggleSidebar?: () => void;
}

export function useKeyboardShortcuts({
  onOpen,
  onSave,
  onClose,
  onNew,
  onHighlight,
  onToggleSidebar,
}: ShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey) return;
      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      const inCodeMirror = target?.closest?.(".cm-editor");
      if (key === "n" && onNew) {
        event.preventDefault();
        onNew();
      }
      if (key === "h" && event.shiftKey && onHighlight && !inCodeMirror) {
        event.preventDefault();
        onHighlight();
      }
      if (key === "b" && event.shiftKey && onToggleSidebar) {
        event.preventDefault();
        onToggleSidebar();
      }
      if (key === "o" && onOpen) {
        event.preventDefault();
        onOpen();
      }
      if (key === "s" && onSave) {
        event.preventDefault();
        onSave();
      }
      if (key === "w" && onClose) {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onHighlight, onNew, onOpen, onSave, onToggleSidebar]);
}
