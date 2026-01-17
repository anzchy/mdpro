interface ReloadDialogProps {
  open: boolean;
  message: string;
  onReload: () => void;
  onIgnore: () => void;
}

export function ReloadDialog({ open, message, onReload, onIgnore }: ReloadDialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog-card" role="dialog" aria-modal="true" aria-label="Reload file">
        <h3 className="dialog-title">External change detected</h3>
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button className="toolbar-button" type="button" onClick={onIgnore}>
            Ignore
          </button>
          <button className="toolbar-button" type="button" onClick={onReload}>
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
