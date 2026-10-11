/**
 * Purpose: the "External change detected" prompt for a file changed on disk — Ignore or
 * Reload. Escape means Ignore.
 *
 * Key decisions:
 * - **Escape goes through the shared `useDialogEscape` stack** (D140), dialog `"reload"`,
 *   outcome `"ignore"`, calling the same `handleIgnore` as the Ignore button. The former
 *   backdrop `onKeyDown` only heard Escape while focus was inside the card, so Escape from
 *   `<body>` did nothing (ADR-0045 Cost e, pinned by D42 case 4.13 until this change).
 * - **Initial focus is one visible focus request on Reload, not `autoFocus`** (D63, same defect
 *   as D53): WKWebView drew no `:focus-visible` ring for an autofocus after a mouse interaction.
 *   `useVisibleInitialFocus` (which explains why `autoFocus` is removed, not supplemented) is
 *   called before the `if (!open) return null` early return (rules of hooks). The target stays
 *   Reload; whether Reload should be the default button is D59/D32, not this change.
 *
 * @coordinates-with src/hooks/useVisibleInitialFocus.ts — the visible initial-focus request
 * @coordinates-with src/hooks/useDialogEscape.ts — document-level capture-phase Escape stack
 * @coordinates-with tests/reload-dialog.test.tsx — Escape, RD-1 … RD-4
 * @coordinates-with tests/d140-dialog-escape-device-path.test.tsx — DP-3, DP-6
 */
import { useRef } from "react";

import { useDialogEscape } from "../../hooks/useDialogEscape";
import { useVisibleInitialFocus } from "../../hooks/useVisibleInitialFocus";
import { loggingService } from "../../services/loggingService";

interface ReloadDialogProps {
  open: boolean;
  message: string;
  onReload: () => void;
  onIgnore: () => void;
}

export function ReloadDialog({ open, message, onReload, onIgnore }: ReloadDialogProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const reloadRef = useRef<HTMLButtonElement>(null);

  const handleIgnore = () => {
    loggingService.logDialogAction("dialog.reload.ignore", "cancel");
    onIgnore();
  };

  useDialogEscape({
    enabled: open,
    containerRef: backdropRef,
    dialog: "reload",
    outcome: "ignore",
    onEscape: handleIgnore,
  });

  useVisibleInitialFocus(reloadRef, open);

  if (!open) return null;

  return (
    <div ref={backdropRef} className="dialog-backdrop" role="presentation">
      <div className="dialog-card" role="dialog" aria-modal="true" aria-label="Reload file">
        <h3 className="dialog-title">External change detected</h3>
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button
            className="toolbar-button"
            type="button"
            onClick={handleIgnore}
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
