/**
 * IntegrationsSettings Component
 *
 * Purpose: Settings panel for the MCP server toggles, its launch status, and
 * AI client config installation.
 *
 * Pipeline: `mcp_get_status` + `mcp_get_installations` on mount → status badge
 * and note (`McpServerStatus`) + client rows. Toggles call `onMcpConfigChange`
 * (SettingsDialog owns the config and this session's `pendingToggle`).
 *
 * Key decisions (ADR-0039):
 * - After a server-toggle write settles — success or failure — only the status
 *   is re-fetched, so `configured` is read fresh without blanking the panel.
 * - A failed status fetch shows the error and no badge (rule 30.2).
 * - `mcpConfig === null` (not loaded this open, F3): all three toggles are
 *   disabled and described by an inline reason (rule 30.4); toggling is a no-op.
 * - `mcpSaving` (a write is in flight): the same lock with a "Saving…" reason,
 *   so writes never overlap and a late rejection cannot undo a later write.
 *
 * @coordinates-with src/components/common/SettingsDialog.tsx — owns mcpConfig / pendingToggle / saving
 * @coordinates-with src/components/common/McpServerInfo.tsx — "Listening on" row
 * @coordinates-with src/components/common/McpServerStatus.tsx — badge + note region
 * @coordinates-with src/components/common/McpToggleRow.tsx — labelled toggle rows
 * @module components/common/IntegrationsSettings
 */

import { useState, useEffect, useCallback } from "react";
import { mcpService, type McpClient, type McpStatus, type McpInstallation } from "../../services/mcpService";
import type { McpConfig } from "../../types/preferences";
import { loggingService } from "../../services/loggingService";
import { McpServerStatus } from "./McpServerStatus";
import { McpToggleRow } from "./McpToggleRow";
import { McpServerInfo } from "./McpServerInfo";

interface IntegrationsSettingsProps {
  /** The `mcp` group loaded this open; `null` until it has loaded. */
  mcpConfig: McpConfig | null;
  /** The load failed; the toggles stay disabled for this open. */
  mcpConfigFailed: boolean;
  /** `serverEnabled` as set this dialog session; `null` if untouched. */
  mcpPendingToggle: boolean | null;
  /** A write is in flight; the toggles are disabled until it settles. */
  mcpSaving: boolean;
  /** Resolves once the write has settled (it handles its own failure). */
  onMcpConfigChange: (config: McpConfig) => Promise<void>;
}

const MCP_REASON_ID = "mcp-config-reason";

const CLIENT_INFO: Record<McpClient, { name: string; configFile: string }> = {
  claude_desktop: { name: "Claude Desktop", configFile: "claude_desktop_config.json" },
  claude_code: { name: "Claude Code", configFile: ".claude.json" },
  codex_cli: { name: "Codex CLI", configFile: "config.toml" },
  gemini_cli: { name: "Gemini CLI", configFile: "settings.json" },
};

export function IntegrationsSettings({
  mcpConfig,
  mcpConfigFailed,
  mcpPendingToggle,
  mcpSaving,
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

  /** Status-only re-fetch: keeps the panel mounted, reads `configured` fresh. */
  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await mcpService.getStatus());
      setError(null);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Failed to load MCP status");
    }
  }, []);

  const handleToggle = async <K extends keyof McpConfig>(key: K, value: McpConfig[K]) => {
    if (mcpConfig === null || mcpSaving) return;
    loggingService.logUiEvent("ui.toggle.change", {
      controlId: `settings.integrations.mcp.${key}`,
      newValue: value,
    });
    await onMcpConfigChange({ ...mcpConfig, [key]: value });
    if (key === "serverEnabled") await refreshStatus();
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

  // Why the toggles are disabled, if they are (rule 30.4); null = enabled.
  let lockReason: string | null = null;
  if (mcpConfigFailed) lockReason = "MCP settings couldn't be loaded — close and reopen Settings to retry";
  else if (!mcpConfig) lockReason = "Loading MCP settings…";
  else if (mcpSaving) lockReason = "Saving…";
  const locked = lockReason !== null;
  const lockedBy = locked ? MCP_REASON_ID : undefined;

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

      {lockReason && (
        <p id={MCP_REASON_ID} className="settings-row-description">{lockReason}</p>
      )}
      <McpToggleRow
        labelId="mcp-toggle-server-label"
        label="Enable MCP Server"
        description="Allow AI assistants to control mdpro editor"
        checked={mcpConfig?.serverEnabled ?? false}
        disabled={locked}
        describedBy={lockedBy}
        onChange={(v) => void handleToggle("serverEnabled", v)}
      >
        <McpServerStatus status={status} pendingToggle={mcpPendingToggle} />
      </McpToggleRow>
      <McpToggleRow
        labelId="mcp-toggle-launch-label"
        label="Start on launch"
        description="Auto-start when mdpro opens"
        checked={mcpConfig?.startOnLaunch ?? false}
        disabled={locked}
        describedBy={lockedBy}
        onChange={(v) => void handleToggle("startOnLaunch", v)}
      />
      <McpToggleRow
        labelId="mcp-toggle-approve-label"
        label="Auto-approve edits"
        description="Apply AI changes without preview (use with caution)"
        checked={mcpConfig?.autoApproveEdits ?? false}
        disabled={locked}
        describedBy={lockedBy}
        onChange={(v) => void handleToggle("autoApproveEdits", v)}
      />

      <McpServerInfo status={status} onCopy={copyToClipboard} />

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
