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
 *   focus-visible, so the dialog opened with no visible focus. `focusVisible: true` makes it
 *   match — but WebKit ignores it on an element that already has focus, and `autoFocus`
 *   focuses before mount effects run, so `autoFocus` is removed rather than supplemented. The
 *   `useLayoutEffect` sits before the early return (rules of hooks) and depends only on
 *   `[open, destructive]`, so an ordinary re-render while open never pulls focus back from
 *   where the user Tabbed to.
 *
 * @coordinates-with src/hooks/useDialogEscape.ts — document-level capture-phase Escape stack
 * @coordinates-with tests/confirm-dialog.test.tsx — CD-1 … CD-17
 * @coordinates-with tests/discard-dialog-focus-wiring.test.tsx — DW-1 (BottomTabs), DW-3 (AppDialogs.tsx) (D48 callers)
 */
import { useLayoutEffect, useRef } from "react";
import { useDialogEscape } from "../../hooks/useDialogEscape";
import { loggingService } from "../../services/loggingService";

/** `focusVisible` is not in this TS lib.dom yet; WebKit honours it (D53). */
const VISIBLE_FOCUS: FocusOptions & { focusVisible?: boolean } = { focusVisible: true };

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

  useLayoutEffect(() => {
    if (!open) return;
    (destructive ? cancelRef : confirmRef).current?.focus(VISIBLE_FOCUS);
  }, [open, destructive]);

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
