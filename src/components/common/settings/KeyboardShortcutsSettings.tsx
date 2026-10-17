/**
 * Purpose: Settings › Keyboard Shortcuts. Every command-table entry in its
 * D14 group with its capability (plan § 6 M7; DESIGN.md "Native menu bar
 * and Keyboard Shortcuts page"), the recorder, and Save / Discard / Reset.
 *
 * Pipeline: get_preferences (saved) + get_applied_shortcuts (the run's
 * snapshot) → shortcutSections → rowStateOf per row → ShortcutRow. Save is
 * refused while findSettingsConflicts reports any conflict (M1A-WI-10).
 *
 * Key decisions:
 * - Pending rows compare saved with applied, never the unsaved edit
 *   (ADR-0114 Decision 4). A missing snapshot only hides that line.
 * - Reset restores the table's defaults for the stored version.
 *
 * @coordinates-with src/components/common/settings/shortcuts/shortcutGroups.ts — groups and labels
 * @coordinates-with src/components/common/settings/shortcuts/rowState.ts — the row states
 * @coordinates-with src/commands/settingsConflicts.ts — the Save check
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import type { KeyboardShortcuts } from "../../../types/preferences";
import type { AppliedShortcuts } from "../../../types/keyboardShortcuts";
import { preferencesService } from "../../../services/preferencesService";
import { loggingService } from "../../../services/loggingService";
import { isMacPlatform, recordedShortcut } from "../../../utils/platformLabels";
import { findSettingsConflicts, settingsConflictLines, settingsPlatform } from "../../../commands/settingsConflicts";
import { FIELD_LABELS, shortcutSections } from "./shortcuts/shortcutGroups";
import { resetDefaults } from "./shortcuts/resetDefaults";
import { rowStateOf } from "./shortcuts/rowState";
import { ShortcutRow } from "./shortcuts/ShortcutRow";

/** What a key button shows while the recorder waits for a chord. */
const RECORDING_PROMPT = "Press keys...";

interface KeyboardShortcutsSettingsProps {
  onClose: () => void;
}

