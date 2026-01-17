import { useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { preferencesService } from "../services/preferencesService";
import { useThemeStore } from "../stores/themeStore";

export function useTheme() {
  const mode = useThemeStore((state) => state.mode);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setMode = useThemeStore((state) => state.setMode);
  const setResolvedTheme = useThemeStore((state) => state.setResolvedTheme);

  const applySystemTheme = useCallback(async () => {
    try {
      const theme = await preferencesService.getSystemTheme();
      setResolvedTheme(theme);
    } catch {
      setResolvedTheme("light");
    }
  }, [setResolvedTheme]);

  useEffect(() => {
    if (mode === "system") {
      void applySystemTheme();
      let unlisten: (() => void) | null = null;
      listen<{ theme: "light" | "dark" }>("theme:changed", (event) => {
        if (mode === "system") {
          setResolvedTheme(event.payload.theme);
        }
      })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {
          // Ignore if events are not supported.
        });
      return () => {
        if (unlisten) unlisten();
      };
    }
    setResolvedTheme(mode === "dark" ? "dark" : "light");
    return undefined;
  }, [applySystemTheme, mode, setResolvedTheme]);

  const setThemeMode = useCallback(
    async (next: "light" | "dark" | "system") => {
      setMode(next);
      try {
        await preferencesService.setPreferences({ themeMode: next });
      } catch {
        // Ignore persistence errors in web preview.
      }
    },
    [setMode],
  );

  const cycleThemeMode = useCallback(() => {
    const next = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
    void setThemeMode(next);
  }, [mode, setThemeMode]);

  return {
    mode,
    resolvedTheme,
    setThemeMode,
    cycleThemeMode,
  };
}
