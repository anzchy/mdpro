import { invoke } from "@tauri-apps/api/core";
import type { UserPreferences, WindowState } from "../types/preferences";

export const preferencesService = {
  async getPreferences(): Promise<UserPreferences> {
    return invoke("get_preferences", {});
  },

  async setPreferences(preferences: Partial<UserPreferences>): Promise<UserPreferences> {
    return invoke("set_preferences", { preferences });
  },

  async getSystemTheme(): Promise<"light" | "dark"> {
    return invoke("get_system_theme", {});
  },

  async saveWindowState(windowState: WindowState): Promise<void> {
    return invoke("save_window_state", { windowState });
  },
};
