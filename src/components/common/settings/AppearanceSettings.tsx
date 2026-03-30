import { useEffect, useRef, useState } from "react";
import type { UserPreferences, AppearanceConfig, CodeTheme } from "../../../types/preferences";
import { DEFAULT_APPEARANCE_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { applyCodeTheme } from "./editorPrefApply";

export function AppearanceSettings() {
  const cachedFullPrefs = useRef<UserPreferences | null>(null);
  const [prefs, setPrefs] = useState<AppearanceConfig | null>(null);

  useEffect(() => {
    void preferencesService.getPreferences().then((p) => {
      cachedFullPrefs.current = p;
      setPrefs({ ...DEFAULT_APPEARANCE_CONFIG, ...p.appearance });
    });
  }, []);

  const handleChange = (
    key: keyof AppearanceConfig,
    value: AppearanceConfig[keyof AppearanceConfig],
  ) => {
    if (!prefs || !cachedFullPrefs.current) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    if (key === "codeTheme") applyCodeTheme(value as CodeTheme);
    cachedFullPrefs.current = { ...cachedFullPrefs.current, appearance: next };
    void preferencesService.setPreferences(cachedFullPrefs.current);
  };

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
              <h4>Code Block Theme</h4>
              <p>Applies in Source mode.</p>
            </div>
            <div className="settings-row-control">
              <select
                className="settings-select"
                value={prefs.codeTheme}
                onChange={(e) =>
                  handleChange("codeTheme", e.target.value as CodeTheme)
                }
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
