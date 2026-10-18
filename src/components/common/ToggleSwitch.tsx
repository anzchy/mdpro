/**
 * ToggleSwitch Component
 *
 * Purpose: the one on/off control every boolean setting uses (E4, WI-4.3a). A
 * visually hidden checkbox with `role="switch"` and `aria-checked`, followed by
 * the `.toggle-slider` track it draws.
 *
 * Key decisions:
 * - No label text of its own: the accessible name comes from the row's visible
 *   `h4` through `aria-labelledby`, so the name is always the row title.
 * - A native checkbox underneath, so click and Space toggle it and a disabled
 *   switch ignores both without extra handlers.
 * - The input sits right before `.toggle-slider`, which the keyboard focus ring
 *   (`.toggle-switch input:focus-visible + .toggle-slider`, rule 33) relies on.
 *
 * @coordinates-with src/styles/sections/settings-rows.css — `.toggle-switch` and its ring
 * @module components/common/ToggleSwitch
 */

interface ToggleSwitchProps {
  /** id of the visible row title that names the switch. */
  labelledBy: string;
  /** id of an element explaining why the switch is disabled. */
  describedBy?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
}

export function ToggleSwitch({ labelledBy, describedBy, checked, disabled = false, onChange, id }: ToggleSwitchProps) {
  return (
    <label className="toggle-switch">
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-slider" />
    </label>
  );
}
