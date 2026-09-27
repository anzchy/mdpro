/**
 * MCP server status view — what the Settings MCP row should say.
 *
 * Purpose: map Rust's `mcp_get_status` reply plus the toggle the user changed
 * this session to one badge and at most one inline note (rule 30.5). Pure; no
 * IO, no React.
 *
 * Pipeline: `mcp_get_status` → `McpStatus` → `mcpStatusView(status, pending)`
 * → `McpServerStatus.tsx` renders the badge and note copy.
 *
 * Key decisions (ADR-0039, test matrix D-4):
 * - The badge is a function of `launch` alone; the toggle never changes it.
 * - The restart note compares Rust's on-disk `configured` with `launch`, never
 *   with the toggle: disk is what the next launch reads, so only it can promise
 *   a restart that changes something.
 * - `pendingToggle` is the value last written successfully this dialog
 *   session, or `null` when untouched or while the post-write refresh is
 *   pending (callers own that timing — SettingsDialog, IntegrationsSettings).
 *   Differing from the re-fetched `configured` means something else changed
 *   the file after the write: the `notSaved` note ("Changed elsewhere").
 * - Precedence: `unreadable` > `notSaved` > `restartPending`.
 * - `status === null` (fetch failed or pending) shows nothing (rule 30.2), never
 *   a false "Off".
 *
 * @coordinates-with src/components/common/McpServerStatus.tsx — renders this
 * @coordinates-with src/services/mcpService.ts — `McpStatus` wire type
 * @module utils/mcpStatusView
 */
import type { McpLaunch, McpStatus } from "../services/mcpService";

/** Which badge to show next to the server toggle. `none` renders nothing. */
export type McpBadge = "running" | "off" | "failed" | "starting" | "none";
/** Which single inline note to show. `none` renders nothing. */
export type McpNote = "restartPending" | "notSaved" | "unreadable" | "none";

export interface McpStatusViewModel {
  badge: McpBadge;
  note: McpNote;
}

const BADGE_FOR_LAUNCH: Record<McpLaunch, Exclude<McpBadge, "none">> = {
  running: "running",
  starting: "starting",
  failed: "failed",
  disabled: "off",
};

/**
 * Map a status reply and this session's pending toggle to `{ badge, note }`.
 *
 * @param status - the last `mcp_get_status` reply, or `null` if none is available
 * @param pendingToggle - the `serverEnabled` value successfully written since
 *   this dialog opened, or `null` if untouched or its status refresh is pending
 */
export function mcpStatusView(
  status: Pick<McpStatus, "launch" | "configured"> | null,
  pendingToggle: boolean | null,
): McpStatusViewModel {
  if (status === null) return { badge: "none", note: "none" };

  const badge = BADGE_FOR_LAUNCH[status.launch];
  if (status.configured === "unreadable") return { badge, note: "unreadable" };

  const onDisk = status.configured === "enabled";
  if (pendingToggle !== null && pendingToggle !== onDisk) return { badge, note: "notSaved" };

  // `failed` and `starting` both mean the launch decided to start the server.
  const launchedOn = status.launch !== "disabled";
  return { badge, note: onDisk !== launchedOn ? "restartPending" : "none" };
}
