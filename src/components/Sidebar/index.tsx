import type { HeadingKey, TOCEntry } from "../../types/toc";
import type { ViewMode } from "../../types/editor";
import { TOCSidebar } from "./TOCSidebar";

export function getViewModeLabel(mode: ViewMode): string {
  switch (mode) {
    case "wysiwyg": return "WYSIWYG";
    case "source": return "SOURCE";
  }
}

interface TOCSidebarContainerProps {
  /** TOC entries */
  tocEntries: TOCEntry[];
  /** Active TOC entry, by coordination key */
  activeTocEntryId: HeadingKey | null;
  /** Collapsed TOC entries, by coordination key */
  collapsedTocIds: Set<HeadingKey>;
  /** Handler for TOC entry click */
  onTocEntryClick: (key: HeadingKey) => void;
  /** Handler for TOC collapse toggle */
  onTocToggleCollapse: (key: HeadingKey) => void;
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
export { TOCSidebar } from "./TOCSidebar";
