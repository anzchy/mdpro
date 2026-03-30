import { useEffect, useRef, useState } from "react";
import type { ExportConfig } from "../../../types/preferences";
import { DEFAULT_EXPORT_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { exportService } from "../../../services/exportService";

export function ExportSettings() {
  const [prefs, setPrefs] = useState<ExportConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    preferencesService
      .getPreferences()
      .then((p) => {
        if (cancelled) return;
        setPrefs({ ...DEFAULT_EXPORT_CONFIG, ...p.export });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load settings");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Checkbox toggle — immediate async save with rollback. */
  const handleBoolChange = async (key: keyof ExportConfig, value: boolean) => {
    if (!prefs) return;
    const prev = { ...prefs };
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      await preferencesService.setPreferences({ export: next });
    } catch {
      setPrefs(prev);
    }
  };

  /** Text input — debounced save, no rollback needed on debounce. */
  const handleFolderChange = (value: string) => {
    if (!prefs) return;
    const next = { ...prefs, defaultFolder: value };
    setPrefs(next);
    if (textSaveTimer.current) clearTimeout(textSaveTimer.current);
    textSaveTimer.current = setTimeout(() => {
      void preferencesService.setPreferences({ export: next }).catch(() => {
        setError("Failed to save export settings");
      });
    }, 500);
  };

  const handleBrowse = async () => {
    const folder = await exportService.pickFolder();
    if (folder !== null && prefs) {
      const next = { ...prefs, defaultFolder: folder };
      setPrefs(next);
      try {
        await preferencesService.setPreferences({ export: next });
      } catch {
        setPrefs(prefs);
      }
    }
  };

  if (error) {
    return (
      <div>
        <div className="settings-page-header">
          <h3 className="settings-page-title">Export</h3>
        </div>
        <p className="settings-error">{error}</p>
      </div>
    );
  }

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
              <label htmlFor="export-default-folder">
                <h4>Default Export Folder</h4>
                <p>
                  Where exported HTML files are saved by default. Leave empty to
                  prompt each time.
                </p>
              </label>
            </div>
            <div className="settings-row-control" style={{ display: "flex", gap: 6 }}>
              <input
                id="export-default-folder"
                type="text"
                className="settings-input"
                value={prefs.defaultFolder}
                onChange={(e) => handleFolderChange(e.target.value)}
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
              <label htmlFor="export-include-styles">
                <h4>Include Styles in HTML Export</h4>
                <p>Embed CSS styles directly in the exported HTML file.</p>
              </label>
            </div>
            <div className="settings-row-control">
              <input
                id="export-include-styles"
                type="checkbox"
                checked={prefs.htmlIncludeStyles}
                onChange={(e) => {
                  void handleBoolChange("htmlIncludeStyles", e.target.checked);
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
