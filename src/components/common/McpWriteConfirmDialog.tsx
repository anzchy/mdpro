/**
 * McpWriteConfirmDialog Component
 *
 * Purpose: the presentational in-window prompt for an ADR-0042 MCP write
 * confirmation — "An MCP client wants to … “title”." with Reject and Approve.
 * It owns no state: every key and click maps to `onReject` or `onApprove`.
 *
 * Key decisions:
 * - **Initial focus is Reject, not the primary action** (a deliberate exception
 *   to rule 32's "most-likely-edited control" default, user decision). The
 *   prompt appears unasked while the user may be typing; a stray Enter must
 *   refuse an external overwrite, never approve it.
 * - **Every dismissal rejects**: Escape, a backdrop click and Reject all call
 *   `onReject`. A card click stops propagation so it dismisses nothing.
 * - **Window-local, not app-modal**: the backdrop covers this webview only;
 *   other windows stay usable. Tab / Shift+Tab wrap inside the card (the inline
 *   loop of `SettingsDialog.handleDialogKeyDown`, rule 32).
 * - **Title only, as text**: the message is `confirmMessage(request)`, which
 *   names the document by title and never by id; React renders it as text, so a
 *   hostile title cannot inject markup.
 *
 * @module components/common/McpWriteConfirmDialog
 * @coordinates-with src/components/common/McpWriteConfirm.tsx — the container that feeds it
 * @coordinates-with src/utils/mcpConfirmModel.ts — `ConfirmRequest`, `confirmMessage`
 */
import { useCallback, useId, useRef } from "react";
import type { KeyboardEvent } from "react";

import { confirmMessage, type ConfirmRequest } from "../../utils/mcpConfirmModel";

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
  const titleId = useId();
  const messageId = useId();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onReject();
        return;
      }
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
    },
    [onReject],
  );

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onReject}>
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
          <button className="toolbar-button" type="button" autoFocus onClick={onReject}>
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
