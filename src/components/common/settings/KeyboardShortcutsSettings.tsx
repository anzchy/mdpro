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
 * - One save at a time: Save reads "Saving…" and is disabled, with Discard,
 *   while a save runs. A save that lands after a newer edit keeps the dialog
 *   open and the banner up, so that edit is not closed away (PR #508 F508-3).
 *   A save that lands after this page was closed touches nothing: `onClose`
 *   would close the dialog the user has since reopened.
 *
 * @coordinates-with src/components/common/settings/shortcuts/shortcutGroups.ts — groups and labels
 * @coordinates-with src/components/common/settings/shortcuts/rowState.ts — the row states
 * @coordinates-with src/commands/settingsConflicts.ts — the Save check
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { SettingsLoadFailed, SettingsLoading } from "./SettingsPageState";

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
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  /** Counts local edits, so a finished save knows whether one came after it started. */
  const editCount = useRef(0);
  /** False once this instance unmounts; a late save must not close a reopened dialog. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [loadFailed, setLoadFailed] = useState(false);
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
      .catch(() => {
        // The service has logged the failure (enum-only); the raw message stays out of the UI.
        if (!cancelled) setLoadFailed(true);
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

  /** Save-refusing conflicts by field (M1A-WI-10). */
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
      editCount.current += 1;
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
    editCount.current += 1;
    setIsDirty(true);
  };

  const handleDiscard = () => {
    setLocalShortcuts(savedShortcuts);
    editCount.current += 1;
    setIsDirty(false);
  };

  const handleSave = async () => {
    if (!localShortcuts) return;
    loggingService.logButtonClick("settings.shortcuts.save");
    if (conflicts.size > 0) {
      loggingService.logUiEvent("ui.settings.shortcuts.save", { status: "refused", refusing: conflicts.size });
      return;
    }
    if (savingRef.current) return;
    const snapshot = localShortcuts;
    const editsAtStart = editCount.current;
    savingRef.current = true;
    setSaving(true);
    try {
      await preferencesService.setPreferences({ keyboardShortcuts: snapshot });
      if (!alive.current) return;
      if (applied && savedShortcuts && Object.entries(applied).some(([field, binding]) =>
        binding.state === "suppressed" &&
        snapshot[field as keyof KeyboardShortcuts] !== savedShortcuts[field as keyof KeyboardShortcuts])) {
        loggingService.logUiEvent("ui.shortcut-conflict.repaired", { status: "success" });
      }
      setSavedShortcuts(snapshot);
      // An edit made while saving is not in this save: keep it, the banner and the dialog.
      if (editCount.current === editsAtStart) {
        setIsDirty(false);
        onClose();
      }
    } catch {
      // The service's toast is the one signal (rule 30 rule 5); the banner stays,
      // so the edit can be saved again or discarded.
      loggingService.logUiEvent("ui.settings.shortcuts.save", { status: "fail" });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const startEditing = (field: keyof KeyboardShortcuts) => {
    loggingService.logButtonClick(`settings.shortcuts.edit.${String(field)}`);
    setEditingKey(field);
  };

  if (loadFailed) {
    return (
      <div className="shortcuts-layout">
        <SettingsLoadFailed />
      </div>
    );
  }

  if (!localShortcuts) {
    return (
      <div className="shortcuts-layout">
        <SettingsLoading />
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

      {isDirty && (
        <div className="settings-dirty-banner" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>Unsaved shortcut changes</span>
          <button className="settings-dirty-banner__discard" onClick={handleDiscard} disabled={saving}>
            Discard
          </button>
          <button
            className="toolbar-button primary"
            style={{ marginLeft: "auto" }}
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {conflicts.size > 0 && (
        <div className="settings-error" role="alert">
          Conflicting shortcuts detected — Save is blocked until they are resolved.
          {lines.alerts.map((line) => <div key={line}>{line}</div>)}
        </div>
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
