import { useState } from "react";
import type { Document } from "../../types/document";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { basename } from "../../utils/pathBasename";
import { isMacPlatform, newDocumentTooltip } from "../../utils/platformLabels";
import "./BottomTabs.css";

interface BottomTabsProps {
  documents: Document[];
  activeDocumentId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string, discardChanges: boolean) => void | Promise<void>;
  onNewDocument: () => void;
}

function getDocumentTitle(doc: Document): string {
  if (doc.path) {
    return basename(doc.path);
  }
  return "Untitled";
}

export function BottomTabs({
  documents,
  activeDocumentId,
  onSelect,
  onClose,
  onNewDocument,
}: BottomTabsProps) {
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);

  const handleClose = (e: React.MouseEvent, doc: Document) => {
    e.stopPropagation();
    if (doc.isModified) {
      setPendingCloseId(doc.id);
    } else {
      void onClose(doc.id, true);
    }
  };

  const confirmClose = async () => {
    if (pendingCloseId) {
      await onClose(pendingCloseId, true);
      setPendingCloseId(null);
    }
  };

  return (
    <nav className="bottom-tabs">
      <button
        className="bottom-tabs__add"
        onClick={onNewDocument}
        title={newDocumentTooltip(isMacPlatform())}
      >
        +
      </button>
      <div className="bottom-tabs__divider" />
      <div className="bottom-tabs__scroll">
        {documents.map((doc) => (
          <button
            key={doc.id}
            className={`bottom-tab ${doc.id === activeDocumentId ? "bottom-tab--active" : ""}`}
            onClick={() => onSelect(doc.id)}
            title={doc.path || "Untitled"}
          >
            {doc.isModified && <span className="bottom-tab__modified" />}
            <span className="bottom-tab__name">{getDocumentTitle(doc)}</span>
            <span
              className="bottom-tab__close"
              onClick={(e) => handleClose(e, doc)}
              role="button"
              tabIndex={0}
            >
              ×
            </span>
          </button>
        ))}
      </div>

      <ConfirmDialog
        open={pendingCloseId !== null}
        title="Unsaved changes"
        message="Close this document without saving?"
        confirmLabel="Discard"
        destructive
        cancelLabel="Keep editing"
        onConfirm={confirmClose}
        onCancel={() => setPendingCloseId(null)}
      />
    </nav>
  );
}
