import { useEffect, useState } from "react";
import type { AppearanceConfig, CodeTheme } from "../../../types/preferences";
import { DEFAULT_APPEARANCE_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { applyCodeTheme } from "./editorPrefApply";

const CODE_THEMES: CodeTheme[] = ["default", "oneDark"];

function isCodeTheme(v: string): v is CodeTheme {
  return (CODE_THEMES as string[]).includes(v);
}

export function AppearanceSettings() {
  const [prefs, setPrefs] = useState<AppearanceConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    preferencesService
      .getPreferences()
      .then((p) => {
        if (cancelled) return;
        setPrefs({ ...DEFAULT_APPEARANCE_CONFIG, ...p.appearance });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load settings");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCodeThemeChange = async (rawValue: string) => {
    if (!prefs || !isCodeTheme(rawValue)) return;
    const prev = { ...prefs };
    const next: AppearanceConfig = { ...prefs, codeTheme: rawValue };
    setPrefs(next);
    applyCodeTheme(rawValue);
    try {
      await preferencesService.setPreferences({ appearance: next });
    } catch {
      setPrefs(prev);
      applyCodeTheme(prev.codeTheme);
    }
  };

  if (error) {
    return (
      <div>
        <div className="settings-page-header">
          <h3 className="settings-page-title">Appearance</h3>
        </div>
        <p className="settings-error">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="settings-page-header">
        <h3 className="settings-page-title">Appearance</h3>
        <p className="settings-page-desc">Visual theme for code blocks.</p>
      </div>

      {!prefs ? (
        <div aria-busy="true" style={{ opacity: 0.5 }}>
          Loading…
        </div>
      ) : (
        <div className="settings-row">
          <div className="settings-row-content">
            <div className="settings-row-label">
              <label htmlFor="appearance-code-theme">
                <h4>Code Block Theme</h4>
                <p>Applies in Source mode.</p>
              </label>
            </div>
            <div className="settings-row-control">
              <select
                id="appearance-code-theme"
                className="settings-select"
                value={prefs.codeTheme}
                onChange={(e) => {
                  void handleCodeThemeChange(e.target.value);
                }}
              >
                <option value="default">Default</option>
                <option value="oneDark">One Dark</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
