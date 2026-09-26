/**
 * McpServerStatus Component
 *
 * Purpose: the one `role="status"` region under the "Enable MCP Server" toggle —
 * a launch badge and at most one inline note (rule 30.5). Presentational only;
 * the decision of what to show lives in `mcpStatusView`.
 *
 * Pipeline: IntegrationsSettings fetches `McpStatus` → SettingsDialog supplies
 * this session's `pendingToggle` → `mcpStatusView()` → badge + note copy here.
 *
 * Key decisions:
 * - Renders nothing when the view has neither badge nor note, so a failed
 *   status fetch never shows a false "Off" (rule 30.2).
 * - The unreadable note never claims MCP is running unless the launch says so
 *   (test matrix UI-07): a corrupt file after a skipped launch means the server
 *   is off now and will try to start on the next launch (fail-open, ADR-0039).
 * - No path or binary path is ever rendered here (rule 30.3).
 *
 * @coordinates-with src/utils/mcpStatusView.ts — decides badge and note
 * @coordinates-with src/components/common/IntegrationsSettings.tsx — sole caller
 * @module components/common/McpServerStatus
 */
import type { McpLaunch, McpStatus } from "../../services/mcpService";
import { mcpStatusView, type McpBadge } from "../../utils/mcpStatusView";

interface McpServerStatusProps {
  /** Last `mcp_get_status` reply; `null` while unavailable. */
  status: McpStatus | null;
  /** `serverEnabled` as the user set it this dialog session; `null` if untouched. */
  pendingToggle: boolean | null;
}

const BADGE_COPY: Record<Exclude<McpBadge, "none">, string> = {
  running: "Running",
  off: "Off",
  failed: "Failed to start",
  starting: "Starting",
};

export const MCP_RESTART_COPY = "Takes effect after you restart mdpro";
export const MCP_NOT_SAVED_COPY = "Not saved — this setting can't be changed from here yet";

/** The unreadable note, worded so it is true for the current launch state. */
function unreadableCopy(launch: McpLaunch): string {
  return launch === "running" || launch === "starting"
    ? "Settings file unreadable — MCP left running"
    : "Settings file unreadable — MCP will try to start on next launch";
}

export function McpServerStatus({ status, pendingToggle }: McpServerStatusProps) {
  const { badge, note } = mcpStatusView(status, pendingToggle);
  if (status === null || (badge === "none" && note === "none")) return null;

  let noteText: string | null = null;
  if (note === "restartPending") noteText = MCP_RESTART_COPY;
  else if (note === "notSaved") noteText = MCP_NOT_SAVED_COPY;
  else if (note === "unreadable") noteText = unreadableCopy(status.launch);

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
