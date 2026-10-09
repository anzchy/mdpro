/**
 * Purpose: generic two-button confirm dialog (App "Unsaved changes", BottomTabs,
 * AboutSettings restart prompt). Escape means Cancel.
 *
 * Key decisions:
 * - **Escape goes through the shared `useDialogEscape` stack** (D34), not a backdrop
 *   `onKeyDown`: a listener on the dialog's own element only fired while focus was inside
 *   it, which D34 showed is not the case on device. The hook is called before the
 *   `if (!open) return null` early return (rules of hooks) and registers only while `open`.
 * - **One `handleCancel`** for both the Cancel button and Escape, so an Escape logs the same
 *   `ui.dialog.cancel` line as a click (plus the stack's `ui.dialog.escape`).
 * - **`destructive` moves initial focus to Cancel** (D48): with initial focus on Confirm, every
 *   "Unsaved changes" dialog opened on Discard and a reflexive Enter threw the edits away.
 *   Discard callers pass `destructive`; omitted, focus goes to Confirm (AboutSettings
 *   "Save and Restart"). Danger styling and Tab trapping are WI-4.6, not this prop.
 * - **Initial focus is one `focus({ focusVisible: true })` call, not `autoFocus`** (D53): button
 *   rings key only on `:focus-visible` (rule 33 pattern 2), and WKWebView does not treat a
 *   script/autofocus focus after a mouse interaction (click in the editor, then ⌘W) as
 *   focus-visible, so the dialog opened with no visible focus. The request is the shared
 *   `useVisibleInitialFocus` hook (extracted in D63, which has the WebKit reasoning and why
 *   `autoFocus` is removed rather than supplemented). It is called before the early return
 *   (rules of hooks) and re-fires only when `open` or the target (`destructive`) changes, so an
 *   ordinary re-render while open never pulls focus back from where the user Tabbed to.
 *
 * @coordinates-with src/hooks/useDialogEscape.ts — document-level capture-phase Escape stack
 * @coordinates-with src/hooks/useVisibleInitialFocus.ts — the visible initial-focus request (D53/D63)
 * @coordinates-with tests/confirm-dialog.test.tsx — CD-1 … CD-17b
 * @coordinates-with tests/discard-dialog-focus-wiring.test.tsx — DW-1 (BottomTabs), DW-3 (AppDialogs.tsx) (D48 callers)
 */
import { useRef } from "react";
import { useDialogEscape } from "../../hooks/useDialogEscape";
import { useVisibleInitialFocus } from "../../hooks/useVisibleInitialFocus";
import { loggingService } from "../../services/loggingService";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Confirm destroys data (e.g. discards edits): open with focus on Cancel, not Confirm. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const handleCancel = () => {
    loggingService.logDialogAction("dialog.confirm.cancel", "cancel", { title });
    onCancel();
  };

  useDialogEscape({
    enabled: open,
    containerRef: backdropRef,
    dialog: "confirm",
    outcome: "cancel",
    onEscape: handleCancel,
  });

  useVisibleInitialFocus(destructive ? cancelRef : confirmRef, open);

  if (!open) {
    return null;
  }

  return (
    <div ref={backdropRef} className="dialog-backdrop" role="presentation">
      <div className="dialog-card" role="dialog" aria-modal="true" aria-label={title}>
        <h3 className="dialog-title">{title}</h3>
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            className="toolbar-button"
            onClick={handleCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            className="toolbar-button"
            onClick={() => {
              loggingService.logDialogAction("dialog.confirm.confirm", "success", { title });
              onConfirm();
            }}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
