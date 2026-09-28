/**
 * MCP server status view — what the Settings MCP row should say.
 *
 * Purpose: map Rust's MCP status plus the result of the last live switch this
 * session to one badge and at most one inline note (rule 30.5). Pure; no IO,
 * no React.
 *
 * Pipeline: `mcp_get_status` / `mcp_set_server_enabled` → `McpStatus` →
 * `mcpStatusView(status, switchResult)` → `McpServerStatus.tsx` renders the
 * badge and note copy.
 *
 * Key decisions (ADR-0040; test matrix U-3):
 * - The badge is a function of `phase` alone; neither `configured` nor the
 *   switch result changes it.
 * - The switch takes effect live (ADR-0040 decision 5), so no note defers a
 *   change to a later launch: a disk/phase disagreement is transient.
 * - Notes, in precedence order:
 *   1. `unreadable` — the on-disk config is unreadable, or the last switch was
 *      refused with `config_unreadable` (decision 7: a corrupt config blocks
 *      the switch);
 *   2. `savedOnButFailed` — the setting says on, but the server is `failed`;
 *   3. `notSaved` — the last switch succeeded, yet the re-read `configured`
 *      disagrees: something else changed the file;
 *   4. `none`.
 * - Other refusals (`persist_failed`, `exiting`, `status_unavailable`,
 *   `unknown`) have no note of their own; the caller signals them (a toast),
 *   so one event never gets two signals.
 * - `status === null` (fetch failed or pending) shows nothing (rule 30.2), never
 *   a false "Off".
 *
 * @coordinates-with src/components/common/McpServerStatus.tsx — renders this
 * @coordinates-with src/services/mcpService.ts — `McpStatus` wire type, switch errors
 * @module utils/mcpStatusView
 */
import type { McpPhase, McpStatus, McpSwitchError } from "../services/mcpService";

/** Which badge to show next to the server toggle. `none` renders nothing. */
export type McpBadge = "running" | "off" | "failed" | "starting" | "stopping" | "none";
/** Which single inline note to show. `none` renders nothing. */
export type McpNote = "savedOnButFailed" | "notSaved" | "unreadable" | "none";

/**
 * The outcome of the last `setServerEnabled` call this session: `ok` with the
 * value requested, `refused` with the narrowed reason, or `null` if the switch
 * was not used (or its result has been superseded).
 */
export type McpSwitchResult =
  | { kind: "ok"; enabled: boolean }
  | { kind: "refused"; error: McpSwitchError | "unknown" }
  | null;

export interface McpStatusViewModel {
  badge: McpBadge;
  note: McpNote;
}

const BADGE_FOR_PHASE: Record<McpPhase, Exclude<McpBadge, "none">> = {
  running: "running",
  starting: "starting",
  stopping: "stopping",
  failed: "failed",
  disabled: "off",
};

/**
 * Map a status and the last switch result to `{ badge, note }`.
 *
 * @param status - the latest status reply, or `null` if none is available
 * @param switchResult - the last live-switch outcome this session, or `null`
 */
export function mcpStatusView(
  status: Pick<McpStatus, "phase" | "configured"> | null,
  switchResult: McpSwitchResult,
): McpStatusViewModel {
  if (status === null) return { badge: "none", note: "none" };

  const badge = BADGE_FOR_PHASE[status.phase];
  const refusedUnreadable = switchResult?.kind === "refused" && switchResult.error === "config_unreadable";
  if (status.configured === "unreadable" || refusedUnreadable) return { badge, note: "unreadable" };

  const onDisk = status.configured === "enabled";
  if (onDisk && status.phase === "failed") return { badge, note: "savedOnButFailed" };
  if (switchResult?.kind === "ok" && switchResult.enabled !== onDisk) return { badge, note: "notSaved" };
  return { badge, note: "none" };
}
