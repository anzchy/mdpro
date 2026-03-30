import { useEffect, useRef, useState } from "react";
import type { UserPreferences, MarkdownConfig } from "../../../types/preferences";
import { DEFAULT_MARKDOWN_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { applyAutoPair } from "./editorPrefApply";

export function MarkdownSettings() {
  const cachedFullPrefs = useRef<UserPreferences | null>(null);
  const [prefs, setPrefs] = useState<MarkdownConfig | null>(null);

  useEffect(() => {
    void preferencesService.getPreferences().then((p) => {
      cachedFullPrefs.current = p;
      setPrefs({ ...DEFAULT_MARKDOWN_CONFIG, ...p.markdown });
    });
  }, []);

  const handleChange = (
    key: keyof MarkdownConfig,
    value: MarkdownConfig[keyof MarkdownConfig],
  ) => {
    if (!prefs || !cachedFullPrefs.current) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    if (key === "autoPair") applyAutoPair(value as boolean);
    cachedFullPrefs.current = { ...cachedFullPrefs.current, markdown: next };
    void preferencesService.setPreferences(cachedFullPrefs.current);
  };

  return (
    <div>
      <div className="settings-page-header">
        <h3 className="settings-page-title">Markdown</h3>
        <p className="settings-page-desc">Editing behavior in source mode.</p>
      </div>

      {!prefs ? (
        <div aria-busy="true" style={{ opacity: 0.5 }}>
          Loading…
        </div>
      ) : (
        <div className="settings-row">
          <div className="settings-row-content">
            <div className="settings-row-label">
              <h4>Auto-pair Brackets &amp; Quotes</h4>
              <p>Automatically close brackets, parentheses, and quotes.</p>
            </div>
            <div className="settings-row-control">
              <input
                type="checkbox"
                checked={prefs.autoPair}
                onChange={(e) => handleChange("autoPair", e.target.checked)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
