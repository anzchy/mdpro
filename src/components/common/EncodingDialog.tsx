/**
 * Purpose: the prompt shown when an opened file is not valid UTF-8 and has no BOM.
 * It offers a checked UTF-16 retry (LE or BE) or Cancel (D52, ADR-0057).
 *
 * Key decisions:
 * - **No UTF-8 or ASCII button** (ADR-0057 decision 2): the dialog opens only when
 *   detection returned "unknown", which already ruled both out.
 * - **UTF-16 is a checked retry** (decision 3): Rust refuses an implausible decode
 *   (`encoding::hinted_decode_refusal`) and App shows the refusal toast.
 * - **Cancel is the initial focus; Escape and a backdrop click take Cancel**
 *   (decision 1), so Enter never commits a retry. Focus is one visible focus request
 *   (`useVisibleInitialFocus`, D53/D63), called before the early return. Escape is a
 *   backdrop `onKeyDown`, as in ReloadDialog: it reaches the backdrop by bubbling from
 *   the focused Cancel. Moving it onto the shared `useDialogEscape` stack is WI-4.6b.
 * - Every string comes from `ENCODING_DIALOG_COPY`. The dialog takes no `detected`
 *   prop: the approved copy does not name a detected encoding.
 *
 * @coordinates-with src/components/common/encodingDialogCopy.ts — the copy and options
 * @coordinates-with src/hooks/useVisibleInitialFocus.ts — the initial focus on Cancel
 * @coordinates-with tests/d52-encoding-dialog.test.tsx — ED-1 … ED-6
 */
import { useRef } from "react";

import { useVisibleInitialFocus } from "../../hooks/useVisibleInitialFocus";
import { loggingService } from "../../services/loggingService";
import { ENCODING_DIALOG_COPY, ENCODING_DIALOG_OPTIONS } from "./encodingDialogCopy";

interface EncodingDialogProps {
  open: boolean;
  path: string;
  onSelect: (encoding: string) => void;
  onCancel: () => void;
}

export function EncodingDialog({ open, path, onSelect, onCancel }: EncodingDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useVisibleInitialFocus(cancelRef, open);

  if (!open) return null;

  const handleCancel = () => {
    loggingService.logDialogAction("dialog.encoding.cancel", "cancel");
    onCancel();
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === "Escape") handleCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label={ENCODING_DIALOG_COPY.ariaLabel}
      >
        <h3 className="dialog-title">{ENCODING_DIALOG_COPY.title}</h3>
        <p className="dialog-message">{ENCODING_DIALOG_COPY.body}</p>
        <p className="dialog-message">{ENCODING_DIALOG_COPY.retryHint}</p>
        <div className="encoding-path">{path}</div>
        <div className="encoding-options">
          {ENCODING_DIALOG_OPTIONS.map(({ encoding, label }) => (
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
              {label}
            </button>
          ))}
          <button ref={cancelRef} className="toolbar-button" type="button" onClick={handleCancel}>
            {ENCODING_DIALOG_COPY.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
