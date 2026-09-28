/**
 * McpClientList Component
 *
 * Purpose: the "Install MCP Configuration" section of Settings → Integrations —
 * one row per AI client with its config file name, a copy-path button, and
 * Install / Update / Remove actions. Presentational: the owner runs the actions.
 *
 * Key decisions:
 * - Only the config file name is shown; the full path is behind the copy
 *   button (rule 30.3, no absolute paths in primary UI).
 *
 * @coordinates-with src/components/common/IntegrationsSettings.tsx — owns installations and the actions
 * @module components/common/McpClientList
 */
import type { McpClient, McpInstallation } from "../../services/mcpService";

const CLIENT_INFO: Record<McpClient, { name: string; configFile: string }> = {
  claude_desktop: { name: "Claude Desktop", configFile: "claude_desktop_config.json" },
  claude_code: { name: "Claude Code", configFile: ".claude.json" },
  codex_cli: { name: "Codex CLI", configFile: "config.toml" },
  gemini_cli: { name: "Gemini CLI", configFile: "settings.json" },
};

interface McpClientListProps {
  installations: McpInstallation[];
  /** The client whose action is in flight; its buttons are disabled. */
  actionLoading: McpClient | null;
  onInstall: (client: McpClient) => void;
  onRemove: (client: McpClient) => void;
  onCopy: (text: string) => void;
}

export function McpClientList({ installations, actionLoading, onInstall, onRemove, onCopy }: McpClientListProps) {
  return (
    <div className="mcp-installations">
      <h4>Install MCP Configuration</h4>
      <p className="mcp-installations-description">
        Configure AI assistants to connect to mdpro MCP server.
      </p>

      <div className="mcp-client-list">
        {installations.map((installation) => {
          const info = CLIENT_INFO[installation.client];
          const isLoading = actionLoading === installation.client;

          return (
            <div key={installation.client} className="mcp-client-row">
              <div className="mcp-client-info">
                <span className={`mcp-client-status ${installation.installed ? "installed" : ""}`}>
                  {installation.installed ? "✓" : "○"}
                </span>
                <div className="mcp-client-details">
                  <strong>{info.name}</strong>
                  <span className="mcp-client-path">
                    {info.configFile}
                    <button
                      className="mcp-copy-btn small"
                      onClick={() => onCopy(installation.configPath)}
                      title="Copy full path"
                    >
                      📋
                    </button>
                  </span>
                </div>
              </div>
              <div className="mcp-client-actions">
                {installation.installed ? (
                  <>
                    <button
                      className="toolbar-button small"
                      onClick={() => onInstall(installation.client)}
                      disabled={isLoading}
                    >
                      {isLoading ? "..." : "Update"}
                    </button>
                    <button
                      className="toolbar-button small danger"
                      onClick={() => onRemove(installation.client)}
                      disabled={isLoading}
                    >
                      {isLoading ? "..." : "Remove"}
                    </button>
                  </>
                ) : (
                  <button
                    className="toolbar-button small primary"
                    onClick={() => onInstall(installation.client)}
                    disabled={isLoading}
                  >
                    {isLoading ? "..." : "Install"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
