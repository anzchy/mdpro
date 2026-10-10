/**
 * Purpose: typed IPC wrapper for the user-preferences commands
 *   (`get_preferences`, `set_preferences`, `get_system_theme`,
 *   `save_window_state`), with a browser-mode fallback for `pnpm dev`.
 *
 * Key decisions:
 *   - Branch selection uses `isTauri()` from `@tauri-apps/api/core`, evaluated
 *     at EVERY call (no cached decision). `window.__TAURI__` only exists with
 *     `withGlobalTauri`, which mdpro does not enable, so testing for it sent the
 *     running app down the browser branch (D24, ADR-0031 step 5b).
 *   - `setPreferences` failures raise one toast and one `ui.preferences.save`
 *     fail log whose context is the enum `{ reason: "invoke_rejected" }` — never
 *     the rejection text, which can carry paths from the Rust side. The
 *     rejection is re-thrown unchanged for awaiting callers.
 *   - The browser branch returns a fresh copy of the defaults on every call
 *     (right-biased merge for `setPreferences`), so no caller can mutate them.
 *   - `getPreferences(purpose)` takes a REQUIRED closed-enum purpose, so tsc
 *     rejects an unlabelled caller in `src/` (D24 WI-4, ADR-0032 GA-12). The
 *     Tauri branch logs exactly one `preferences.read` entry after the IPC
 *     settles: info `{ purpose, outcome: "ok" }`, or warn
 *     `{ purpose, outcome: "failed", reason: "invoke_rejected" }` followed by a
 *     rethrow of the same error. Enum-only context: never a preference value,
 *     path or error text. Reads raise no toast. The browser branch logs nothing,
 *     so it stays at zero `invoke` calls.
 *
 * @coordinates-with src-tauri/src/commands/preferences.rs — the IPC commands
 * @coordinates-with src/services/loggingService.ts — read log and fail log sink
 * @coordinates-with src/stores/toastStore.ts — the save-failure toast
 * @module services/preferencesService
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
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

// Default preferences for browser mode — must stay in sync with Rust UserPreferences::default()
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
  logging: { enabled: true, level: "info" },
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

/**
 * A fresh deep copy of the browser defaults. The nested groups are shared module
 * constants, so handing out references let a caller that mutated a returned
 * group (`prefs.mcp.serverEnabled = false`) corrupt every later default.
 */
function browserDefaults(): UserPreferences {
  return structuredClone(DEFAULT_PREFERENCES);
}

/**
 * Why a caller reads preferences — the only thing a `preferences.read` log
 * entry says about the read. One literal per call site (the hook picks one of
 * its two by latch phase). Keep it a closed union of literals.
 */
export type PreferenceReadPurpose =
  | "app_hydrate"
  | "view_mode_startup_settle"
  | "view_mode_restore_on_close"
  | "save_reformat_check"
  | "settings_dialog"
  | "settings_appearance"
  | "settings_general"
  | "settings_markdown"
  | "settings_editor"
  | "settings_export"
  | "settings_image"
  | "settings_shortcuts";

function logRead(purpose: PreferenceReadPurpose, ok: boolean): void {
  loggingService.logEventSync({
    level: ok ? "info" : "warn",
    event: "preferences.read",
    status: ok ? "success" : "fail",
    actionId: loggingService.generateActionId(),
    context: ok
      ? { purpose, outcome: "ok" }
      : { purpose, outcome: "failed", reason: "invoke_rejected" },
  });
}

export const preferencesService = {
  async getPreferences(purpose: PreferenceReadPurpose): Promise<UserPreferences> {
    if (!isTauri()) {
      return browserDefaults();
    }
    let prefs: UserPreferences;
    try {
      prefs = await invoke<UserPreferences>("get_preferences", {});
    } catch (error) {
      logRead(purpose, false);
      throw error;
    }
    logRead(purpose, true);
    return prefs;
  },

  async setPreferences(preferences: Partial<UserPreferences>): Promise<UserPreferences> {
    if (!isTauri()) {
      // In browser mode, just return merged preferences (not persisted)
      return { ...browserDefaults(), ...preferences };
    }
    try {
      return await invoke<UserPreferences>("set_preferences", { preferences });
    } catch (error) {
      // The write-through model fans out from many fire-and-forget call sites
      // (`void setPreferences(...)`). Surface disk-write failures as a single
      // toast (rule 30 §5) so a silent failure never strands the user with a
      // setting they think persisted. Re-throw so awaiting callers can react.
      // Enum-only context: the rejection text can carry filesystem paths.
      loggingService.logEventSync({
        level: "error",
        event: "ui.preferences.save",
        status: "fail",
        actionId: loggingService.generateActionId(),
        context: { reason: "invoke_rejected" },
      });
      useToastStore.getState().showToast("Failed to save preferences");
      throw error;
    }
  },

  async getSystemTheme(): Promise<"light" | "dark"> {
    if (!isTauri()) {
      // Use browser's color scheme preference
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return invoke<"light" | "dark">("get_system_theme", {});
  },

  async saveWindowState(windowState: WindowState): Promise<void> {
    if (!isTauri()) {
      // No-op in browser mode
      return;
    }
    return invoke<void>("save_window_state", { windowState });
  },
};
