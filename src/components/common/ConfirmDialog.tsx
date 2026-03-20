import { loggingService } from "../../services/loggingService";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          loggingService.logDialogAction("dialog.confirm.cancel", "cancel", { title });
          onCancel();
        }
      }}
    >
      <div className="dialog-card" role="dialog" aria-modal="true" aria-label={title}>
        <h3 className="dialog-title">{title}</h3>
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button
            className="toolbar-button"
            onClick={() => {
              loggingService.logDialogAction("dialog.confirm.cancel", "cancel", { title });
              onCancel();
            }}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="toolbar-button"
            autoFocus
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
