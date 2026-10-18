/**
 * McpToggleRow Component
 *
 * Purpose: one labelled on/off row in the Integrations MCP section, in the
 * settings row markup (WI-4.3a): an `h4` title and a `p` description, with a
 * `ToggleSwitch` named by that title through `aria-labelledby` (test matrix
 * D-7), so the control is reachable by role and name.
 *
 * Key decisions:
 * - `disabled` + `describedBy` let the caller point the switch at an inline
 *   reason (rule 30.4) instead of a silent grey control.
 * - `children` render under the description, inside the label column — used by
 *   the server row for its status region.
 *
 * @coordinates-with src/components/common/IntegrationsSettings.tsx — sole caller
 * @coordinates-with src/components/common/ToggleSwitch.tsx — the switch
 * @module components/common/McpToggleRow
 */
import type { ReactNode } from "react";
import { ToggleSwitch } from "./ToggleSwitch";

interface McpToggleRowProps {
  /** DOM id for the row title; must be unique in the dialog. */
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
          <h4 id={labelId}>{label}</h4>
          <p>{description}</p>
          {children}
        </div>
        <div className="settings-row-control">
          <ToggleSwitch
            labelledBy={labelId}
            describedBy={describedBy}
            checked={checked}
            disabled={disabled}
            onChange={onChange}
          />
        </div>
      </div>
    </div>
  );
}
