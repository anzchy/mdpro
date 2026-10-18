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
 *    deferred writer now reads {@link prefsRef}, which is updated synchronously
 *    by every writer, so the payload always carries the user's latest choice.
 *
 * 2. **Payloads are whole-group, never per-leaf.** `merge_preferences` replaces
 *    a top-level group wholesale, and `ExportConfig.html_include_styles` carries
 *    `#[serde(default)] → true`, so a payload of `{ export: { defaultFolder } }`
 *    would resurrect `true` over a user's `false` — the same revert, relocated
 *    into the serde layer where it is far harder to see.
 *
 * 3. **Rollback is field-scoped AND intent-guarded.** A failed write restores
 *    only the leaf that failed. Restoring a whole-group snapshot taken before
 *    the request would also revert a *sibling* the user changed while it was in
 *    flight. Field scoping alone does not cover the failing leaf itself, which
 *    a second writer may have changed in the meantime — that is what
 *    `leafIntents` is for. (The earlier version of this note claimed field
 *    scoping was sufficient on its own; it was wrong, and the same-leaf case it
 *    missed is pinned by WI1-L. Corrected 2026-09-24.)
 *
 * 4. **A failed write never removes the controls**, and reports through the
 *    service's toast rather than an inline note — one signal per event, rule
 *    30 §5. See {@link persistExport}.
 *
 * Pinned by `tests/settings-export-write-ordering.test.tsx` (behaviour) and
 * `tests/settings-export.test.ts` (structure).
 *
 * @module components/common/settings/ExportSettings
 * @coordinates-with src/services/preferencesService.ts, src/services/exportService.ts
 */
