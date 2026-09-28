/**
 * McpServerStatus Component
 *
 * Purpose: the one `role="status"` region under the "Enable MCP Server" toggle —
 * a phase badge and at most one inline note (rule 30.5). Presentational only;
 * the decision of what to show lives in `mcpStatusView`.
 *
 * Pipeline: IntegrationsSettings holds the latest `McpStatus` and the last
 * switch result → `mcpStatusView()` → badge + note copy here.
 *
 * Key decisions (ADR-0040):
 * - Renders nothing when the status is unavailable, so a failed status fetch
 *   never shows a false "Off" (rule 30.2).
 * - The switch takes effect live, so no copy defers anything to a later
 *   launch (decision 5).
 * - `savedOnButFailed` ("Saved as on — couldn't start") sits beside the
 *   "Failed to start" badge: the setting was saved, the server did not start.
 * - The unreadable note tells the user to fix the file (decision 7: a corrupt
 *   config blocks the switch). It promises nothing about the phase or the next
 *   launch; the badge alone says what is running.
 * - The `notSaved` note reads "Changed elsewhere": it only appears after a
 *   successful switch whose returned `configured` still disagrees, i.e. the
 *   file was changed by something else. A failed save is signalled by its
 *   toast alone (rule 30.5).
 * - No path, binary path or token is ever rendered here (rule 30.3).
 *
 * @coordinates-with src/utils/mcpStatusView.ts — decides badge and note
 * @coordinates-with src/components/common/IntegrationsSettings.tsx — sole caller
 * @module components/common/McpServerStatus
 */
import type { McpStatus } from "../../services/mcpService";
import { mcpStatusView, type McpBadge, type McpNote, type McpSwitchResult } from "../../utils/mcpStatusView";

interface McpServerStatusProps {
  /** Last `mcp_get_status` reply; `null` while unavailable. */
  status: McpStatus | null;
  /** The last live-switch outcome this session; `null` if none applies. */
  switchResult: McpSwitchResult;
}

const BADGE_COPY: Record<Exclude<McpBadge, "none">, string> = {
  running: "Running",
  off: "Off",
  failed: "Failed to start",
  starting: "Starting",
  stopping: "Stopping",
};

export const MCP_NOT_SAVED_COPY = "Changed elsewhere — reopen Settings to see the saved value";

const NOTE_COPY: Record<Exclude<McpNote, "none">, string> = {
  savedOnButFailed: "Saved as on — couldn't start",
  unreadable: "Settings file unreadable — fix it to change this setting",
  notSaved: MCP_NOT_SAVED_COPY,
};

export function McpServerStatus({ status, switchResult }: McpServerStatusProps) {
  const { badge, note } = mcpStatusView(status, switchResult);
  if (status === null || (badge === "none" && note === "none")) return null;

  const noteText = note === "none" ? null : NOTE_COPY[note];

  return (
    <div role="status" className="mcp-server-status">
      {badge !== "none" && (
        <span className={`mcp-status-badge ${badge}`}>
          <span className="mcp-status-dot" aria-hidden="true" />
          {BADGE_COPY[badge]}
        </span>
      )}
      {noteText && <span className="mcp-status-note">{noteText}</span>}
    </div>
  );
}
