import { useEffect, useState } from "react";
import type { MarkdownConfig } from "../../../types/preferences";
import { DEFAULT_MARKDOWN_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { SettingsLoadFailed, SettingsLoading } from "./SettingsPageState";
import { applyAutoPair } from "./editorPrefApply";
import { useSettingsWriter } from "./useSettingsWriter";
import { ToggleSwitch } from "../ToggleSwitch";

export function MarkdownSettings() {
  // One write at a time; a failed write returns to the last confirmed value (F508-2).
  const writer = useSettingsWriter<MarkdownConfig>({
    save: (next) => preferencesService.setPreferences({ markdown: next }),
    apply: (key, value) => {
      if (key === "autoPair") applyAutoPair(value as boolean);
    },
  });
  const prefs = writer.value;
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    preferencesService
      .getPreferences("settings_markdown")
      .then((p) => {
        if (cancelled) return;
        writer.load({ ...DEFAULT_MARKDOWN_CONFIG, ...p.markdown });
      })
      .catch(() => {
        // The service has logged the failure (enum-only); the raw message stays out of the UI.
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = (key: keyof MarkdownConfig, value: boolean) => {
    void writer.write({ [key]: value });
  };

  if (loadFailed) {
    return (
      <div>
        <div className="settings-page-header">
          <h3 className="settings-page-title">Markdown</h3>
        </div>
        <SettingsLoadFailed />
      </div>
    );
  }

  return (
    <div>
      <div className="settings-page-header">
        <h3 className="settings-page-title">Markdown</h3>
        <p className="settings-page-desc">Editing behavior in source mode.</p>
      </div>

      {!prefs ? (
        <SettingsLoading />
      ) : (
        <>
          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <h4 id="md-auto-pair-label">Auto-pair Brackets &amp; Quotes</h4>
                <p>Automatically close brackets, parentheses, and quotes.</p>
              </div>
              <div className="settings-row-control">
                <ToggleSwitch
                  id="md-auto-pair"
                  labelledBy="md-auto-pair-label"
                  checked={prefs.autoPair}
                  onChange={(v) => {
                    void handleChange("autoPair", v);
                  }}
                />
              </div>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <h4 id="md-auto-reformat-tables-label">Auto-Reformat Tables on Save</h4>
                <p>
                  Pretty-print GFM tables (column-aligned pipes) every
                  time the document is saved. Off by default — produces
                  noisy diffs in version-controlled files.
                </p>
              </div>
              <div className="settings-row-control">
                <ToggleSwitch
                  id="md-auto-reformat-tables"
                  labelledBy="md-auto-reformat-tables-label"
                  checked={prefs.autoReformatTablesOnSave}
                  onChange={(v) => {
                    void handleChange("autoReformatTablesOnSave", v);
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
