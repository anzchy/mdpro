/**
 * McpWriteConfirmDialog Component
 *
 * Purpose: the presentational in-window prompt for an ADR-0042 MCP write
 * confirmation — "An MCP client wants to … “title”." with Reject and Approve.
 * It owns no prompt state: every key and click maps to `onReject` or `onApprove`.
 *
 * Key decisions:
 * - **Initial focus is Reject, not the primary action** (a deliberate exception
 *   to rule 32's "most-likely-edited control" default, user decision). The
 *   prompt appears unasked while the user may be typing; a stray Enter must
 *   refuse an external overwrite, never approve it.
 * - **Initial focus is one visible focus request, not `autoFocus`** (D63, same defect as
 *   D53): WKWebView drew no `:focus-visible` ring on Reject for an autofocus after a mouse
 *   interaction. `useVisibleInitialFocus(rejectRef, true)` requests it (the hook explains why
 *   `autoFocus` is removed, not supplemented); the target is still Reject. It is called after
 *   `useReturnFocusOnClose`, which captures the prior focus at render, before any effect runs.
 * - **Every dismissal rejects**: Escape, a backdrop click and Reject all call
 *   `onReject`. Escape goes through the shared document-level, capture-phase
 *   stack (`useDialogEscape`, dialog `"mcp_write_confirm"`, outcome `"reject"`),
 *   so it rejects wherever focus is — body, the editor, an outside input — not
 *   only while focus is inside the card (D34). Its log line carries no title.
 *   A card click stops propagation so it dismisses nothing.
 * - **Window-local, not app-modal**: the backdrop covers this webview only;
 *   other windows stay usable. Tab / Shift+Tab wrap inside the card (the inline
 *   loop of `SettingsDialog.handleDialogKeyDown`, rule 32); the card's
 *   `onKeyDown` handles Tab only.
 * - **Title only, as text**: the message is `confirmMessage(request)`, which
 *   names the document by title and never by id; React renders it as text, so a
 *   hostile title cannot inject markup.
 * - **Focus goes back on close** (D37 WI-6, O2): `useReturnFocusOnClose` returns
 *   focus to the element that held it at open, on every close path (Approve, Reject,
 *   Escape, backdrop, an external resolve), so typing after Approve lands in the
 *   editor. When that element is gone (queued prompts: an approved write rebuilt the
 *   editor meanwhile), the fallback focuses the active editor with the caret at its
 *   end (D38 known limit) and logs `ui.mcp_confirm.focus_return` with no content.
 *   The Escape path returns focus the same way, since it ends in the same unmount.
 *
 * @module components/common/McpWriteConfirmDialog
 * @coordinates-with src/components/common/McpWriteConfirm.tsx — the container that feeds it
 * @coordinates-with src/utils/mcpConfirmModel.ts — `ConfirmRequest`, `confirmMessage`
 * @coordinates-with src/hooks/useDialogEscape.ts — the shared Escape stack
 * @coordinates-with src/hooks/useReturnFocusOnClose.ts — the focus return
 * @coordinates-with src/hooks/useVisibleInitialFocus.ts — the visible initial focus on Reject
 * @coordinates-with src/utils/focusActiveMilkdownAtEnd.ts — its fallback
 */
import { useCallback, useId, useRef } from "react";
import type { KeyboardEvent } from "react";

import { useDialogEscape } from "../../hooks/useDialogEscape";
import { useReturnFocusOnClose } from "../../hooks/useReturnFocusOnClose";
import { useVisibleInitialFocus } from "../../hooks/useVisibleInitialFocus";
import { loggingService } from "../../services/loggingService";
import { focusActiveMilkdownAtEnd } from "../../utils/focusActiveMilkdownAtEnd";
import { confirmMessage, type ConfirmRequest } from "../../utils/mcpConfirmModel";

const FOCUS_RETURN_EVENT = "ui.mcp_confirm.focus_return";

/** The fallback when the element focused at open is gone: the editor, at its end. */
function returnToEditor(): HTMLElement | null {
  const target = focusActiveMilkdownAtEnd();
  loggingService.logUiEvent(FOCUS_RETURN_EVENT, {
    outcome: "fallback",
    target: target ? "editor" : "none",
  });
  return target;
}

export interface McpWriteConfirmDialogProps {
  /** The request being shown; only its title reaches the screen. */
  request: ConfirmRequest;
  onApprove: () => void;
  onReject: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function McpWriteConfirmDialog({ request, onApprove, onReject }: McpWriteConfirmDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  const rejectRef = useRef<HTMLButtonElement>(null);
  useReturnFocusOnClose(cardRef, returnToEditor);
  useVisibleInitialFocus(rejectRef, true);
  // Mounted only while a prompt is shown, so always enabled. The log line carries
  // `{ dialog, outcome }` only — never the request or its title.
  useDialogEscape({
    enabled: true,
    containerRef: backdropRef,
    dialog: "mcp_write_confirm",
    outcome: "reject",
    onEscape: onReject,
  });

  // Tab / Shift+Tab wrap only; Escape is handled by the shared stack above.
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !cardRef.current) return;
    const focusable = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <div ref={backdropRef} className="dialog-backdrop" role="presentation" onClick={onReject}>
      <div
        ref={cardRef}
        className="dialog-card mcp-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3 id={titleId} className="dialog-title">
          MCP write confirmation
        </h3>
        <p id={messageId} className="dialog-message">
          {confirmMessage(request)}
        </p>
        <div className="dialog-actions">
          <button ref={rejectRef} className="toolbar-button" type="button" onClick={onReject}>
            Reject
          </button>
          <button className="toolbar-button toolbar-button--primary" type="button" onClick={onApprove}>
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
