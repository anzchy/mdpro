import { useState } from "react";
import type { Document } from "../../types/document";
import { FileItem } from "./FileItem";
import { ConfirmDialog } from "../common/ConfirmDialog";

interface SidebarProps {
  documents: Document[];
  activeDocumentId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string, discardChanges: boolean) => void | Promise<void>;
}

export function Sidebar({ documents, activeDocumentId, onSelect, onClose }: SidebarProps) {
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);

  const handleClose = (doc: Document) => {
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
    <aside className="sidebar">
      <div className="sidebar-header">Open Files</div>
      {documents.length === 0 ? (
        <div className="sidebar-empty">No documents open yet.</div>
      ) : (
        <div className="sidebar-list">
          {documents.map((doc) => (
            <FileItem
              key={doc.id}
              document={doc}
              isActive={doc.id === activeDocumentId}
              onSelect={() => onSelect(doc.id)}
              onClose={() => handleClose(doc)}
            />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={pendingCloseId !== null}
        title="Unsaved changes"
        message="Close this document without saving?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={confirmClose}
        onCancel={() => setPendingCloseId(null)}
      />
    </aside>
  );
}
