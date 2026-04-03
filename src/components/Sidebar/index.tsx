import type { TOCEntry } from "../../stores/tocStore";
import type { ViewMode } from "../../types/editor";
import { TOCSidebar } from "./TOCSidebar";

export function getViewModeLabel(mode: ViewMode): string {
  switch (mode) {
    case "split": return "SPLIT";
    case "editor-only": return "EDITOR";
    case "preview-only": return "PREVIEW";
    case "wysiwyg": return "WYSIWYG";
    default: return "";
  }
}

interface TOCSidebarContainerProps {
  /** TOC entries */
  tocEntries: TOCEntry[];
  /** Active TOC entry ID */
  activeTocEntryId: string | null;
  /** Collapsed TOC entry IDs */
  collapsedTocIds: Set<string>;
  /** Handler for TOC entry click */
  onTocEntryClick: (id: string) => void;
  /** Handler for TOC collapse toggle */
  onTocToggleCollapse: (id: string) => void;
  /** Current editor view mode — shown in the traffic-lights area */
  viewMode: ViewMode;
}

export function TOCSidebarContainer({
  tocEntries,
  activeTocEntryId,
  collapsedTocIds,
  onTocEntryClick,
  onTocToggleCollapse,
  viewMode,
}: TOCSidebarContainerProps) {
  return (
    <aside className="sidebar">
      {/* Traffic-lights zone: drag region + view-mode badge */}
      <div className="sidebar-traffic-area" data-tauri-drag-region>
        <span className="sidebar-mode-label" data-tauri-drag-region="false">{getViewModeLabel(viewMode)}</span>
      </div>
      <div className="sidebar-header">Table of Contents</div>
      <TOCSidebar
        entries={tocEntries}
        activeEntryId={activeTocEntryId}
        collapsedIds={collapsedTocIds}
        onEntryClick={onTocEntryClick}
        onToggleCollapse={onTocToggleCollapse}
      />
    </aside>
  );
}

// Re-export components
export { Sidebar } from "./Sidebar";
export { TOCSidebar } from "./TOCSidebar";
