import { invoke } from "@tauri-apps/api/core";
import type { UserPreferences, WindowState } from "../types/preferences";
import { DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_MCP_CONFIG } from "../types/preferences";

// Check if running in Tauri environment
const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

// Default preferences for browser mode
const DEFAULT_PREFERENCES: UserPreferences = {
  themeMode: "system",
  autoSaveInterval: 30,
  defaultViewMode: "wysiwyg",
  lastViewMode: "wysiwyg",
  showSidebar: true,
  enableScrollSync: true,
  recentFiles: [],
  windowState: { width: 1200, height: 800, x: 100, y: 100, isMaximized: false },
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
  logging: { enabled: false, level: "info" },
  windowStates: {},
  mcp: DEFAULT_MCP_CONFIG,
};

export const preferencesService = {
  async getPreferences(): Promise<UserPreferences> {
    if (!isTauri) {
      return DEFAULT_PREFERENCES;
    }
    return invoke("get_preferences", {});
  },

  async setPreferences(preferences: Partial<UserPreferences>): Promise<UserPreferences> {
    if (!isTauri) {
      // In browser mode, just return merged preferences (not persisted)
      return { ...DEFAULT_PREFERENCES, ...preferences };
    }
    return invoke("set_preferences", { preferences });
  },

  async getSystemTheme(): Promise<"light" | "dark"> {
    if (!isTauri) {
      // Use browser's color scheme preference
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return invoke("get_system_theme", {});
  },

  async saveWindowState(windowState: WindowState): Promise<void> {
    if (!isTauri) {
      // No-op in browser mode
      return;
    }
    return invoke("save_window_state", { windowState });
  },
};
