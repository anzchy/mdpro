import { useEffect, useState } from "react";
import type { EditorConfig, ContentWidth } from "../../../types/preferences";
import { DEFAULT_EDITOR_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { applyEditorPref } from "./editorPrefApply";
import { SettingsStepper } from "./SettingsStepper";

export function EditorSettings() {
  const [prefs, setPrefs] = useState<EditorConfig | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let mounted = true;
    preferencesService.getPreferences().then((p) => {
      if (!mounted) return;
      setPrefs({ ...DEFAULT_EDITOR_CONFIG, ...p.editor });
    }).catch(() => {
      if (!mounted) return;
      setLoadError(true);
    });
    return () => { mounted = false; };
  }, []);

  const handleChange = async (
    key: keyof EditorConfig,
    value: EditorConfig[keyof EditorConfig],
  ) => {
    if (!prefs) return;
    const prevPrefs = { ...prefs };
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    applyEditorPref(key, value);
    try {
      await preferencesService.setPreferences({ editor: next });
    } catch {
      // Rollback UI and applied pref on save failure
      setPrefs(prevPrefs);
      applyEditorPref(key, prevPrefs[key]);
    }
  };

  if (loadError) {
    return (
      <div>
        <div className="settings-page-header">
          <h3 className="settings-page-title">Editor</h3>
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
        <h3 className="settings-page-title">Editor</h3>
        <p className="settings-page-desc">Typography and editing behavior defaults.</p>
      </div>

      {!prefs ? (
        <div aria-busy="true" style={{ opacity: 0.5 }}>
          Loading…
        </div>
      ) : (
        <>
          <div className="settings-section-label">TYPOGRAPHY</div>

          {/* Font Family */}
          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <h4>Font Family</h4>
              </div>
              <div className="settings-row-control">
                <select
                  className="settings-select"
                  value={prefs.fontFamily}
                  onChange={(e) =>
                    void handleChange(
                      "fontFamily",
                      e.target.value as EditorConfig["fontFamily"],
                    )
                  }
                >
                  <option value="system">System Default</option>
                  <option value="serif">Serif</option>
                  <option value="mono">Monospace</option>
                </select>
              </div>
            </div>
          </div>

          {/* Font Size */}
          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <h4>Font Size</h4>
              </div>
              <div className="settings-row-control">
                <SettingsStepper
                  value={prefs.fontSize}
                  min={12}
                  max={24}
                  unit="px"
                  onChange={(v) => void handleChange("fontSize", v)}
                />
              </div>
            </div>
          </div>

          {/* Line Height */}
          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <h4>Line Height</h4>
              </div>
              <div className="settings-row-control">
                <select
                  className="settings-select"
                  value={prefs.lineHeightX10}
                  onChange={(e) =>
                    void handleChange("lineHeightX10", Number(e.target.value))
                  }
                >
                  <option value={12}>1.2</option>
                  <option value={14}>1.4</option>
                  <option value={16}>1.6</option>
                  <option value={18}>1.8</option>
                  <option value={20}>2.0</option>
                </select>
              </div>
            </div>
          </div>

          {/* Content Width */}
          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <h4>Content Width</h4>
              </div>
              <div className="settings-row-control">
                <select
                  className="settings-select"
                  value={prefs.contentWidth}
                  onChange={(e) =>
                    void handleChange("contentWidth", e.target.value as ContentWidth)
                  }
                >
                  <option value="narrow">Narrow (600px)</option>
                  <option value="medium">Medium (780px)</option>
                  <option value="wide">Wide (900px)</option>
                  <option value="full">Full Width</option>
                </select>
              </div>
            </div>
          </div>

          <div className="settings-section-label" style={{ marginTop: 16 }}>
            BEHAVIOR
          </div>

          {/* Tab Size */}
          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <h4>Tab Size</h4>
              </div>
              <div className="settings-row-control">
                <select
                  className="settings-select"
                  value={prefs.tabSize}
                  onChange={(e) =>
                    void handleChange("tabSize", Number(e.target.value) as 2 | 4)
                  }
                >
                  <option value={2}>2 spaces</option>
                  <option value={4}>4 spaces</option>
                </select>
              </div>
            </div>
          </div>

          {/* Word Wrap */}
          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <h4>Word Wrap</h4>
              </div>
              <div className="settings-row-control">
                <input
                  type="checkbox"
                  checked={prefs.wordWrap}
                  onChange={(e) => void handleChange("wordWrap", e.target.checked)}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
