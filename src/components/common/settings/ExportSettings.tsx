import { useEffect, useRef, useState } from "react";
import type { UserPreferences, ExportConfig } from "../../../types/preferences";
import { DEFAULT_EXPORT_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { exportService } from "../../../services/exportService";

export function ExportSettings() {
  const cachedFullPrefs = useRef<UserPreferences | null>(null);
  const [prefs, setPrefs] = useState<ExportConfig | null>(null);

  useEffect(() => {
    void preferencesService.getPreferences().then((p) => {
      cachedFullPrefs.current = p;
      setPrefs({ ...DEFAULT_EXPORT_CONFIG, ...p.export });
    });
  }, []);

  const handleChange = (
    key: keyof ExportConfig,
    value: ExportConfig[keyof ExportConfig],
  ) => {
    if (!prefs || !cachedFullPrefs.current) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    cachedFullPrefs.current = { ...cachedFullPrefs.current, export: next };
    void preferencesService.setPreferences(cachedFullPrefs.current);
  };

  const handleBrowse = async () => {
    const folder = await exportService.pickFolder();
    if (folder !== null) {
      handleChange("defaultFolder", folder);
    }
  };

  return (
    <div>
      <div className="settings-page-header">
        <h3 className="settings-page-title">Export</h3>
        <p className="settings-page-desc">HTML export output settings.</p>
      </div>

      {!prefs ? (
        <div aria-busy="true" style={{ opacity: 0.5 }}>
          Loading…
        </div>
      ) : (
        <>
          <div className="settings-row">
            <div className="settings-row-label">
              <h4>Default Export Folder</h4>
              <p>Where exported HTML files are saved. Leave empty to prompt each time.</p>
            </div>
            <div className="settings-row-control" style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                className="settings-input"
                value={prefs.defaultFolder}
                onChange={(e) => handleChange("defaultFolder", e.target.value)}
                placeholder="(prompt on export)"
              />
              <button
                className="toolbar-button"
                type="button"
                onClick={() => void handleBrowse()}
              >
                Browse…
              </button>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <h4>Include Styles in HTML Export</h4>
              <p>Embed CSS styles directly in the exported HTML file.</p>
            </div>
            <div className="settings-row-control">
              <input
                type="checkbox"
                checked={prefs.htmlIncludeStyles}
                onChange={(e) => handleChange("htmlIncludeStyles", e.target.checked)}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
