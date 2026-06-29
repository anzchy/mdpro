import { invoke } from "@tauri-apps/api/core";
import type { UserPreferences, WindowState } from "../types/preferences";
import { useToastStore } from "../stores/toastStore";
import { loggingService } from "./loggingService";
import {
  DEFAULT_APPEARANCE_CONFIG,
  DEFAULT_AUTO_SAVE_CONFIG,
  DEFAULT_EDITOR_CONFIG,
  DEFAULT_EXPORT_CONFIG,
  DEFAULT_IMAGE_CONFIG,
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_MARKDOWN_CONFIG,
  DEFAULT_MCP_CONFIG,
  DEFAULT_TAB_BAR_CONFIG,
} from "../types/preferences";

// Check if running in Tauri environment. Evaluated at call time (not just once
// at module load) so the write-through path is testable and robust to late
// Tauri bootstrap.
function isTauriEnv(): boolean {
  return (
    (typeof window !== "undefined" && "__TAURI__" in window) ||
    (typeof globalThis !== "undefined" && "__TAURI__" in globalThis)
  );
}

// Default preferences for browser mode — must stay in sync with Rust UserPreferences::default()
const DEFAULT_PREFERENCES: UserPreferences = {
  themeMode: "system",
  autoSaveInterval: 30,
  defaultViewMode: "wysiwyg",
  lastViewMode: "wysiwyg",
  showSidebar: true,
  showStatusBar: false,
  enableScrollSync: true,
  recentFiles: [],
  windowState: { width: 1200, height: 800, x: 100, y: 100, isMaximized: false },
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
  logging: { enabled: false, level: "info" },
  windowStates: {},
  mcp: DEFAULT_MCP_CONFIG,
  editor: DEFAULT_EDITOR_CONFIG,
  markdown: DEFAULT_MARKDOWN_CONFIG,
  appearance: DEFAULT_APPEARANCE_CONFIG,
  image: DEFAULT_IMAGE_CONFIG,
  export: DEFAULT_EXPORT_CONFIG,
  autoSave: DEFAULT_AUTO_SAVE_CONFIG,
  tabBar: DEFAULT_TAB_BAR_CONFIG,
};

export const preferencesService = {
  async getPreferences(): Promise<UserPreferences> {
    if (!isTauriEnv()) {
      return DEFAULT_PREFERENCES;
    }
    return invoke<UserPreferences>("get_preferences", {});
  },

  async setPreferences(preferences: Partial<UserPreferences>): Promise<UserPreferences> {
    if (!isTauriEnv()) {
      // In browser mode, just return merged preferences (not persisted)
      return { ...DEFAULT_PREFERENCES, ...preferences };
    }
    try {
      return await invoke<UserPreferences>("set_preferences", { preferences });
    } catch (error) {
      // The write-through model fans out from many fire-and-forget call sites
      // (`void setPreferences(...)`). Surface disk-write failures as a single
      // toast (rule 30 §5) so a silent failure never strands the user with a
      // setting they think persisted. Re-throw so awaiting callers can react.
      const message = error instanceof Error ? error.message : String(error);
      loggingService.logEventSync({
        level: "error",
        event: "ui.preferences.save",
        status: "fail",
        actionId: loggingService.generateActionId(),
        context: { error: message },
      });
      useToastStore.getState().showToast("Failed to save preferences");
      throw error;
    }
  },

  async getSystemTheme(): Promise<"light" | "dark"> {
    if (!isTauriEnv()) {
      // Use browser's color scheme preference
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return invoke<"light" | "dark">("get_system_theme", {});
  },

  async saveWindowState(windowState: WindowState): Promise<void> {
    if (!isTauriEnv()) {
      // No-op in browser mode
      return;
    }
    return invoke<void>("save_window_state", { windowState });
  },
};
