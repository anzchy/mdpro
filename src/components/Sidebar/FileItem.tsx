import type { Document } from "../../types/document";
import { loggingService } from "../../services/loggingService";

interface FileItemProps {
  document: Document;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

const getTitle = (path: string | null) => {
  if (!path) return "Untitled";
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || "Untitled";
};

export function FileItem({ document, isActive, onSelect, onClose }: FileItemProps) {
  return (
    <div className={`file-item${isActive ? " is-active" : ""}`}>
      <button
        className="file-item-button"
        type="button"
        onClick={() => {
          loggingService.logButtonClick("sidebar.file.select", {
            documentId: document.id,
            filePath: document.path,
          });
          onSelect();
        }}
      >
        <span className="file-item-title">
          {getTitle(document.path)}
          {document.isModified ? " *" : ""}
        </span>
        <span className="file-item-path">
          {document.path ? document.path : "Unsaved"}
        </span>
      </button>
      <button
        className="file-item-close"
        type="button"
        onClick={() => {
          loggingService.logButtonClick("sidebar.file.close", {
            documentId: document.id,
            filePath: document.path,
          });
          onClose();
        }}
      >
        x
      </button>
    </div>
  );
}
