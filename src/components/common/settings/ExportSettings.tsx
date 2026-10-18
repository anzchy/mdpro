/**
 * Purpose: the Export page of the settings dialog — default export folder and
 * "include styles in HTML export" — and the write-ordering contract that keeps
 * the two from overwriting each other.
 *
 * Pipeline: `get_preferences` → local `ExportConfig` state → one whole-group
 * `set_preferences` payload per user action (the text field debounced, the
 * switch and the folder picker immediate).
 *
 * Key decisions:
 *
 * 1. **Deferred writers read state at fire time, never at schedule time.** The
 *    panel has three writers and two of them are deferred: the 500 ms debounce
 *    on the text field, and `handleBrowse` across its `await`. Both used to
 *    capture the whole export group when they were *scheduled* and send that
 *    snapshot later, so toggling the checkbox inside the debounce window sent
 *    the new value and was then silently reverted by the stale timer. Every
 *    deferred writer now reads the shown value through `writer.current()` when
 *    it fires, and the write itself is built when it is *sent*, from the last
 *    confirmed group plus its own leaf (`useSettingsWriter`, WI-4.3b F508-2).
 *
 * 2. **Payloads are whole-group, never per-leaf.** `merge_preferences` replaces
 *    a top-level group wholesale, and `ExportConfig.html_include_styles` carries
 *    `#[serde(default)] → true`, so a payload of `{ export: { defaultFolder } }`
 *    would resurrect `true` over a user's `false` — the same revert, relocated
 *    into the serde layer where it is far harder to see.
 *
 * 3. **Rollback is field-scoped AND intent-guarded, to the confirmed value.** A
 *    failed write restores only the leaf that failed, so a *sibling* the user
 *    changed while it was in flight survives (WI1-E′), and only while no later
 *    edit has claimed that leaf (WI1-L). It restores the value the backend last
 *    confirmed, not the value shown before the request, which may itself have
 *    been an unsaved optimistic one (PR #508 F508-2). Writes go one at a time.
 *    All of this lives in `useSettingsWriter`.
 *
 * 4. **A failed write never removes the controls**, and reports through the
 *    service's toast rather than an inline note — one signal per event, rule
 *    30 §5.
 *
 * Pinned by `tests/settings-export-write-ordering.test.tsx` (behaviour) and
 * `tests/settings-export.test.ts` (structure).
 *
 * @module components/common/settings/ExportSettings
 * @coordinates-with src/services/preferencesService.ts, src/services/exportService.ts
 * @coordinates-with src/components/common/settings/useSettingsWriter.ts
 */
