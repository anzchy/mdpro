/**
 * useMcpServerSwitch — the Settings "Enable MCP Server" toggle (ADR-0040).
 *
 * Purpose: turn the MCP server on or off now through
 * `mcpService.setServerEnabled` (`mcp_set_server_enabled`), and map the reply
 * to the toggle value, the status shown, and at most one signal.
 *
 * Pipeline: `toggle(enabled)` → `deps.beginWrite()` (the owner's one-write
 * lease, or `null` = refused) → optimistic `setConfig` → switch call →
 * - Ok(status): keep the value, `deps.setStatus(status)` (no refetch).
 * - `persist_failed` / `unknown`: revert, one "Failed to save preferences" toast.
 * - `config_unreadable`: revert, no toast (the status region shows its note).
 * - `exiting`: revert, nothing else (the app is quitting).
 * - `status_unavailable`: the value saved — keep it, one toast, re-read the status.
 * → `lease.release()`.
 *
 * Key decisions:
 * - One call in flight at a time: a synchronous ref drops a second toggle,
 *   and the owner's lease refuses a write already pending (MCP-FIX-C1).
 * - A reply to an earlier dialog open (`lease.isCurrent()` false) changes
 *   neither the config nor the status nor `outcome`. Its toast still shows:
 *   a toast is app-global, and a silent failed save is worse than a late one.
 * - Only the IPC call is inside the rejection handling (`callSwitch`): a throw
 *   while applying an Ok reply must never be read as a refused switch and revert it.
 * - `switchResult` is `null` while a call is in flight, so the status region
 *   never compares a just-requested value with a stale status (ADR-0031 5b, N5).
 * - Log: `ui.settings.mcp.serverToggle`, one actionId, `start` then
 *   `success` | `fail`; context is enum-only (direction / phase / error) —
 *   never a path, the token, or raw error text.
 *
 * @coordinates-with src/services/mcpService.ts — setServerEnabled / McpSwitchFailure
 * @coordinates-with src/components/common/SettingsDialog.tsx — issues the write lease
 * @coordinates-with src/components/common/IntegrationsSettings.tsx — the toggle owner
 * @coordinates-with src/utils/mcpStatusView.ts — consumes switchResult
 * @module hooks/useMcpServerSwitch
 */
import { useRef, useState } from "react";
import type { McpConfig } from "../types/preferences";
import {
  mcpService, McpSwitchFailure, type McpStatus, type McpSwitchError,
} from "../services/mcpService";
import { loggingService } from "../services/loggingService";
import { useToastStore } from "../stores/toastStore";
import type { McpSwitchResult } from "../utils/mcpStatusView";

/** The last settled switch call in this mount; `null` until one settles. */
export type McpSwitchOutcome =
  | { kind: "ok"; enabled: boolean; status: McpStatus }
  | { kind: "refused"; error: McpSwitchError | "unknown" }
  | null;

/** One MCP config write, granted by the config owner. */
export interface McpWriteLease {
  /** The config when the write began — the rollback target. */
  readonly previous: McpConfig;
  /** Show `config` as the current value; a no-op once the lease is stale. */
  setConfig: (config: McpConfig) => void;
  /** False once the dialog was closed or reopened after the lease was granted. */
  isCurrent: () => boolean;
  /** End the write; unlocks the toggles if the lease is still current. */
  release: () => void;
}

export interface McpServerSwitchDeps {
  /** Grant a write lease, or `null` if the config is not loaded or a write is pending. */
  beginWrite: () => McpWriteLease | null;
  /** Show the status the switch returned. */
  setStatus: (status: McpStatus) => void;
  /** Re-read the status; handles its own failure. */
  refreshStatus: () => Promise<void>;
}

export interface McpServerSwitch {
  /** A switch call is in flight. */
  saving: boolean;
  outcome: McpSwitchOutcome;
  /** `outcome` for the status region; `null` while saving. */
  switchResult: McpSwitchResult;
  /** Resolves once the call settled; never rejects. */
  toggle: (enabled: boolean) => Promise<void>;
}

export const MCP_SERVER_TOGGLE_EVENT = "ui.settings.mcp.serverToggle";
const SAVE_FAILED_TOAST = "Failed to save preferences";
const STATUS_UNAVAILABLE_TOAST = "Saved — couldn't read the MCP server status";

function log(
  status: "start" | "success" | "fail",
  actionId: string,
  context: Record<string, string>,
  durationMs?: number,
): void {
  loggingService.logEventSync({
    level: status === "fail" ? "warn" : "info",
    event: MCP_SERVER_TOGGLE_EVENT,
    status,
    actionId,
    context,
    durationMs,
  });
}

function toSwitchResult(outcome: McpSwitchOutcome): McpSwitchResult {
  if (outcome === null) return null;
  return outcome.kind === "ok"
    ? { kind: "ok", enabled: outcome.enabled }
    : { kind: "refused", error: outcome.error };
}

type Reply = { ok: true; status: McpStatus } | { ok: false; error: McpSwitchError | "unknown" };

/** The switch call alone, so a throw from applying its reply is never read as a refusal. */
async function callSwitch(enabled: boolean): Promise<Reply> {
  try {
    return { ok: true, status: await mcpService.setServerEnabled(enabled) };
  } catch (rejection: unknown) {
    return { ok: false, error: rejection instanceof McpSwitchFailure ? rejection.error : "unknown" };
  }
}

export function useMcpServerSwitch(deps: McpServerSwitchDeps): McpServerSwitch {
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<McpSwitchOutcome>(null);
  const inFlightRef = useRef(false);

  const settleRefusal = async (error: McpSwitchError | "unknown", lease: McpWriteLease) => {
    if (error !== "status_unavailable") lease.setConfig(lease.previous);
    if (error === "exiting") return;
    if (error === "persist_failed" || error === "unknown") useToastStore.getState().showToast(SAVE_FAILED_TOAST);
    if (error === "status_unavailable") useToastStore.getState().showToast(STATUS_UNAVAILABLE_TOAST);
    if (!lease.isCurrent()) return;
    setOutcome({ kind: "refused", error });
    // The owner reports a failed re-read itself; the toggle must still unlock.
    if (error === "status_unavailable") await deps.refreshStatus().catch(() => undefined);
  };

  // `deps` is read from the render the click happened in: `beginWrite` must see
  // that render's config, and a stale reply is caught by the lease, not by deps.
  const toggle = async (enabled: boolean): Promise<void> => {
    if (inFlightRef.current) return;
    const lease = deps.beginWrite();
    if (lease === null) return;
    inFlightRef.current = true;
    setSaving(true);
    const actionId = loggingService.generateActionId();
    const direction = enabled ? "on" : "off";
    const startedAt = Date.now();
    log("start", actionId, { direction });
    lease.setConfig({ ...lease.previous, serverEnabled: enabled });
    try {
      const reply = await callSwitch(enabled);
      if (reply.ok) {
        const { status } = reply;
        const context: Record<string, string> = { direction, phase: status.phase };
        if (status.error !== null) context.error = status.error;
        log("success", actionId, context, Date.now() - startedAt);
        if (lease.isCurrent()) {
          deps.setStatus(status);
          setOutcome({ kind: "ok", enabled, status });
        }
      } else {
        log("fail", actionId, { direction, error: reply.error }, Date.now() - startedAt);
        await settleRefusal(reply.error, lease);
      }
    } finally {
      lease.release();
      inFlightRef.current = false;
      setSaving(false);
    }
  };

  return { saving, outcome, switchResult: saving ? null : toSwitchResult(outcome), toggle };
}
