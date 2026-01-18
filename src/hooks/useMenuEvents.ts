import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ViewMode } from "../types/editor";
import type { UserPreferences } from "../types/preferences";

interface MenuActionPayload {
  action: string;
  value?: string | null;
}

interface MenuHandlers {
  onNew?: () => void;
  onOpen?: () => void;
  onSave?: () => void;
  onClose?: () => void;
  onExportHtml?: () => void;
  onOpenRecent?: (path: string) => void;
  onToggleSidebar?: () => void;
  onHighlight?: () => void;
  onViewModeChange?: (mode: ViewMode) => void;
  onCycleViewMode?: () => void;
  onThemeModeChange?: (mode: UserPreferences["themeMode"]) => void;
  onOpenPreferences?: () => void;
}

export function useMenuEvents(handlers: MenuHandlers) {
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<MenuActionPayload>("menu:action", (event) => {
      const { action, value } = event.payload;
      switch (action) {
        case "file.new":
          handlers.onNew?.();
          break;
        case "file.open":
          handlers.onOpen?.();
          break;
        case "file.save":
          handlers.onSave?.();
          break;
        case "file.close":
          handlers.onClose?.();
          break;
        case "file.export_html":
          handlers.onExportHtml?.();
          break;
        case "file.preferences":
          handlers.onOpenPreferences?.();
          break;
        case "file.open_recent":
          if (value) handlers.onOpenRecent?.(value);
          break;
        case "view.cycle":
          handlers.onCycleViewMode?.();
          break;
        case "view.split":
          handlers.onViewModeChange?.("split");
          break;
        case "view.editor_only":
          handlers.onViewModeChange?.("editor-only");
          break;
        case "view.preview_only":
          handlers.onViewModeChange?.("preview-only");
          break;
        case "view.wysiwyg":
          handlers.onViewModeChange?.("wysiwyg");
          break;
        case "view.toggle_sidebar":
          handlers.onToggleSidebar?.();
          break;
        case "format.highlight":
          handlers.onHighlight?.();
          break;
        case "theme.light":
          handlers.onThemeModeChange?.("light");
          break;
        case "theme.dark":
          handlers.onThemeModeChange?.("dark");
          break;
        case "theme.system":
          handlers.onThemeModeChange?.("system");
          break;
        default:
          break;
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Ignore if menu events are not available.
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, [
    handlers.onClose,
    handlers.onCycleViewMode,
    handlers.onExportHtml,
    handlers.onHighlight,
    handlers.onNew,
    handlers.onOpen,
    handlers.onOpenPreferences,
    handlers.onOpenRecent,
    handlers.onSave,
    handlers.onToggleSidebar,
    handlers.onViewModeChange,
    handlers.onThemeModeChange,
  ]);
}
