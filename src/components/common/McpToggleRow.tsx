/**
 * McpToggleRow Component
 *
 * Purpose: one labelled on/off row in the Integrations MCP section. The visible
 * `<strong>` label is the checkbox's accessible name via `aria-labelledby`
 * (test matrix D-7), so the control is reachable by role and name.
 *
 * Key decisions:
 * - `disabled` + `describedBy` let the caller point the checkbox at an inline
 *   reason (rule 30.4) instead of a silent grey control.
 * - `children` render under the description, inside the label column — used by
 *   the server row for its status region.
 *
 * @coordinates-with src/components/common/IntegrationsSettings.tsx — sole caller
 * @module components/common/McpToggleRow
 */
import type { ReactNode } from "react";

interface McpToggleRowProps {
  /** DOM id for the label; must be unique in the dialog. */
  labelId: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  /** id of an element explaining why the control is disabled. */
  describedBy?: string;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}

export function McpToggleRow({
  labelId,
  label,
  description,
  checked,
  disabled = false,
  describedBy,
  onChange,
  children,
}: McpToggleRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row-content">
        <div className="settings-row-label">
          <strong id={labelId}>{label}</strong>
          <span className="settings-row-description">{description}</span>
          {children}
        </div>
        <div className="settings-row-control">
          <label className="toggle-switch">
            <input
              type="checkbox"
              aria-labelledby={labelId}
              aria-describedby={describedBy}
              checked={checked}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>
    </div>
  );
}
