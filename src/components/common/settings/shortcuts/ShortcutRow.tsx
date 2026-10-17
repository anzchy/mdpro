/**
 * Purpose: one row of Settings › Keyboard Shortcuts, drawn from its
 * `RowState` as DESIGN.md's "Native menu bar and Keyboard Shortcuts page"
 * block specifies: a key button for a configurable row, a non-editable
 * dashed box for fixed and system keys (and fixed second keys), and muted
 * "Not available" text with no button for an unavailable one.
 *
 * Key decisions:
 * - The dashed boxes are spans, not buttons, and take no focus (rule 33).
 * - Values are shown through `displayedShortcut` (configurable) or
 *   `shortcutLabel` (fixed); the two states read "Not set" and "System".
 *
 * @coordinates-with src/components/common/settings/shortcuts/rowState.ts — the state
 * @coordinates-with src/styles/sections/settings-shell.css — the row styles
 */
import type { BindingField } from "../../../../commands/bindingConflicts.types";
import { SYSTEM_BINDING, UNASSIGNED_BINDING } from "../../../../types/keyboardShortcuts";
import { displayedShortcut, shortcutLabel } from "../../../../utils/platformLabels";
import type { RowState } from "./rowState";

interface ShortcutRowProps {
  readonly label: string;
  readonly field: BindingField | undefined;
  readonly state: RowState;
  readonly isMac: boolean;
  readonly editing: boolean;
  /** Shown on the key button while the recorder waits. */
  readonly recordingPrompt: string;
  readonly onEdit: (field: BindingField) => void;
}

function keyText(field: BindingField | undefined, stored: string, isMac: boolean): string {
  if (stored === UNASSIGNED_BINDING) return "Not set";
  if (stored === SYSTEM_BINDING) return "System";
  return field === undefined ? shortcutLabel(stored, isMac) : displayedShortcut(field, stored, isMac);
}

function Secondaries({ keys, isMac }: { readonly keys: readonly string[]; readonly isMac: boolean }) {
  return keys.map((k) => (
    <span key={k} className="shortcut-fixed is-second">
      {shortcutLabel(k, isMac)}
    </span>
  ));
}

export function ShortcutRow({ label, field, state, isMac, editing, recordingPrompt, onEdit }: ShortcutRowProps) {
  const unavailable = state.kind === "unavailable";
  const configurable = state.kind === "configurable" ? state : null;
  const classes = ["shortcut-row"];
  if (unavailable) classes.push("is-unavailable");
  if (configurable?.conflict) classes.push("has-conflict");
  const pending = configurable?.pending ?? null;

  return (
    <div className={classes.join(" ")}>
      <div className="shortcut-name">
        <span className="shortcut-label">{label}</span>
        {configurable?.capability && <span className="shortcut-capability">{configurable.capability}</span>}
        {pending && (
          <span className="shortcut-pending">
            {`Active: ${keyText(field, pending.active, isMac)} · after restart: ${keyText(field, pending.afterRestart, isMac)}`}
          </span>
        )}
      </div>
      <div className="shortcut-keys">
        {state.kind === "unavailable" && <span className="shortcut-status">Not available</span>}
        {state.kind === "fixed" && <span className="shortcut-fixed">{shortcutLabel(state.key, isMac)}</span>}
        {state.kind === "system" && <span className="shortcut-fixed">System</span>}
        {configurable && field !== undefined && (
          <button className={`shortcut-value${editing ? " is-editing" : ""}`} onClick={() => onEdit(field)}>
            {editing ? recordingPrompt : keyText(field, configurable.value, isMac)}
          </button>
        )}
        {state.kind !== "unavailable" && <Secondaries keys={state.secondaries} isMac={isMac} />}
      </div>
    </div>
  );
}
