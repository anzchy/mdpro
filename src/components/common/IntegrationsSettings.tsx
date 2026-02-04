/**
 * IntegrationsSettings Component
 *
 * Settings panel for MCP Server configuration and AI client integrations.
 */

import { useState, useEffect, useCallback } from "react";
import { mcpService, type McpClient, type McpStatus, type McpInstallation } from "../../services/mcpService";
import type { McpConfig } from "../../types/preferences";
import { loggingService } from "../../services/loggingService";

interface IntegrationsSettingsProps {
  mcpConfig: McpConfig;
  onMcpConfigChange: (config: McpConfig) => void;
}

const CLIENT_INFO: Record<McpClient, { name: string; configFile: string }> = {
  claude_desktop: { name: "Claude Desktop", configFile: "claude_desktop_config.json" },
  claude_code: { name: "Claude Code", configFile: ".claude.json" },
  codex_cli: { name: "Codex CLI", configFile: "config.toml" },
  gemini_cli: { name: "Gemini CLI", configFile: "settings.json" },
};

export function IntegrationsSettings({
  mcpConfig,
  onMcpConfigChange,
}: IntegrationsSettingsProps) {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [installations, setInstallations] = useState<McpInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<McpClient | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [statusResult, installationsResult] = await Promise.all([
        mcpService.getStatus(),
        mcpService.getInstallations(),
      ]);
      setStatus(statusResult);
      setInstallations(installationsResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MCP status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleToggleEnabled = (enabled: boolean) => {
    loggingService.logUiEvent("ui.toggle.change", {
      controlId: "settings.integrations.mcp.enabled",
      newValue: enabled,
    });
    onMcpConfigChange({ ...mcpConfig, enabled });
  };

  const handleToggleStartOnLaunch = (startOnLaunch: boolean) => {
    loggingService.logUiEvent("ui.toggle.change", {
      controlId: "settings.integrations.mcp.startOnLaunch",
      newValue: startOnLaunch,
    });
    onMcpConfigChange({ ...mcpConfig, startOnLaunch });
  };

  const handleToggleAutoApprove = (autoApproveEdits: boolean) => {
    loggingService.logUiEvent("ui.toggle.change", {
      controlId: "settings.integrations.mcp.autoApproveEdits",
      newValue: autoApproveEdits,
    });
    onMcpConfigChange({ ...mcpConfig, autoApproveEdits });
  };

  const handleInstall = async (client: McpClient) => {
    try {
      setActionLoading(client);
      loggingService.logButtonClick(`settings.integrations.mcp.install.${client}`);
      await mcpService.installConfig(client);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to install config");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemove = async (client: McpClient) => {
    try {
      setActionLoading(client);
      loggingService.logButtonClick(`settings.integrations.mcp.remove.${client}`);
      await mcpService.removeConfig(client);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove config");
    } finally {
      setActionLoading(null);
    }
  };

  const handleTestConnection = async () => {
    loggingService.logButtonClick("settings.integrations.mcp.testConnection");
    await loadData();
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    loggingService.logButtonClick("settings.integrations.mcp.copyPath");
  };

  if (loading) {
    return (
      <div className="settings-integrations">
        <h3>Integrations</h3>
        <p>Loading MCP server status...</p>
      </div>
    );
  }

  return (
    <div className="settings-integrations">
      <h3>MCP Server</h3>

      {error && (
        <div className="settings-error">
          {error}
        </div>
      )}

      {/* Enable MCP Server */}
      <div className="settings-row">
        <div className="settings-row-content">
          <div className="settings-row-label">
            <strong>Enable MCP Server</strong>
            <span className="settings-row-description">
              Allow AI assistants to control mdpro editor
            </span>
          </div>
          <div className="settings-row-control">
            {status?.running && (
              <span className="mcp-status-badge running">
                <span className="mcp-status-dot" />
                Running
              </span>
            )}
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={mcpConfig.enabled}
                onChange={(e) => handleToggleEnabled(e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
      </div>

      {/* Start on launch */}
      <div className="settings-row">
        <div className="settings-row-content">
          <div className="settings-row-label">
            <strong>Start on launch</strong>
            <span className="settings-row-description">
              Auto-start when mdpro opens
            </span>
          </div>
          <div className="settings-row-control">
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={mcpConfig.startOnLaunch}
                onChange={(e) => handleToggleStartOnLaunch(e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
      </div>

      {/* Auto-approve edits */}
      <div className="settings-row">
        <div className="settings-row-content">
          <div className="settings-row-label">
            <strong>Auto-approve edits</strong>
            <span className="settings-row-description">
              Apply AI changes without preview (use with caution)
            </span>
          </div>
          <div className="settings-row-control">
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={mcpConfig.autoApproveEdits}
                onChange={(e) => handleToggleAutoApprove(e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
      </div>

      {/* Server Info */}
      {status && (
        <div className="mcp-server-info">
          <div className="mcp-info-row">
            <span className="mcp-info-label">Listening on</span>
            <code className="mcp-info-value">
              localhost:{status.port ?? "—"}
            </code>
            {status.port && (
              <button
                className="mcp-copy-btn"
                onClick={() => copyToClipboard(`localhost:${status.port}`)}
                title="Copy to clipboard"
              >
                📋
              </button>
            )}
          </div>
          <span className="mcp-info-hint">
            Port auto-assigned. AI clients discover it automatically.
          </span>
        </div>
      )}

      {/* Test Connection Button */}
      <div className="mcp-actions">
        <button
          className="toolbar-button"
          onClick={() => void handleTestConnection()}
        >
          ↻ Test Connection
        </button>
      </div>

      {/* Install MCP Configuration */}
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
                        onClick={() => copyToClipboard(installation.configPath)}
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
                        onClick={() => void handleInstall(installation.client)}
                        disabled={isLoading}
                      >
                        {isLoading ? "..." : "Update"}
                      </button>
                      <button
                        className="toolbar-button small danger"
                        onClick={() => void handleRemove(installation.client)}
                        disabled={isLoading}
                      >
                        {isLoading ? "..." : "Remove"}
                      </button>
                    </>
                  ) : (
                    <button
                      className="toolbar-button small primary"
                      onClick={() => void handleInstall(installation.client)}
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
    </div>
  );
}
