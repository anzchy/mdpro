/**
 * McpServerInfo Component
 *
 * Purpose: the "Listening on localhost:<port>" row (with a copy button) and the
 * port hint in the Integrations MCP section. Presentational only.
 *
 * Key decisions:
 * - Renders nothing unless a port is bound (rule 30.2 render-if-nonzero). With
 *   the launch disabled, failed, or still starting `port` is `null`, and a
 *   "Listening on localhost:—" row would claim a listener that does not exist
 *   (MCP-FIX-C2).
 *
 * @coordinates-with src/components/common/IntegrationsSettings.tsx — sole caller
 * @module components/common/McpServerInfo
 */
import type { McpStatus } from "../../services/mcpService";

interface McpServerInfoProps {
  /** Last `mcp_get_status` reply; `null` while unavailable. */
  status: McpStatus | null;
  /** Copy a string to the clipboard (the caller logs the click). */
  onCopy: (text: string) => void;
}

export function McpServerInfo({ status, onCopy }: McpServerInfoProps) {
  const port = status?.port;
  if (port == null) return null;
  const address = `localhost:${port}`;
  return (
    <div className="mcp-server-info">
      <div className="mcp-info-row">
        <span className="mcp-info-label">Listening on</span>
        <code className="mcp-info-value">{address}</code>
        <button
          className="mcp-copy-btn"
          onClick={() => onCopy(address)}
          title="Copy to clipboard"
        >
          📋
        </button>
      </div>
      <span className="mcp-info-hint">
        Port auto-assigned. AI clients discover it automatically.
      </span>
    </div>
  );
}
