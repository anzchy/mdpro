import { useState } from "react";
import type { Document } from "../../types/document";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { basename } from "../../utils/pathBasename";
import { isMacPlatform, newDocumentTooltip } from "../../utils/platformLabels";
import { SidebarToggleButton } from "./SidebarToggleButton";
import "./BottomTabs.css";

interface BottomTabsProps {
  documents: Document[];
  activeDocumentId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string, discardChanges: boolean) => void | Promise<void>;
  onNewDocument: () => void;
  /** Whether the sidebar is shown; drives the toggle's icon and name. */
  sidebarShown: boolean;
  onToggleSidebar: () => void;
  /** The live `viewToggleSidebar` binding, named in the toggle's label. */
  sidebarToggleShortcut?: string;
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
  sidebarShown,
  onToggleSidebar,
  sidebarToggleShortcut,
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
      <SidebarToggleButton
        shown={sidebarShown}
        onToggle={onToggleSidebar}
        shortcut={sidebarToggleShortcut}
      />
      <div className="bottom-tabs__divider" />
      <button
        className="bottom-tabs__add"
        onClick={onNewDocument}
        aria-label="New document"
        title={newDocumentTooltip(isMacPlatform())}
      >
        +
      </button>
      <div className="bottom-tabs__divider" />
      <div className="bottom-tabs__scroll" role="tablist" aria-label="Open documents">
        {documents.map((doc) => (
          // D231: the × is a sibling button, not nested in the select button,
          // so Tab reaches it as its own stop and Enter / Space close the tab.
          // The wrapper selects, so a click in its padding or beside the ×
          // selects too (audit b160 M); the select button's own click, mouse
          // or Enter / Space, bubbles here, and the × stops propagation.
          <div
            key={doc.id}
            className={`bottom-tab ${doc.id === activeDocumentId ? "bottom-tab--active" : ""}`}
            onClick={() => onSelect(doc.id)}
          >
            <button
              type="button"
              className="bottom-tab__select"
              role="tab"
              aria-selected={doc.id === activeDocumentId}
              title={doc.path || "Untitled"}
            >
              {doc.isModified && <span className="bottom-tab__modified" aria-label="Unsaved changes" />}
              <span className="bottom-tab__name">{getDocumentTitle(doc)}</span>
            </button>
            <button
              type="button"
              className="bottom-tab__close"
              onClick={(e) => handleClose(e, doc)}
              aria-label={`Close ${getDocumentTitle(doc)}`}
            >
              ×
            </button>
          </div>
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
