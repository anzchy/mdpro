/**
 * McpWriteConfirm Component
 *
 * Purpose: the per-window container for the ADR-0042 MCP write confirmation —
 * binds `useMcpConfirm` (this window's prompt queue) to `McpWriteConfirmDialog`.
 * Renders nothing while no prompt is shown. Mounted once in `App.tsx`, which
 * every window renders, so each window shows only its own prompts.
 *
 * Key decisions:
 * - **Keyed by `requestId`**, so the next queued prompt mounts a fresh dialog
 *   and `autoFocus` lands on its Reject button again.
 * - **No logging here**: the hook already logs each answer and each reply.
 *
 * @module components/common/McpWriteConfirm
 * @coordinates-with src/hooks/useMcpConfirm.ts — `{ prompt, approve, reject }`
 * @coordinates-with src/components/common/McpWriteConfirmDialog.tsx — the presentation
 */
import { useMcpConfirm } from "../../hooks/useMcpConfirm";
import { McpWriteConfirmDialog } from "./McpWriteConfirmDialog";

export function McpWriteConfirm() {
  const { prompt, approve, reject } = useMcpConfirm();
  if (!prompt) return null;
  return (
    <McpWriteConfirmDialog
      key={prompt.requestId}
      request={prompt}
      onApprove={approve}
      onReject={reject}
    />
  );
}
