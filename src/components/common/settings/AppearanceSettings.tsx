import { useEffect, useState } from "react";
import type { AppearanceConfig, CodeTheme } from "../../../types/preferences";
import { DEFAULT_APPEARANCE_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { SettingsLoadFailed, SettingsLoading } from "./SettingsPageState";
import { applyCodeTheme } from "./editorPrefApply";
import { useSettingsWriter } from "./useSettingsWriter";

const CODE_THEMES: CodeTheme[] = ["default", "oneDark"];

function isCodeTheme(v: string): v is CodeTheme {
  return (CODE_THEMES as string[]).includes(v);
}

export function AppearanceSettings() {
  // One write at a time; a failed write returns to the last confirmed value (F508-2).
  const writer = useSettingsWriter<AppearanceConfig>({
    group: "appearance",
    save: (next) => preferencesService.setPreferences({ appearance: next }),
    apply: (key, value) => {
      if (key === "codeTheme") applyCodeTheme(value as CodeTheme);
    },
  });
  const prefs = writer.value;
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ticket = writer.readTicket();
    preferencesService
      .getPreferences("settings_appearance")
      .then((p) => {
        if (cancelled) return;
        writer.load({ ...DEFAULT_APPEARANCE_CONFIG, ...p.appearance }, ticket);
      })
      .catch(() => {
        // The service has logged the failure (enum-only); the raw message stays out of the UI.
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCodeThemeChange = (rawValue: string) => {
    if (!prefs || !isCodeTheme(rawValue)) return;
    void writer.write({ codeTheme: rawValue });
  };

  if (loadFailed) {
    return (
      <div>
        <div className="settings-page-header">
          <h3 className="settings-page-title">Appearance</h3>
        </div>
        <SettingsLoadFailed />
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
        <SettingsLoading />
      ) : (
        <div className="settings-row">
          <div className="settings-row-content">
            <div className="settings-row-label">
              <h4 id="appearance-code-theme-label">Code Block Theme</h4>
              <p>Applies in Source mode.</p>
            </div>
            <div className="settings-row-control">
              <select
                id="appearance-code-theme"
                aria-labelledby="appearance-code-theme-label"
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
