export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogStatus = "start" | "success" | "fail" | "cancel";

export type LogContext = Record<string, unknown>;

export interface LogEntryPayload {
  level: LogLevel;
  event: string;
  status: LogStatus;
  actionId?: string;
  context?: LogContext;
  durationMs?: number;
  error?: string;
}

export interface LogSettings {
  enabled: boolean;
  level: LogLevel;
}
