import { create } from "zustand";
import type { Theme } from "../types/theme";
import type { UserPreferences } from "../types/preferences";

export type ThemeMode = UserPreferences["themeMode"];
export type ResolvedTheme = "light" | "dark";

interface ThemeStore {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  activeTheme: Theme | null;
  setMode: (mode: ThemeMode) => void;
  setResolvedTheme: (theme: ResolvedTheme) => void;
  setActiveTheme: (theme: Theme | null) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  mode: "system",
  resolvedTheme: "light",
  activeTheme: null,
  setMode: (mode) => set({ mode }),
  setResolvedTheme: (theme) => set({ resolvedTheme: theme }),
  setActiveTheme: (theme) => set({ activeTheme: theme }),
}));