import { useEffect, useRef, useState } from "react";
import type { ExportConfig } from "../../../types/preferences";
import { DEFAULT_EXPORT_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { exportService } from "../../../services/exportService";
import { SettingsLoadFailed, SettingsLoading } from "./SettingsPageState";
import { ToggleSwitch } from "../ToggleSwitch";

/**
 * Debounce window for the free-text folder field.
 *
 * A user-visible timing contract, not an implementation detail: it is how long
 * after the last keystroke the value is committed.
 */
const FOLDER_SAVE_DEBOUNCE_MS = 500;

export function ExportSettings() {
  const [prefs, setPrefs] = useState<ExportConfig | null>(null);
  /**
   * Load failure only — a save failure deliberately sets nothing here.
   *
   * This state used to be set on *both* events, and the render used to replace
   * the entire pane with a bare error paragraph, so one transient save failure
   * left the user with no controls, no retry, and no way to clear the message.
   * The controls now stay mounted and operable on a save failure, and the
   * service's toast is that event's single signal (rule 30 §5). See
   * {@link persistExport}. A load failure raises no toast, so the shared
   * failure line is its *sole* signal (WI-4.3b: never the raw message).
   */
  const [loadFailed, setLoadFailed] = useState(false);
  const textSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * The latest export group, readable synchronously.
   *
   * `prefs` cannot serve this purpose: a deferred callback closes over the
   * render in which it was created, so by the time it runs it sees a value that
   * may be several user actions old. Every writer below updates this ref in the
   * same statement it calls `setPrefs`, so the two never disagree.
   */
  const prefsRef = useRef<ExportConfig | null>(null);

  /**
   * Per-leaf monotonic token: "which write most recently claimed this field".
   *
   * Field-scoped rollback rebuilds siblings from the current group, so a
   * *sibling* edit made while a write was in flight already survives (WI1-E′).
   * It does not protect the failing leaf itself, and two writers target
   * `defaultFolder` — {@link handleBrowse} and the debounce — while a switch
   * can be toggled three times with the first write still open. Restoring that
   * leaf's schedule-time value then reverts a newer edit *and*, if a debounce is
   * armed, persists the reverted value, so screen and disk agree on something
   * the user never chose and nothing is left to reconcile them.
   *
   * A write may therefore only roll its leaf back if no later write has claimed
   * it. Same device as `latestThemeIntent` in `src/hooks/useTheme.ts`.
   *
   * Found at review, 2026-09-24; pinned by WI1-L.
   */
  const leafIntents = useRef<Partial<Record<keyof ExportConfig, number>>>({});
  const nextLeafIntent = useRef(0);

  /** Mark `key` as claimed by a new write and return that write's token. */
  const claimLeaf = (key: keyof ExportConfig): number => {
    nextLeafIntent.current += 1;
    leafIntents.current[key] = nextLeafIntent.current;
    return nextLeafIntent.current;
  };

  const commitPrefs = (next: ExportConfig): ExportConfig => {
    prefsRef.current = next;
    setPrefs(next);
    return next;
  };

  useEffect(() => {
    let cancelled = false;
    preferencesService
      .getPreferences("settings_export")
      .then((p) => {
        if (cancelled) return;
        commitPrefs({ ...DEFAULT_EXPORT_CONFIG, ...p.export });
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

  /**
   * Send the whole export group and report the outcome.
   *
   * Whole-group by contract (decision 2 above). Returns whether the write
   * landed, so callers can roll their leaf back.
   */
  const persistExport = async (group: ExportConfig): Promise<boolean> => {
    try {
      await preferencesService.setPreferences({ export: group });
      return true;
    } catch {
      // No inline notice here, deliberately. `preferencesService` already raises
      // the one toast for this event, and rule 30 §5 allows a single event
      // exactly one of toast / banner / inline note / modal — never two. The
      // toast is also the only signal that still reaches the user when this
      // write was dispatched and the dialog closed before it rejected; an
      // inline note would be a no-op on an unmounted panel.
      //
      // The defect this replaced was the pane being *destroyed* on failure, not
      // the absence of an inline message: the controls below stay mounted,
      // operable, and holding the user's value. `loadFailed` remains load-failure
      // only, where no toast is raised and it is therefore the sole signal.
      return false;
    }
  };

  /**
   * Restore a single leaf after its write failed.
   *
   * Field-scoped on purpose: it rebuilds from the *current* group, so a value
   * the user changed in a **sibling** field while the failing request was in
   * flight survives. The failing field itself needs {@link leafIntents} — this
   * rebuild would otherwise stamp a schedule-time value over a newer edit to
   * that same field.
   */
  const rollbackLeaf = (
    key: keyof ExportConfig,
    value: ExportConfig[keyof ExportConfig],
    intent: number,
  ): void => {
    // A later write has claimed this leaf. Its value — whether already landed
    // or still pending — is newer than ours, so ours is not the one to restore.
    if (leafIntents.current[key] !== intent) return;
    const latest = prefsRef.current;
    if (latest === null) return;
    const prev = { ...latest, [key]: value };
    prefsRef.current = prev;
    setPrefs(prev);
  };

  /** Switch toggle — immediate async save with rollback. */
  const handleBoolChange = async (key: keyof ExportConfig, value: boolean) => {
    const current = prefsRef.current;
    if (!current) return;
    const previousValue = current[key];
    const intent = claimLeaf(key);
    const next = commitPrefs({ ...current, [key]: value });
    const saved = await persistExport(next);
    if (!saved) rollbackLeaf(key, previousValue, intent);
  };

  /** Text input — debounced save; the callback reads state at fire time. */
  const handleFolderChange = (value: string) => {
    const current = prefsRef.current;
    if (!current) return;
    // Every keystroke claims the leaf, so a write already in flight against it
    // can no longer roll the user's typing back (WI1-L).
    claimLeaf("defaultFolder");
    commitPrefs({ ...current, defaultFolder: value });
    if (textSaveTimer.current) clearTimeout(textSaveTimer.current);
    textSaveTimer.current = setTimeout(() => {
      textSaveTimer.current = null;
      const latest = prefsRef.current;
      if (latest === null) return;
      void persistExport(latest);
    }, FOLDER_SAVE_DEBOUNCE_MS);
  };

  const handleBrowse = async () => {
    const folder = await exportService.pickFolder();
    if (folder === null) return;
    // Read AFTER the await. The picker owns the screen for an unbounded time,
    // and anything the user changed in the meantime lives in the ref — not in
    // the closure this function started with.
    const current = prefsRef.current;
    if (!current) return;
    const previousFolder = current.defaultFolder;
    const intent = claimLeaf("defaultFolder");
    const next = commitPrefs({ ...current, defaultFolder: folder });
    const saved = await persistExport(next);
    if (!saved) rollbackLeaf("defaultFolder", previousFolder, intent);
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
