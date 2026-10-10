/**
 * Purpose: the "External change detected" prompt for a file changed on disk — Ignore or
 * Reload. Escape means Ignore.
 *
 * Key decisions:
 * - **Escape is a backdrop `onKeyDown`**: it reaches the backdrop by bubbling from the focused
 *   Reload button, so it depends on initial focus landing inside the card.
 * - **Initial focus is one visible focus request on Reload, not `autoFocus`** (D63, same defect
 *   as D53): WKWebView drew no `:focus-visible` ring for an autofocus after a mouse interaction.
 *   `useVisibleInitialFocus` (which explains why `autoFocus` is removed, not supplemented) is
 *   called before the `if (!open) return null` early return (rules of hooks). The target stays
 *   Reload; whether Reload should be the default button is D59/D32, not this change.
 *
 * @coordinates-with src/hooks/useVisibleInitialFocus.ts — the visible initial-focus request
 * @coordinates-with tests/reload-dialog.test.tsx — Escape, RD-1 … RD-4
 */
import { useRef } from "react";

import { useVisibleInitialFocus } from "../../hooks/useVisibleInitialFocus";
import { loggingService } from "../../services/loggingService";

interface ReloadDialogProps {
  open: boolean;
  message: string;
  onReload: () => void;
  onIgnore: () => void;
}

export function ReloadDialog({ open, message, onReload, onIgnore }: ReloadDialogProps) {
  const reloadRef = useRef<HTMLButtonElement>(null);
  useVisibleInitialFocus(reloadRef, open);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          loggingService.logDialogAction("dialog.reload.ignore", "cancel");
          onIgnore();
        }
      }}
    >
      <div className="dialog-card" role="dialog" aria-modal="true" aria-label="Reload file">
        <h3 className="dialog-title">External change detected</h3>
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button
            className="toolbar-button"
            type="button"
            onClick={() => {
              loggingService.logDialogAction("dialog.reload.ignore", "cancel");
              onIgnore();
            }}
          >
            Ignore
          </button>
          <button
            ref={reloadRef}
            className="toolbar-button"
            type="button"
            onClick={() => {
              loggingService.logDialogAction("dialog.reload.reload", "success");
              onReload();
            }}
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
