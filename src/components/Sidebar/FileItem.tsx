import type { Document } from "../../types/document";

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
      <button className="file-item-button" type="button" onClick={onSelect}>
        <span className="file-item-title">
          {getTitle(document.path)}
          {document.isModified ? " *" : ""}
        </span>
        <span className="file-item-path">
          {document.path ? document.path : "Unsaved"}
        </span>
      </button>
      <button className="file-item-close" type="button" onClick={onClose}>
        x
      </button>
    </div>
  );
}
