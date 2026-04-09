import { useEffect, useState } from "react";
import type { UserPreferences } from "../../../types/preferences";
import type { ViewMode } from "../../../types/editor";
import { preferencesService } from "../../../services/preferencesService";
import { useEditorStore } from "../../../stores/editorStore";
import { migrateViewMode } from "../../../utils/viewModeUtils";

interface GeneralSlice {
  defaultViewMode: ViewMode;
  autoSaveInterval: number;
}

const VIEW_MODE_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "wysiwyg", label: "WYSIWYG" },
  { value: "source", label: "Source" },
];

const AUTOSAVE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
  { value: 120, label: "2 minutes" },
  { value: 300, label: "5 minutes" },
];

export function GeneralSettings() {
  const [prefs, setPrefs] = useState<GeneralSlice | null>(null);
  const [loadError, setLoadError] = useState(false);
  const setAutoSaveInterval = useEditorStore((s) => s.setAutoSaveInterval);

  useEffect(() => {
    let mounted = true;
    preferencesService.getPreferences().then((p: UserPreferences) => {
      if (!mounted) return;
      setPrefs({
        defaultViewMode: migrateViewMode(p.defaultViewMode as string),
        autoSaveInterval: p.autoSaveInterval ?? 30,
      });
    }).catch(() => {
      if (!mounted) return;
      setLoadError(true);
    });
    return () => { mounted = false; };
  }, []);

  const handleChange = async (key: keyof GeneralSlice, value: ViewMode | number) => {
    if (!prefs) return;
    const prevPrefs = { ...prefs };
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    if (key === "autoSaveInterval") {
      setAutoSaveInterval(value as number);
    }
    try {
      // Send only the changed scalar field to avoid whole-object snapshot races
      await preferencesService.setPreferences({ [key]: value } as Partial<UserPreferences>);
    } catch {
      // Rollback on save failure
      setPrefs(prevPrefs);
      if (key === "autoSaveInterval") {
        setAutoSaveInterval(prevPrefs.autoSaveInterval);
      }
    }
  };

  if (loadError) {
    return (
      <div>
        <div className="settings-page-header">
          <h3 className="settings-page-title">General</h3>
        </div>
        <p style={{ color: "var(--color-text-secondary)" }}>
          Failed to load preferences. Please close and reopen settings.
        </p>
      </div>
    );
  }

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
                  void handleChange("defaultViewMode", e.target.value as ViewMode)
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
                  void handleChange("autoSaveInterval", Number(e.target.value))
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
