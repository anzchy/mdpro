import { invoke } from "@tauri-apps/api/core";
import type { LogContext, LogEntryPayload, LogLevel, LogSettings } from "../types/logging";
import { useLoggingStore } from "../stores/loggingStore";

const levelRank: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
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
  async getLoggingSettings(): Promise<LogSettings> {
    const result = await safeInvoke<LogSettings>("get_logging_settings");
    return (
      result ?? {
        enabled: true,
        level: "info",
      }
    );
  },
  async setLoggingSettings(settings: LogSettings): Promise<LogSettings> {
    const result = await safeInvoke<LogSettings>("set_logging_settings", { settings });
    return result ?? settings;
  },
};
