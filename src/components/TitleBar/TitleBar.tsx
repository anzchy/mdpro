import type { ViewMode } from "../../types/editor";

interface TitleBarProps {
  title: string;
  isModified: boolean;
  viewMode: ViewMode;
}

function getViewModeLabel(mode: ViewMode): string {
  switch (mode) {
    case "split":
      return "SPLIT";
    case "editor-only":
      return "EDITOR";
    case "preview-only":
      return "PREVIEW";
    case "wysiwyg":
      return "WYSIWYG";
    default:
      return "";
  }
}

export function TitleBar({ title, isModified, viewMode }: TitleBarProps) {
  return (
    <div className="title-bar" data-tauri-drag-region>
      {/* Left spacer for traffic lights */}
      <div className="title-bar-left" />

      {/* Center: Document name */}
      <div className="title-bar-center" data-tauri-drag-region>
        <span className="title-bar-icon">📄</span>
        <span className="title-bar-title">
          {title}
          {isModified ? " •" : ""}
        </span>
      </div>

      {/* Right: View mode indicator */}
      <div className="title-bar-right">
        <span className="title-bar-mode">{getViewModeLabel(viewMode)}</span>
      </div>
    </div>
  );
}
