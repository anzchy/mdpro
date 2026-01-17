import { create } from "zustand";
import type { Theme } from "../types/theme";
import type { UserPreferences } from "../types/preferences";

export type ThemeMode = UserPreferences["themeMode"];

interface ThemeStore {
  mode: ThemeMode;
  activeTheme: Theme | null;
  setMode: (mode: ThemeMode) => void;
  setActiveTheme: (theme: Theme | null) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  mode: "system",
  activeTheme: null,
  setMode: (mode) => set({ mode }),
  setActiveTheme: (theme) => set({ activeTheme: theme }),
}));
