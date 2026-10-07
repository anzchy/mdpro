/**
 * IntegrationsSettings Component
 *
 * Purpose: Settings panel for the MCP server toggles, its live status, and
 * AI client config installation.
 *
 * Pipeline: `mcp_get_status` + `mcp_get_installations` on mount → status badge
 * and note (`McpServerStatus`) + client rows (`McpClientList`). The server
 * toggle goes through `useMcpServerSwitch` (`mcp_set_server_enabled`, ADR-0040);
 * "Start on launch" / "Auto-approve edits" write the whole group through
 * `onMcpConfigChange`. Both take the owner's one-write lease (`beginMcpWrite`).
 *
 * Key decisions (ADR-0039, ADR-0040):
 * - The switch takes effect live and returns the resulting status, which is
 *   shown as-is — no re-fetch, so no race with a stale read. Only a
 *   `status_unavailable` refusal re-reads the status.
 * - The status region gets the hook's `switchResult`, `null` while a switch is
 *   in flight, so a just-requested value is never compared against a stale
 *   status (ADR-0031 5b, N5).
 * - A failed status fetch shows the error and no badge (rule 30.2).
 * - `mcpConfig === null` (not loaded this open, F3): all three toggles are
 *   disabled and described by an inline reason (rule 30.4); toggling is a no-op.
 *   The saved value is unknown, so the server switch mirrors the live phase
 *   (checked iff `running` / `starting`) instead of reading Off beside a Running
 *   badge (D25 issue 1); the other two toggles read off.
 * - One note (rule 30.5): when the load failed and the status note is
 *   `unreadable`, the lock paragraph is dropped and the toggles are described
 *   by the status region's note instead (D25 issue 1).
 * - `mcpSaving` (a write is in flight): the same lock with a "Saving…" reason,
 *   so writes never overlap and a late rejection cannot undo a later write.
 *
 * @coordinates-with src/components/common/SettingsDialog.tsx — owns mcpConfig, saving, and the write lease
 * @coordinates-with src/hooks/useMcpServerSwitch.ts — the live server switch
 * @coordinates-with src/components/common/McpClientList.tsx — client install rows
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
import { McpClientList } from "./McpClientList";
import { useMcpServerSwitch, type McpWriteLease } from "../../hooks/useMcpServerSwitch";
import { mcpStatusView } from "../../utils/mcpStatusView";

interface IntegrationsSettingsProps {
  /** The `mcp` group loaded this open; `null` until it has loaded. */
  mcpConfig: McpConfig | null;
  /** The load failed; the toggles stay disabled for this open. */
  mcpConfigFailed: boolean;
  /** A write is in flight; the toggles are disabled until it settles. */
  mcpSaving: boolean;
  /** `startOnLaunch` / `autoApproveEdits`: resolves once the write settled (it handles its own failure). */
  onMcpConfigChange: (config: McpConfig) => Promise<void>;
  /** The owner's one-write lease for the live server switch, or `null` if refused. */
  beginMcpWrite: () => McpWriteLease | null;
}

const MCP_REASON_ID = "mcp-config-reason";
const MCP_NOTE_ID = "mcp-status-note";

export function IntegrationsSettings({
  mcpConfig,
  mcpConfigFailed,
  mcpSaving,
  onMcpConfigChange,
  beginMcpWrite,
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

  /** Show the status a switch returned; it supersedes an earlier fetch error. */
  const showSwitchStatus = useCallback((next: McpStatus) => {
    setStatus(next);
    setError(null);
  }, []);

  const serverSwitch = useMcpServerSwitch({
    beginWrite: beginMcpWrite,
    setStatus: showSwitchStatus,
    refreshStatus,
  });

  const handleToggle = async (key: keyof McpConfig, value: boolean) => {
    if (mcpConfig === null || mcpSaving) return;
    loggingService.logUiEvent("ui.toggle.change", {
      controlId: `settings.integrations.mcp.${key}`,
      newValue: value,
    });
    if (key === "serverEnabled") return serverSwitch.toggle(value);
    return onMcpConfigChange({ ...mcpConfig, [key]: value });
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
  else if (mcpSaving || serverSwitch.saving) lockReason = "Saving…";
  const locked = lockReason !== null;
  // One note: a failed load beside an "unreadable" status note says the same
  // thing twice, so the status note alone stands as the reason (rule 30.5).
  const unreadableNote = mcpStatusView(status, serverSwitch.switchResult).note === "unreadable";
  if (mcpConfigFailed && unreadableNote) lockReason = null;
  let lockedBy: string | undefined;
  if (lockReason) lockedBy = MCP_REASON_ID;
  else if (locked) lockedBy = MCP_NOTE_ID;
  // Saved value unknown: mirror the live server rather than a false "Off".
  const serverChecked = mcpConfig
    ? mcpConfig.serverEnabled
    : status?.phase === "running" || status?.phase === "starting";

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
        checked={serverChecked}
        disabled={locked}
        describedBy={lockedBy}
        onChange={(v) => void handleToggle("serverEnabled", v)}
      >
        <McpServerStatus status={status} switchResult={serverSwitch.switchResult} noteId={MCP_NOTE_ID} />
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

      <McpClientList
        installations={installations}
        actionLoading={actionLoading}
        onInstall={(client) => void handleInstall(client)}
        onRemove={(client) => void handleRemove(client)}
        onCopy={copyToClipboard}
      />
    </div>
  );
}
