/**
 * McpWriteConfirm Component
 *
 * Purpose: the per-window container for the ADR-0042 MCP write confirmation —
 * binds `useMcpConfirm` (this window's prompt queue) to `McpWriteConfirmDialog`.
 * Renders nothing while no prompt is shown. Mounted once per window (through
 * `AppDialogs.tsx`, which every window renders), so each window shows only its
 * own prompts. An optional `onPromptChange` reports the shown prompt's id to
 * the parent, which uses it to stack the dialog in open order (D42). An
 * optional `recoveryLink` is handed to the hook, so startup Recovery and this
 * queue see each other (D241, ADR-0116).
 *
 * Key decisions:
 * - **Keyed by `requestId`**, so the next queued prompt mounts a fresh dialog
 *   and its visible initial focus lands on its Reject button again (D63).
 * - **No logging here**: the hook already logs each answer and each reply.
 * - **`useMcpConfirm` stays here, called once per window.** The parent learns
 *   the shown id through `onPromptChange` instead of lifting the hook, which
 *   would mean a second subscription or an API change for every caller.
 * - **`onPromptChange` fires from a `useLayoutEffect` keyed on the shown
 *   `requestId`**, so `AppDialogs.tsx` can re-order in the same pre-paint
 *   commit. It fires only when the shown id changes (`null` on resolve, the new
 *   id on a queued replacement), never on a re-render that keeps the id. The
 *   latest callback lives in a ref, so a new callback identity alone never fires.
 *
 * @module components/common/McpWriteConfirm
 * @coordinates-with src/hooks/useMcpConfirm.ts — `{ prompt, approve, reject }`
 * @coordinates-with src/components/common/McpWriteConfirmDialog.tsx — the presentation
 * @coordinates-with src/components/AppDialogs.tsx — the parent; consumes `onPromptChange` for open order
 */
import { useLayoutEffect, useRef } from "react";
import { useMcpConfirm, type McpRecoveryLink } from "../../hooks/useMcpConfirm";
import { McpWriteConfirmDialog } from "./McpWriteConfirmDialog";

export interface McpWriteConfirmProps {
  /** Called with the shown prompt's `requestId`, or `null` when none is shown. */
  onPromptChange?: (requestId: string | null) => void;
  /** The link `useRecoveryAdmission` owns: MCP-pending flag, Recovery slot, republish. */
  recoveryLink?: McpRecoveryLink;
}

export function McpWriteConfirm({ onPromptChange, recoveryLink }: McpWriteConfirmProps = {}) {
  const { prompt, approve, reject } = useMcpConfirm(recoveryLink);
  const shownId = prompt?.requestId ?? null;

  // Declared before the report effect, so it updates first in the same commit.
  const callbackRef = useRef(onPromptChange);
  useLayoutEffect(() => {
    callbackRef.current = onPromptChange;
  });

  // Starts at `null`, so the initial no-prompt state is never reported.
  const reportedRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (reportedRef.current === shownId) return;
    reportedRef.current = shownId;
    callbackRef.current?.(shownId);
  }, [shownId]);

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
