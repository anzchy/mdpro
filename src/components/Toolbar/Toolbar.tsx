import type { ViewMode } from "../../types/editor";
import type { UserPreferences } from "../../types/preferences";

interface ToolbarProps {
  title: string;
  isModified: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onOpen: () => void;
  onSave: () => void;
  onNew: () => void;
  onHighlight: () => void;
  showSidebar: boolean;
  onToggleSidebar: () => void;
  themeMode: UserPreferences["themeMode"];
  onThemeToggle: () => void;
}

export function Toolbar({
  title,
  isModified,
  viewMode,
  onViewModeChange,
  onOpen,
  onSave,
  onNew,
  onHighlight,
  showSidebar,
  onToggleSidebar,
  themeMode,
  onThemeToggle,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar-title">
        {title}
        {isModified ? " •" : ""}
      </div>
      <div className="toolbar-actions">
        <div className="toolbar-modes">
          {([
            ["split", "Split"],
            ["editor-only", "Editor"],
            ["preview-only", "Preview"],
            ["wysiwyg", "WYSIWYG"],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              className={`toolbar-button toolbar-mode${
                viewMode === mode ? " is-active" : ""
              }`}
              type="button"
              onClick={() => onViewModeChange(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar-buttons">
          <button className="toolbar-button" type="button" onClick={onToggleSidebar}>
            {showSidebar ? "Hide Sidebar" : "Show Sidebar"}
          </button>
          <button className="toolbar-button" type="button" onClick={onNew}>
            New
          </button>
          <button className="toolbar-button" type="button" onClick={onOpen}>
            Open
          </button>
          <button className="toolbar-button" type="button" onClick={onSave}>
            Save
          </button>
          <button className="toolbar-button" type="button" onClick={onHighlight}>
            Highlight
          </button>
          <button className="toolbar-button" type="button" onClick={onThemeToggle}>
            Theme: {themeMode}
          </button>
        </div>
      </div>
    </header>
  );
}
