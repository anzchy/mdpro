import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ViewMode } from "../types/editor";
import type { UserPreferences } from "../types/preferences";
import { loggingService } from "../services/loggingService";

interface MenuActionPayload {
  action: string;
  value?: string | null;
}

interface MenuHandlers {
  onNew?: (actionId?: string) => void;
  onNewWindow?: (actionId?: string) => void;
  onOpen?: (actionId?: string) => void;
  onSave?: (actionId?: string) => void;
  onClose?: (actionId?: string) => void;
  onExportHtml?: (actionId?: string) => void;
  onOpenRecent?: (path: string, actionId?: string) => void;
  onToggleSidebar?: (actionId?: string) => void;
  onHighlight?: (actionId?: string) => void;
  onViewModeChange?: (mode: ViewMode, actionId?: string) => void;
  onCycleViewMode?: (actionId?: string) => void;
  onThemeModeChange?: (mode: UserPreferences["themeMode"], actionId?: string) => void;
  onOpenPreferences?: (actionId?: string) => void;
}

export function useMenuEvents(handlers: MenuHandlers) {
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const shouldHandleMenuAction = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();
        const isFocused = await currentWindow.isFocused();
        return isFocused;
      } catch {
        return true;
      }
    };

    const handleMenuAction = async ({ action, value }: MenuActionPayload) => {
      const canHandle = await shouldHandleMenuAction();
      if (!canHandle) return;
      switch (action) {
        case "file.new":
          handlers.onNew?.(loggingService.logMenuSelect("menu.file.new"));
          break;
        case "file.new_window":
          handlers.onNewWindow?.(loggingService.logMenuSelect("menu.file.new_window"));
          break;
        case "file.open":
          handlers.onOpen?.(loggingService.logMenuSelect("menu.file.open"));
          break;
        case "file.save":
          handlers.onSave?.(loggingService.logMenuSelect("menu.file.save"));
          break;
        case "file.close":
          handlers.onClose?.(loggingService.logMenuSelect("menu.file.close"));
          break;
        case "file.export_html":
          handlers.onExportHtml?.(loggingService.logMenuSelect("menu.file.export_html"));
          break;
        case "file.preferences":
          handlers.onOpenPreferences?.(loggingService.logMenuSelect("menu.file.preferences"));
          break;
        case "file.open_recent":
          if (value) {
            const actionId = loggingService.logMenuSelect("menu.file.open_recent", {
              filePath: value,
            });
            handlers.onOpenRecent?.(value, actionId);
          }
          break;
        case "view.cycle":
          handlers.onCycleViewMode?.(loggingService.logMenuSelect("menu.view.cycle"));
          break;
        case "cycle-view-mode":
          handlers.onCycleViewMode?.(loggingService.logMenuSelect("menu.view.cycle"));
          break;
        case "set-view-mode": {
          if (!value) break;
          const mode = value as ViewMode;
          if (
            mode === "split" ||
            mode === "editor-only" ||
            mode === "preview-only" ||
            mode === "wysiwyg"
          ) {
            handlers.onViewModeChange?.(
              mode,
              loggingService.logMenuSelect("menu.view.set_mode", { mode }),
            );
          }
          break;
        }
        case "view.toggle_sidebar":
          handlers.onToggleSidebar?.(loggingService.logMenuSelect("menu.view.toggle_sidebar"));
          break;
        case "format.highlight":
          handlers.onHighlight?.(loggingService.logMenuSelect("menu.format.highlight"));
          break;
        case "theme.light":
          handlers.onThemeModeChange?.(
            "light",
            loggingService.logMenuSelect("menu.theme.light"),
          );
          break;
        case "theme.dark":
          handlers.onThemeModeChange?.(
            "dark",
            loggingService.logMenuSelect("menu.theme.dark"),
          );
          break;
        case "theme.system":
          handlers.onThemeModeChange?.(
            "system",
            loggingService.logMenuSelect("menu.theme.system"),
          );
          break;
        default:
          break;
      }
    };

    listen<MenuActionPayload>("menu:action", (event) => {
      void handleMenuAction(event.payload);
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
    handlers.onNewWindow,
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
