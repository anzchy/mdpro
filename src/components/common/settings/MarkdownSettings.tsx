import { useEffect, useState } from "react";
import type { MarkdownConfig } from "../../../types/preferences";
import { DEFAULT_MARKDOWN_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { applyAutoPair } from "./editorPrefApply";
import { ToggleSwitch } from "../ToggleSwitch";

export function MarkdownSettings() {
  const [prefs, setPrefs] = useState<MarkdownConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    preferencesService
      .getPreferences("settings_markdown")
      .then((p) => {
        if (cancelled) return;
        setPrefs({ ...DEFAULT_MARKDOWN_CONFIG, ...p.markdown });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load settings");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = async (key: keyof MarkdownConfig, value: boolean) => {
    if (!prefs) return;
    const prev = { ...prefs };
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    if (key === "autoPair") applyAutoPair(value);
    try {
      await preferencesService.setPreferences({ markdown: next });
    } catch {
      // Rollback UI and editor state on save failure.
      setPrefs(prev);
      if (key === "autoPair") applyAutoPair(prev.autoPair);
    }
  };

  if (error) {
    return (
      <div>
        <div className="settings-page-header">
          <h3 className="settings-page-title">Markdown</h3>
        </div>
        <p className="settings-error">{error}</p>
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
        <div aria-busy="true" style={{ opacity: 0.5 }}>
          Loading…
        </div>
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
