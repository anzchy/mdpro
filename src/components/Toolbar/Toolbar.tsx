import type { ViewMode } from "../../types/editor";

interface ToolbarProps {
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

export function Toolbar({ viewMode }: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar-spacer" />
      <div className="toolbar-view-mode">
        {getViewModeLabel(viewMode)}
      </div>
    </header>
  );
}
