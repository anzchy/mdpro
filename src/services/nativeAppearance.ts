/**
 * Purpose: set the app's native appearance (NSAppearance on macOS) to match the
 * theme mode, so native pop-up menus (the Settings selects) and the Open / Save
 * panels are dark in Dark mode (D238). Before this, mdpro styled only its own
 * DOM, and every native surface stayed light.
 *
 * Pipeline: `useTheme` effect → `applyNativeAppearance(mode)` → Tauri's
 * `plugin:app|set_app_theme` (what `@tauri-apps/api/app`'s `setTheme` sends),
 * with `"dark"` / `"light"`, or `null` for System (follow the OS).
 *
 * Key decisions:
 * - **System sends `null`, and the caller awaits it before reading the system
 *   theme.** `get_system_theme` reads the window's theme; while a forced
 *   appearance is still applied, that read would return the forced value, not
 *   the OS one.
 * - **A failure never blocks the CSS theme.** It resolves (never rejects) and
 *   logs `ui.theme.native_appearance` fail with an enum reason only.
 * - **Outside Tauri it does nothing** (web preview has no native surfaces).
 * - Needs the capability `core:app:allow-set-app-theme`
 *   (`src-tauri/capabilities/default.json`); `core:app:default` does not
 *   include it, and it is the only permission that grants `set_app_theme`.
 *
 * @module src/services/nativeAppearance
 * @coordinates-with src/hooks/useTheme.ts — calls it on every mode change
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ThemeMode } from "../stores/themeStore";
import { loggingService } from "./loggingService";

/** Apply `mode` to the native appearance; resolves once Tauri has applied it. */
export async function applyNativeAppearance(mode: ThemeMode): Promise<void> {
  if (!isTauri()) return;
  try {
    // Exactly what `setTheme` in `@tauri-apps/api/app` sends. Called through
    // `core`'s `invoke` so this module has one IPC boundary, like every other
    // service here (the `app` module imports `core` by a relative path).
    await invoke("plugin:app|set_app_theme", { theme: mode === "system" ? null : mode });
  } catch {
    loggingService.logEventSync({
      level: "warn",
      event: "ui.theme.native_appearance",
      status: "fail",
      actionId: loggingService.generateActionId(),
      context: { mode, reason: "set_failed" },
    });
  }
}