import { useEffect, useRef, useState } from "react";
import type { ExportConfig } from "../../../types/preferences";
import { DEFAULT_EXPORT_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { exportService } from "../../../services/exportService";
import { SettingsLoadFailed, SettingsLoading } from "./SettingsPageState";
import { useSettingsWriter } from "./useSettingsWriter";
import { ToggleSwitch } from "../ToggleSwitch";

/**
 * Debounce window for the free-text folder field.
 *
 * A user-visible timing contract, not an implementation detail: it is how long
 * after the last keystroke the value is committed.
 */
const FOLDER_SAVE_DEBOUNCE_MS = 500;

export function ExportSettings() {
  /**
   * Load failure only — a save failure deliberately sets nothing here.
   *
   * This state used to be set on *both* events, and the render used to replace
   * the entire pane with a bare error paragraph, so one transient save failure
   * left the user with no controls, no retry, and no way to clear the message.
   * The controls now stay mounted and operable on a save failure, and the
   * service's toast is that event's single signal (rule 30 §5). A load failure raises no toast, so the shared
   * failure line is its *sole* signal (WI-4.3b: never the raw message).
   */
  const [loadFailed, setLoadFailed] = useState(false);
  const textSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Whole-group writes, one at a time (decisions 1–3). No inline notice on
   * failure, deliberately: `preferencesService` raises the one toast for the
   * event (rule 30 §5), and it is the only signal that still reaches the user
   * when the dialog closed before the write rejected.
   */
  const writer = useSettingsWriter<ExportConfig>({
    save: (next) => preferencesService.setPreferences({ export: next }),
  });
  const prefs = writer.value;

  useEffect(() => {
    let cancelled = false;
    preferencesService
      .getPreferences("settings_export")
      .then((p) => {
        if (cancelled) return;
        writer.load({ ...DEFAULT_EXPORT_CONFIG, ...p.export });
      })
      .catch(() => {
        // The service has logged the failure (enum-only); the raw message stays out of the UI.
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
      /*
       * Unmount DISCARDS the pending debounced write; it does not flush it.
       *
       * The two are indistinguishable from the outside, so the intent is stated
       * rather than left to be inferred: this dialog's posture is "no write the
       * user cannot see the result of". Closing the settings dialog mid-keystroke
       * abandons the keystroke, the same way navigating away from an unsaved form
       * does — it does not silently commit it after the surface is gone, where a
       * failure would have nowhere to be reported.
       */
      if (textSaveTimer.current !== null) {
        clearTimeout(textSaveTimer.current);
        textSaveTimer.current = null;
      }
    };
  }, []);

  /** Switch toggle — saved after any earlier write; rolls back only this leaf. */
  const handleBoolChange = (key: keyof ExportConfig, value: boolean) => {
    void writer.write({ [key]: value });
  };

  /** Text input — debounced save; the callback reads the shown value at fire time. */
  const handleFolderChange = (value: string) => {
    if (writer.current() === null) return;
    // Every keystroke claims the leaf, so a write already in flight against it
    // can no longer roll the user's typing back (WI1-L).
    writer.edit({ defaultFolder: value });
    if (textSaveTimer.current) clearTimeout(textSaveTimer.current);
    textSaveTimer.current = setTimeout(() => {
      textSaveTimer.current = null;
      const latest = writer.current();
      if (latest === null) return;
      // No rollback: a failed save keeps the typed folder shown (WI1-J); the toast says it failed.
      void writer.write({ defaultFolder: latest.defaultFolder }, { rollback: false });
    }, FOLDER_SAVE_DEBOUNCE_MS);
  };

  const handleBrowse = async () => {
    const folder = await exportService.pickFolder();
    if (folder === null) return;
    // The picker owns the screen for an unbounded time; the write is built when
    // it is sent, so anything changed meanwhile is not overwritten.
    if (writer.current() === null) return;
    void writer.write({ defaultFolder: folder });
  };

  return (
    <div>
      <div className="settings-page-header">
        <h3 className="settings-page-title">Export</h3>
        <p className="settings-page-desc">HTML export output settings.</p>
      </div>

      {prefs === null && (loadFailed ? <SettingsLoadFailed /> : <SettingsLoading />)}

      {prefs !== null && (
        <>
          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <h4 id="export-default-folder-label">Default Export Folder</h4>
                <p>Where exported HTML files are saved by default. Leave empty to prompt each time.</p>
              </div>
              <div className="settings-row-control">
                <input
                  id="export-default-folder"
                  aria-labelledby="export-default-folder-label"
                  type="text"
                  className="settings-input"
                  value={prefs.defaultFolder}
                  onChange={(e) => handleFolderChange(e.target.value)}
                  placeholder="(prompt on export)"
                />
                <button className="toolbar-button" type="button" onClick={() => void handleBrowse()}>
                  Browse…
                </button>
              </div>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <h4 id="export-include-styles-label">Include Styles in HTML Export</h4>
                <p>Embed CSS styles directly in the exported HTML file.</p>
              </div>
              <div className="settings-row-control">
                <ToggleSwitch
                  id="export-include-styles"
                  labelledBy="export-include-styles-label"
                  checked={prefs.htmlIncludeStyles}
                  onChange={(v) => void handleBoolChange("htmlIncludeStyles", v)}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
