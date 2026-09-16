import { invoke } from "@tauri-apps/api/core";
import type { LogContext, LogEntryPayload, LogLevel, LogSettings } from "../types/logging";
import { useLoggingStore } from "../stores/loggingStore";

const levelRank: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Fail-closed fallback applied when the backend's logging settings cannot be
 * read (IPC rejection, or a resolve with no payload).
 *
 * `enabled: false` — and only that field flips, because `enabled` is the field
 * carrying a safety meaning. A fail-*open* fallback would silently re-enable
 * logging for a user who turned it off, contradicting the guarantee in
 * CHANGELOG.md, and would be undetectable in practice because it is
 * byte-identical to `useLoggingStore`'s initial state.
 *
 * A fresh install does NOT reach this value: `load_preferences`
 * (src-tauri/src/services/preferences.rs) creates config.json with defaults and
 * returns `Ok` when the file is absent, so a first launch arrives at
 * `enabled: true` through the success path. Reaching this constant means
 * config.json is genuinely unreadable or unparseable.
 *
 * Read-side default only — it is never written back to config.json, since
 * persisting it would turn a transient startup failure into permanent
 * destruction of the user's real setting.
 */
const FAIL_CLOSED_SETTINGS: LogSettings = {
  enabled: false,
  level: "info",
};

const shouldLog = (level: LogLevel) => {
  const { enabled, level: minLevel } = useLoggingStore.getState();
  return enabled && levelRank[level] >= levelRank[minLevel];
};

const safeInvoke = async <T>(command: string, payload?: Record<string, unknown>) => {
  try {
    return await invoke<T>(command, payload ?? {});
  } catch {
    return null;
  }
};

const generateActionId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `action-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const logEvent = async (payload: LogEntryPayload) => {
  if (!shouldLog(payload.level)) return;
  await safeInvoke("log_event", { payload });
};

const logEventSync = (payload: LogEntryPayload) => {
  if (!shouldLog(payload.level)) return;
  void safeInvoke("log_event", { payload });
};

const logUiEvent = (
  event: string,
  context: LogContext,
  level: LogLevel = "info",
  status: "success" | "start" | "fail" | "cancel" = "success",
  actionId?: string,
) => {
  const finalActionId = actionId ?? generateActionId();
  logEventSync({
    level,
    event,
    status,
    actionId: finalActionId,
    context,
  });
  return finalActionId;
};

export const loggingService = {
  generateActionId,
  logEvent,
  logEventSync,
  logUiEvent,
  logShortcut: (shortcut: string, context: LogContext = {}) =>
    logUiEvent("ui.shortcut.trigger", { shortcut, ...context }, "info"),
  logMenuSelect: (controlId: string, context: LogContext = {}) =>
    logUiEvent("ui.menu.select", { controlId, ...context }, "info"),
  logButtonClick: (controlId: string, context: LogContext = {}) =>
    logUiEvent("ui.button.click", { controlId, ...context }, "info"),
  logDialogAction: (controlId: string, status: "success" | "cancel", context: LogContext = {}) =>
    logUiEvent(status === "cancel" ? "ui.dialog.cancel" : "ui.dialog.confirm", {
      controlId,
      ...context,
    }),
  /**
   * Read the backend's logging settings.
   *
   * Total over every `invoke` outcome and never rejects: `safeInvoke` maps an
   * IPC rejection to `null`, and a nullish result yields the fail-closed
   * `FAIL_CLOSED_SETTINGS` (`{ enabled: false, level: "info" }`). A successful
   * read is applied verbatim — no clamping, no merging with the current store.
   */
  async getLoggingSettings(): Promise<LogSettings> {
    const result = await safeInvoke<LogSettings>("get_logging_settings");
    return result ?? { ...FAIL_CLOSED_SETTINGS };
  },
  /**
   * Load the backend's logging settings and apply them to the store verbatim.
   *
   * `preferencesService.getPreferences()` cannot be used for this: its
   * `isTauriEnv()` detector tests for `window.__TAURI__`, which Tauri v2 only
   * injects when `withGlobalTauri` is enabled — and it is not. In the shipping
   * app that detector always reports browser mode, so the preference never
   * reaches the frontend. `getLoggingSettings()` goes straight through
   * `safeInvoke`, bypassing the detector.
   *
   * Never rejects: `safeInvoke` yields null on an IPC failure and
   * `getLoggingSettings` applies the fail-closed `FAIL_CLOSED_SETTINGS`
   * fallback (`{ enabled: false, level: "info" }`), so a caller can await this
   * without guarding the rest of its work. `App.tsx#loadPreferences` relies on
   * that non-rejection contract.
   *
   * Writes the store on BOTH paths: a failed read actively sets the store
   * disabled rather than leaving the store's initial `enabled: true` in place.
   * The value written is always exactly the value returned.
   *
   * Uses `loggingService.` rather than `this.` so the method stays callable when
   * destructured off the service object.
   */
  async hydrateSettings(): Promise<LogSettings> {
    const settings = await loggingService.getLoggingSettings();
    useLoggingStore.getState().setSettings(settings);
    return settings;
  },
  async setLoggingSettings(settings: LogSettings): Promise<LogSettings> {
    const result = await safeInvoke<LogSettings>("set_logging_settings", { settings });
    return result ?? settings;
  },
};
