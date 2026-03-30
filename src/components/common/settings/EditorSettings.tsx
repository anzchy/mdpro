import { useEffect, useRef, useState } from "react";
import type { UserPreferences, EditorConfig, ContentWidth } from "../../../types/preferences";
import { DEFAULT_EDITOR_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { applyEditorPref } from "./editorPrefApply";
import { SettingsStepper } from "./SettingsStepper";

export function EditorSettings() {
  const cachedFullPrefs = useRef<UserPreferences | null>(null);
  const [prefs, setPrefs] = useState<EditorConfig | null>(null);

  useEffect(() => {
    void preferencesService.getPreferences().then((p) => {
      cachedFullPrefs.current = p;
      setPrefs({ ...DEFAULT_EDITOR_CONFIG, ...p.editor });
    });
  }, []);

  const handleChange = (
    key: keyof EditorConfig,
    value: EditorConfig[keyof EditorConfig],
  ) => {
    if (!prefs || !cachedFullPrefs.current) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    applyEditorPref(key, value);
    cachedFullPrefs.current = { ...cachedFullPrefs.current, editor: next };
    void preferencesService.setPreferences(cachedFullPrefs.current);
  };

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
                    handleChange(
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
                  onChange={(v) => handleChange("fontSize", v)}
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
                    handleChange("lineHeightX10", Number(e.target.value))
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
                    handleChange("contentWidth", e.target.value as ContentWidth)
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
                    handleChange("tabSize", Number(e.target.value) as 2 | 4)
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
                  onChange={(e) => handleChange("wordWrap", e.target.checked)}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
