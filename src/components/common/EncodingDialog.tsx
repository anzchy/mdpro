import { loggingService } from "../../services/loggingService";

interface EncodingDialogProps {
  open: boolean;
  path: string;
  detected: string;
  onSelect: (encoding: string) => void;
  onCancel: () => void;
}

const ENCODINGS = ["UTF-8", "UTF-16LE", "UTF-16BE", "ASCII"];

export function EncodingDialog({ open, path, detected, onSelect, onCancel }: EncodingDialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog-card" role="dialog" aria-modal="true" aria-label="Select encoding">
        <h3 className="dialog-title">Unsupported encoding</h3>
        <p className="dialog-message">
          The file could not be decoded (detected: {detected}). Choose an encoding to retry.
        </p>
        <div className="encoding-path">{path}</div>
        <div className="encoding-options">
          {ENCODINGS.map((encoding) => (
            <button
              key={encoding}
              className="toolbar-button"
              type="button"
              onClick={() => {
                loggingService.logDialogAction("dialog.encoding.select", "success", {
                  encoding,
                });
                onSelect(encoding);
              }}
            >
              {encoding}
            </button>
          ))}
          <button
            className="toolbar-button"
            type="button"
            onClick={() => {
              loggingService.logDialogAction("dialog.encoding.cancel", "cancel");
              onCancel();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
