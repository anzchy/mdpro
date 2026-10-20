/**
 * Purpose: require a deliberate choice before Save recreates a file whose deletion
 * the user ignored (D290). The card is mounted only while a request exists so its
 * focus return captures the control that opened it.
 * @coordinates-with src/components/AppDialogs.tsx — open-order slot
 * @coordinates-with src/hooks/useDialogEscape.ts — topmost Escape cancellation
 */
import { useRef } from "react";
import { useDialogEscape } from "../../hooks/useDialogEscape";
import { useReturnFocusOnClose } from "../../hooks/useReturnFocusOnClose";
import { useVisibleInitialFocus } from "../../hooks/useVisibleInitialFocus";

export type RecreateChoice = "original" | "save-as" | "cancel";

export interface RecreateRequest {
  documentId: string;
  path: string;
  seq: number;
  actionId: string;
}

interface Props {
  request: RecreateRequest | null;
  onChoice: (choice: RecreateChoice) => void;
}

function OpenRecreateFileDialog({ onChoice }: Pick<Props, "onChoice">) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useReturnFocusOnClose(cardRef);
  useVisibleInitialFocus(cancelRef, true);
  useDialogEscape({ enabled: true, containerRef: backdropRef, dialog: "recreate", outcome: "cancel", onEscape: () => onChoice("cancel") });

  const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const buttons = Array.from(cardRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div ref={backdropRef} className="dialog-backdrop" role="presentation" onClick={() => onChoice("cancel")}>
      <div ref={cardRef} className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="recreate-title" aria-describedby="recreate-message" onKeyDown={trapTab} onClick={(event) => event.stopPropagation()}>
        <h3 className="dialog-title" id="recreate-title">Recreate file</h3>
        <p className="dialog-message" id="recreate-message">This file was deleted or moved. Where would you like to save your changes?</p>
        <div className="dialog-actions">
          <button ref={cancelRef} className="toolbar-button" type="button" onClick={() => onChoice("cancel")}>Cancel</button>
          <button className="toolbar-button" type="button" onClick={() => onChoice("save-as")}>Save As…</button>
          <button className="toolbar-button" type="button" onClick={() => onChoice("original")}>Save to original path</button>
        </div>
      </div>
    </div>
  );
}

export function RecreateFileDialog({ request, onChoice }: Props) {
  return request ? <OpenRecreateFileDialog onChoice={onChoice} /> : null;
}
