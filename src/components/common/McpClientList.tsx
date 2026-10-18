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
 * - The running action's button says what it is doing ("Installing…",
 *   "Updating…", "Removing…"), and that label is the reason every other
 *   client's buttons are disabled too: one action at a time, since two could
 *   overlap on one config file (rule 30 rule 4, WI-4.3b, PR #508 F508-4).
 * - A failed list read shows the shared failure line in the list's place, and
 *   an empty list one muted line; Test Connection is the refresh.
 *
 * @coordinates-with src/components/common/IntegrationsSettings.tsx — owns installations and the actions
 * @module components/common/McpClientList
 */
import type { McpClient, McpInstallation } from "../../services/mcpService";
import { SettingsLoadFailed } from "./settings/SettingsPageState";

/** The client action in flight, so only its button reads busy. */
export interface McpClientBusy {
  client: McpClient;
  action: "install" | "update" | "remove";
}

const CLIENT_INFO: Record<McpClient, { name: string; configFile: string }> = {
  claude_desktop: { name: "Claude Desktop", configFile: "claude_desktop_config.json" },
  claude_code: { name: "Claude Code", configFile: ".claude.json" },
  codex_cli: { name: "Codex CLI", configFile: "config.toml" },
  gemini_cli: { name: "Gemini CLI", configFile: "settings.json" },
};

interface McpClientListProps {
  installations: McpInstallation[];
  /** The installations read failed; the list shows the failure line. */
  failed: boolean;
  /** The action in flight; every client's buttons are disabled while it runs. */
  actionLoading: McpClientBusy | null;
  onInstall: (client: McpClient, action: "install" | "update") => void;
  onRemove: (client: McpClient) => void;
  onCopy: (text: string) => void;
}

export function McpClientList({ installations, failed, actionLoading, onInstall, onRemove, onCopy }: McpClientListProps) {
  return (
    <div className="mcp-installations">
      <h4>Install MCP Configuration</h4>
      <p className="mcp-installations-description">
        Configure AI assistants to connect to mdpro MCP server.
      </p>

      {failed && <SettingsLoadFailed />}
      {!failed && installations.length === 0 && <p className="mcp-clients-empty">No MCP clients detected</p>}
      {!failed && installations.length > 0 && <div className="mcp-client-list">
        {installations.map((installation) => {
          const info = CLIENT_INFO[installation.client];
          const isLoading = actionLoading !== null;
          const busy = actionLoading?.client === installation.client ? actionLoading.action : null;

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
                      onClick={() => onInstall(installation.client, "update")}
                      disabled={isLoading}
                    >
                      {busy === "update" ? "Updating…" : "Update"}
                    </button>
                    <button
                      className="toolbar-button small danger"
                      onClick={() => onRemove(installation.client)}
                      disabled={isLoading}
                    >
                      {busy === "remove" ? "Removing…" : "Remove"}
                    </button>
                  </>
                ) : (
                  <button
                    className="toolbar-button small primary"
                    onClick={() => onInstall(installation.client, "install")}
                    disabled={isLoading}
                  >
                    {busy === "install" ? "Installing…" : "Install"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>}
    </div>
  );
}
