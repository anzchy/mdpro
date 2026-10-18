import { useEffect, useState } from "react";
import type { EditorConfig, ContentWidth } from "../../../types/preferences";
import { DEFAULT_EDITOR_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { SettingsLoadFailed, SettingsLoading } from "./SettingsPageState";
import { applyEditorPref } from "./editorPrefApply";
import { useSettingsWriter } from "./useSettingsWriter";
import { SettingsStepper, type StepperBound } from "./SettingsStepper";
import { ToggleSwitch } from "../ToggleSwitch";

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 24;
const FONT_SIZE_REASON_ID = "editor-font-size-reason";
/** Why − or + is disabled (copy chosen by the user, 2026-10-18). */
const FONT_SIZE_REASON: Record<Exclude<StepperBound, null>, string> = {
  min: `Smallest size is ${FONT_SIZE_MIN}px`,
  max: `Largest size is ${FONT_SIZE_MAX}px`,
};

export function EditorSettings() {
  const [fontSizeBound, setFontSizeBound] = useState<StepperBound>(null);
  // One write at a time; a failed write returns to the last confirmed value (F508-2).
  const writer = useSettingsWriter<EditorConfig>({
    group: "editor",
    save: (next) => preferencesService.setPreferences({ editor: next }),
    apply: (key, value) => applyEditorPref(key, value),
  });
  const prefs = writer.value;
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let mounted = true;
    preferencesService.getPreferences("settings_editor").then((p) => {
      if (!mounted) return;
      writer.load({ ...DEFAULT_EDITOR_CONFIG, ...p.editor });
    }).catch(() => {
      if (!mounted) return;
      setLoadError(true);
    });
    return () => { mounted = false; };
  }, []);

  const handleChange = (key: keyof EditorConfig, value: EditorConfig[keyof EditorConfig]) => {
    void writer.write({ [key]: value });
  };

  if (loadError) {
    return (
      <div>
        <div className="settings-page-header">
          <h3 className="settings-page-title">Editor</h3>
        </div>
        <SettingsLoadFailed />
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
        <SettingsLoading />
      ) : (
        <>
          <div className="settings-section-label">TYPOGRAPHY</div>

          {/* Font Family */}
          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <h4 id="editor-font-family-label">Font Family</h4>
              </div>
              <div className="settings-row-control">
                <select
                  aria-labelledby="editor-font-family-label"
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
                <h4 id="editor-font-size-label">Font Size</h4>
                {fontSizeBound && <p id={FONT_SIZE_REASON_ID}>{FONT_SIZE_REASON[fontSizeBound]}</p>}
              </div>
              <div className="settings-row-control">
                <SettingsStepper
                  labelledBy="editor-font-size-label"
                  value={prefs.fontSize}
                  min={FONT_SIZE_MIN}
                  max={FONT_SIZE_MAX}
                  reasonId={FONT_SIZE_REASON_ID}
                  onBoundChange={setFontSizeBound}
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
                <h4 id="editor-line-height-label">Line Height</h4>
              </div>
              <div className="settings-row-control">
                <select
                  aria-labelledby="editor-line-height-label"
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
                <h4 id="editor-content-width-label">Content Width</h4>
              </div>
              <div className="settings-row-control">
                <select
                  aria-labelledby="editor-content-width-label"
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
                <h4 id="editor-tab-size-label">Tab Size</h4>
              </div>
              <div className="settings-row-control">
                <select
                  aria-labelledby="editor-tab-size-label"
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
                <h4 id="editor-word-wrap-label">Word Wrap</h4>
              </div>
              <div className="settings-row-control">
                <ToggleSwitch
                  labelledBy="editor-word-wrap-label"
                  checked={prefs.wordWrap}
                  onChange={(v) => void handleChange("wordWrap", v)}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
