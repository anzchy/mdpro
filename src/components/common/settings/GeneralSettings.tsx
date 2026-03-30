import { useEffect, useRef, useState } from "react";
import type { UserPreferences } from "../../../types/preferences";
import type { ViewMode } from "../../../types/editor";
import { preferencesService } from "../../../services/preferencesService";
import { useEditorStore } from "../../../stores/editorStore";

interface GeneralSlice {
  defaultViewMode: ViewMode;
  autoSaveInterval: number;
}

const VIEW_MODE_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "editor-only", label: "Editor" },
  { value: "preview-only", label: "Preview" },
  { value: "split", label: "Split" },
  { value: "wysiwyg", label: "WYSIWYG" },
];

const AUTOSAVE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
  { value: 120, label: "2 minutes" },
  { value: 300, label: "5 minutes" },
];

export function GeneralSettings() {
  const cachedFullPrefs = useRef<UserPreferences | null>(null);
  const [prefs, setPrefs] = useState<GeneralSlice | null>(null);
  const setAutoSaveInterval = useEditorStore((s) => s.setAutoSaveInterval);

  useEffect(() => {
    void preferencesService.getPreferences().then((p) => {
      cachedFullPrefs.current = p;
      setPrefs({
        defaultViewMode: p.defaultViewMode ?? "wysiwyg",
        autoSaveInterval: p.autoSaveInterval ?? 30,
      });
    });
  }, []);

  const handleChange = (key: keyof GeneralSlice, value: ViewMode | number) => {
    if (!prefs || !cachedFullPrefs.current) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    // Decision 1A: update editorStore so useAutoSave reacts immediately
    if (key === "autoSaveInterval") {
      setAutoSaveInterval(value as number);
    }
    cachedFullPrefs.current = { ...cachedFullPrefs.current, ...next };
    void preferencesService.setPreferences(cachedFullPrefs.current);
  };

  return (
    <div>
      <div className="settings-page-header">
        <h3 className="settings-page-title">General</h3>
        <p className="settings-page-desc">App behavior and startup preferences.</p>
      </div>

      {!prefs ? (
        <div aria-busy="true" style={{ opacity: 0.5 }}>
          Loading…
        </div>
      ) : (
        <>
          <div className="settings-row">
            <div className="settings-row-label">
              <h4>Default View Mode</h4>
              <p>New documents open in this mode.</p>
            </div>
            <div className="settings-row-control">
              <select
                className="settings-select"
                value={prefs.defaultViewMode}
                onChange={(e) =>
                  handleChange("defaultViewMode", e.target.value as ViewMode)
                }
              >
                {VIEW_MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <h4>Auto-save Interval</h4>
              <p>How often modified documents are automatically saved.</p>
            </div>
            <div className="settings-row-control">
              <select
                className="settings-select"
                value={prefs.autoSaveInterval}
                onChange={(e) =>
                  handleChange("autoSaveInterval", Number(e.target.value))
                }
              >
                {AUTOSAVE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
