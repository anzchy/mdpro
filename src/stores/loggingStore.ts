import { create } from "zustand";
import type { LogLevel, LogSettings } from "../types/logging";

interface LoggingState {
  enabled: boolean;
  level: LogLevel;
  setEnabled: (enabled: boolean) => void;
  setLevel: (level: LogLevel) => void;
  setSettings: (settings: LogSettings) => void;
}

export const useLoggingStore = create<LoggingState>((set) => ({
  enabled: true,
  level: "info",
  setEnabled: (enabled) => set({ enabled }),
  setLevel: (level) => set({ level }),
  setSettings: (settings) => set({ enabled: settings.enabled, level: settings.level }),
}));
