import { useEffect, useState } from "react";
import type { UserPreferences } from "../../../types/preferences";
import type { ViewMode } from "../../../types/editor";
import { preferencesService } from "../../../services/preferencesService";
import { SettingsLoadFailed, SettingsLoading } from "./SettingsPageState";
import { useSettingsWriter } from "./useSettingsWriter";
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
  const [loadError, setLoadError] = useState(false);
  const setAutoSaveInterval = useEditorStore((s) => s.setAutoSaveInterval);
  // One write at a time; a failed write returns to the last confirmed value (F508-2).
  const writer = useSettingsWriter<GeneralSlice>({
    group: "general",
    // Only the changed scalar is sent; the rest of the slice is already saved.
    save: (_next, patch) => preferencesService.setPreferences(patch as Partial<UserPreferences>),
    apply: (key, value) => {
      if (key === "autoSaveInterval") setAutoSaveInterval(value as number);
    },
  });
  const prefs = writer.value;

  useEffect(() => {
    let mounted = true;
    const ticket = writer.readTicket();
    preferencesService.getPreferences("settings_general").then((p: UserPreferences) => {
      if (!mounted) return;
      writer.load({
        defaultViewMode: migrateViewMode(p.defaultViewMode as string),
        autoSaveInterval: p.autoSaveInterval ?? 30,
      }, ticket);
    }).catch(() => {
      if (!mounted) return;
      setLoadError(true);
    });
    return () => { mounted = false; };
  }, []);

  const handleChange = (key: keyof GeneralSlice, value: ViewMode | number) => {
    void writer.write({ [key]: value } as Partial<GeneralSlice>);
  };

  if (loadError) {
    return (
      <div>
        <div className="settings-page-header">
          <h3 className="settings-page-title">General</h3>
        </div>
        <SettingsLoadFailed />
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
        <SettingsLoading />
      ) : (
        <>
          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <h4 id="general-default-view-mode-label">Default View Mode</h4>
                <p>New documents open in this mode.</p>
              </div>
              <div className="settings-row-control">
                <select
                  aria-labelledby="general-default-view-mode-label"
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
          </div>

          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <h4 id="general-autosave-interval-label">Auto-save Interval</h4>
                <p>How often modified documents are automatically saved.</p>
              </div>
              <div className="settings-row-control">
                <select
                  aria-labelledby="general-autosave-interval-label"
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
          </div>
        </>
      )}
    </div>
  );
}