export function KeyboardShortcutsSettings({ onClose }: KeyboardShortcutsSettingsProps) {
  const [savedShortcuts, setSavedShortcuts] = useState<KeyboardShortcuts | null>(null);
  const [localShortcuts, setLocalShortcuts] = useState<KeyboardShortcuts | null>(null);
  const [editingKey, setEditingKey] = useState<keyof KeyboardShortcuts | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [version, setVersion] = useState(1);
  const [applied, setApplied] = useState<AppliedShortcuts["bindings"] | null>(null);

  useEffect(() => {
    let cancelled = false;
    preferencesService
      .getPreferences("settings_shortcuts")
      .then((p) => {
        if (cancelled) return;
        const merged = { ...resetDefaults(settingsPlatform(), p.keyboardShortcutsVersion), ...p.keyboardShortcuts };
        setSavedShortcuts(merged);
        setLocalShortcuts(merged);
        setVersion(p.keyboardShortcutsVersion);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : "Failed to load shortcuts");
      });
    // The run's applied snapshot, for pending rows. Without one the rows
    // show no pending line; the page still edits and saves.
    Promise.resolve()
      .then(() => preferencesService.getAppliedShortcuts())
      .then((a) => {
        if (!cancelled && a?.bindings) setApplied(a.bindings);
      })
      .catch(() => {
        loggingService.logUiEvent("ui.settings.shortcuts.applied", { status: "fail" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Save-refusing conflicts by field, plus hidden-only notices (M1A-WI-10). */
  const found = useMemo(
    () => findSettingsConflicts(settingsPlatform(), version, localShortcuts ?? {}, FIELD_LABELS),
    [localShortcuts, version],
  );
  const conflicts = found.refusing;
  const lines = settingsConflictLines(found, settingsPlatform());

  const handleKeyCapture = useCallback(
    (event: KeyboardEvent) => {
      if (!editingKey) return;

      event.preventDefault();
      event.stopPropagation();

      // Escape cancels the current edit without recording a shortcut.
      if (event.key === "Escape") {
        setEditingKey(null);
        return;
      }

      // Lone modifiers, dead keys, bare keys and (off-Mac) the Windows key
      // keep the recorder waiting.
      const shortcut = recordedShortcut(event, isMacPlatform());
      if (shortcut === null) return;

      setLocalShortcuts((prev) => (prev ? { ...prev, [editingKey]: shortcut } : prev));
      setIsDirty(true);
      setEditingKey(null);
    },
    [editingKey],
  );

  // Capture phase: the recorder sees the key before `useKeyboardShortcuts`'
  // bubble-phase window listener, and its stopPropagation keeps the chord
  // being recorded from also running its command (D190-WI-7, audit b100).
  useEffect(() => {
    if (editingKey) {
      window.addEventListener("keydown", handleKeyCapture, true);
      return () => window.removeEventListener("keydown", handleKeyCapture, true);
    }
  }, [editingKey, handleKeyCapture]);

  const handleReset = () => {
    loggingService.logButtonClick("settings.shortcuts.reset");
    setLocalShortcuts(resetDefaults(settingsPlatform(), version));
    setIsDirty(true);
  };

  const handleDiscard = () => {
    setLocalShortcuts(savedShortcuts);
    setIsDirty(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!localShortcuts) return;
    loggingService.logButtonClick("settings.shortcuts.save");
    if (conflicts.size > 0) {
      const counts = { refusing: conflicts.size, notices: found.notices.length };
      loggingService.logUiEvent("ui.settings.shortcuts.save", { status: "refused", ...counts });
      return;
    }
    if (found.notices.length > 0) {
      const fields = found.notices.flatMap((n) => n.fields);
      loggingService.logUiEvent("ui.settings.shortcut_conflict_hidden", { notices: found.notices.length, fields });
    }
    setSaveError(null);
    try {
      await preferencesService.setPreferences({ keyboardShortcuts: localShortcuts });
      setSavedShortcuts(localShortcuts);
      setIsDirty(false);
      onClose();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to save shortcuts");
      loggingService.logUiEvent("ui.settings.shortcuts.save", { status: "fail" });
    }
  };

  const startEditing = (field: keyof KeyboardShortcuts) => {
    loggingService.logButtonClick(`settings.shortcuts.edit.${String(field)}`);
    setEditingKey(field);
  };

  if (loadError) {
    return (
      <div className="shortcuts-layout">
        <p className="settings-error">{loadError}</p>
      </div>
    );
  }

  if (!localShortcuts) {
    return (
      <div className="shortcuts-layout">
        <p style={{ color: "var(--color-muted)" }}>Loading shortcuts…</p>
      </div>
    );
  }

  const platform = settingsPlatform();
  return (
    <div className="shortcuts-layout">
      <div className="shortcuts-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h3>Keyboard Shortcuts</h3>
            <p>Customize shortcuts across the app.</p>
          </div>
          <button className="toolbar-button" onClick={handleReset}>
            Reset to Defaults
          </button>
        </div>
      </div>

      {saveError && <p className="settings-error">{saveError}</p>}

      {isDirty && (
        <div className="settings-dirty-banner" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>Unsaved shortcut changes</span>
          <button className="settings-dirty-banner__discard" onClick={handleDiscard}>
            Discard
          </button>
          <button
            className="toolbar-button primary"
            style={{ marginLeft: "auto" }}
            onClick={() => void handleSave()}
          >
            Save
          </button>
        </div>
      )}

      {conflicts.size > 0 && (
        <div className="settings-error" role="alert">
          Conflicting shortcuts detected — Save is blocked until they are resolved.
          {lines.alerts.map((line) => <div key={line}>{line}</div>)}
        </div>
      )}
      {lines.notices.length > 0 && (
        <p className="settings-form-hint" role="status">{lines.notices.join(" · ")}</p>
      )}

      {shortcutSections(platform, version).map((section) => (
        <section key={section.name} className="shortcuts-section">
          <h4>{section.name}</h4>
          <div className="shortcuts-list">
            {section.entries.map(({ row, label }) => {
              const input = { row, platform, version, local: localShortcuts, saved: savedShortcuts ?? localShortcuts };
              const state = rowStateOf({ ...input, applied, conflicts });
              if (state === null) return null;
              return (
                <ShortcutRow
                  key={row.id}
                  label={label}
                  field={row.prefField}
                  state={state}
                  isMac={isMacPlatform()}
                  editing={row.prefField !== undefined && editingKey === row.prefField}
                  recordingPrompt={RECORDING_PROMPT}
                  onEdit={startEditing}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
