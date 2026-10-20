import { invoke, isTauri } from "@tauri-apps/api/core";
import type { LogContext, LogEntryPayload, LogLevel, LogSettings } from "../types/logging";
import { useLoggingStore } from "../stores/loggingStore";
import { useToastStore } from "../stores/toastStore";

/** The one save-failure toast, shared with `preferencesService.setPreferences`. */
const SAVE_FAILED_TOAST = "Failed to save preferences";

// A read captures this before IPC. Only a confirmed backend write advances it;
// a rejected write must still allow the pending read to hydrate the store.
let confirmedWriteGeneration = 0;

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
   * Reads through `getLoggingSettings()` (a direct `safeInvoke`) rather than
   * `preferencesService.getPreferences(purpose)`. The preferences path once
   * used a `window.__TAURI__` detector that always reported browser mode in the
   * shipping app (D24, fixed in ADR-0031 step 5b by `isTauri()`); the dedicated
   * command stays because it is fail-closed and never rejects, which the full
   * preferences read does not guarantee. It also logs nothing itself, while a
   * preferences read emits a `preferences.read` entry (D24 WI-4).
   *
   * Never rejects: `safeInvoke` yields null on an IPC failure and
   * `getLoggingSettings` applies the fail-closed `FAIL_CLOSED_SETTINGS`
   * fallback (`{ enabled: false, level: "info" }`), so a caller can await this
   * without guarding the rest of its work. `App.tsx#loadPreferences` relies on
   * that non-rejection contract.
   *
   * Writes the store on BOTH read outcomes, including the fail-closed fallback,
   * unless a logging write was confirmed after this read began. A late read
   * then leaves the confirmed store value alone, even if Advanced is closed.
   * The returned value remains the read result for existing callers.
   *
   * Uses `loggingService.` rather than `this.` so the method stays callable when
   * destructured off the service object.
   */
  async hydrateSettings(): Promise<LogSettings> {
    const startGeneration = confirmedWriteGeneration;
    const settings = await loggingService.getLoggingSettings();
    if (startGeneration !== confirmedWriteGeneration) {
      logEventSync({
        level: "info",
        event: "ui.logging.settings.hydrate",
        status: "cancel",
        actionId: generateActionId(),
        context: { reason: "confirmed_write_since_read" },
      });
      return settings;
    }
    useLoggingStore.getState().setSettings(settings);
    return settings;
  },
  /**
   * Write the logging settings and return what the backend stored.
   *
   * Rejects when the write fails (WI-4.3b, the logging slice of WI-4.13). It
   * used to map an IPC rejection to the settings it was asked to write, so a
   * failed write looked saved and no caller could tell. Like
   * `preferencesService.setPreferences`, it raises the one save toast (rule 30
   * rule 5), logs an enum-only `fail` (the rejection text can carry paths) and
   * re-throws, so the caller keeps the saved value.
   */
  async setLoggingSettings(settings: LogSettings): Promise<LogSettings> {
    try {
      const saved = await invoke<LogSettings>("set_logging_settings", { settings });
      confirmedWriteGeneration += 1;
      return saved;
    } catch (error) {
      logEventSync({
        level: "error",
        event: "ui.logging.settings.save",
        status: "fail",
        actionId: generateActionId(),
        context: { reason: "invoke_rejected" },
      });
      useToastStore.getState().showToast(SAVE_FAILED_TOAST);
      throw error;
    }
  },

  /** Patch only changed logging leaves in the desktop app. */
  async patchLoggingSettings(patch: Partial<LogSettings>, browserSnapshot: LogSettings): Promise<LogSettings> {
    if (!isTauri()) return this.setLoggingSettings({ ...browserSnapshot, ...patch });
    try {
      const saved = await invoke<LogSettings>("patch_settings_group", { group: "logging", patch });
      confirmedWriteGeneration += 1;
      return saved;
    } catch (error) {
      logEventSync({
        level: "error", event: "ui.logging.settings.save", status: "fail",
        actionId: generateActionId(), context: { reason: "invoke_rejected" },
      });
      useToastStore.getState().showToast(SAVE_FAILED_TOAST);
      throw error;
    }
  },
};
